import { createHash } from 'node:crypto'
import { PassThrough, type Readable } from 'node:stream'

import type {
  CosMediaConfiguration,
  LocalMediaConfiguration,
  MediaConfiguration,
} from '../../config/media.config'
import {
  CosObjectClientError,
  type CosObjectClient,
  type CosObjectRange,
  type CosStoredObjectHead,
} from './cos-object-client'
import { LocalMediaStorage } from './local-media-storage'
import {
  type MediaByteRange,
  type MediaStorage,
  MediaStorageError,
  type MediaStorageHealthResult,
  type MediaStorageInventoryPage,
  type MediaStorageInventoryRequest,
  normalizeMediaObjectKey,
  type ReadableStoredObject,
  requireMediaObjectKeyNamespace,
  type StagingWrite,
  type StoredObjectExpectation,
  type StoredObjectStat,
} from './media-storage'

const MIN_INVENTORY_LIMIT = 1
const MAX_INVENTORY_LIMIT = 500
const SHA256_METADATA_KEY = 'x-cos-meta-sha256'
const MANAGED_NAMESPACES = ['assets', 'staging', 'trash'] as const

type ManagedNamespace = (typeof MANAGED_NAMESPACES)[number]

export interface CosMediaStorageDependencies {
  readonly client: CosObjectClient
  /**
   * staging 命名空间的本地实现：上传落地、内容校验源与容量检查留在本地磁盘，
   * 使 ffprobe/qpdf/sharp 继续面对真实文件路径。
   */
  readonly staging: MediaStorage
}

function healthResult(
  status: MediaStorageHealthResult['status'],
  code: MediaStorageHealthResult['code'],
): MediaStorageHealthResult {
  return Object.freeze({ code, status })
}

/**
 * 客户端错误收敛为存储错误码。
 *
 * 凭据、权限与网络失败统一映射为 `MEDIA_STORAGE_UNAVAILABLE`：对上层而言「桶不可用」与
 * 「桶拒绝对话」是同一个失败关闭语义，具体原因只留在对象存储侧的审计日志里。
 */
function storageErrorFromClient(error: unknown): MediaStorageError {
  if (error instanceof CosObjectClientError) {
    if (error.code === 'COS_CLIENT_CONFLICT') {
      return new MediaStorageError('MEDIA_STORAGE_CONFLICT')
    }
    if (error.code === 'COS_CLIENT_INVALID_RANGE') {
      return new MediaStorageError('MEDIA_STORAGE_INVALID_RANGE')
    }
    if (error.code === 'COS_CLIENT_NOT_FOUND') {
      return new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    }
  }
  return new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
}

/**
 * SDK 流错误对象携带请求 URL 与响应头（含签名参数），因此在边界处替换为固定错误码；
 * 同时把消费端的中断（例如浏览器取消下载）传导为对底层请求的销毁，避免连接泄漏。
 */
function guardStoredObjectStream(source: Readable): Readable {
  const guard = new PassThrough()
  source.on('error', () => {
    guard.destroy(new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE'))
  })
  guard.on('close', () => {
    source.destroy()
  })
  source.pipe(guard)
  return guard
}

function normalizeRange(
  range: MediaByteRange | undefined,
  sizeBytes: bigint,
): CosObjectRange | undefined {
  if (range === undefined) return undefined
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    BigInt(range.end) >= sizeBytes
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_INVALID_RANGE')
  }
  return { end: range.end, start: range.start }
}

function requireManagedNamespace(key: string): ManagedNamespace {
  const normalized = normalizeMediaObjectKey(key)
  for (const namespace of MANAGED_NAMESPACES) {
    if (normalized.startsWith(`${namespace}/`)) return namespace
  }
  throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
}

async function digestOfStream(stream: Readable): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of stream) {
    hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return hash.digest('hex')
}

/**
 * 把 assets/trash 的字节放在 COS、staging 留在本地磁盘的复合驱动。
 *
 * 对象键沿用与本地实现完全相同的 `assets/YYYY/MM/<uuid>.<ext>` 布局，因此切换驱动不需要
 * 迁移键，也不需要改动对账、保留期与投递链路——它们只依赖 `MediaStorage` 端口。
 */
export class CosMediaStorage implements MediaStorage {
  private constructor(
    private readonly dependencies: CosMediaStorageDependencies,
  ) {}

  static async create(
    configuration: CosMediaConfiguration,
    client: CosObjectClient,
    stagingFactory: (configuration: LocalMediaConfiguration) => Promise<MediaStorage> =
      candidate => LocalMediaStorage.create(candidate),
  ): Promise<CosMediaStorage> {
    const staging = await stagingFactory(toStagingConfiguration(configuration))
    return new CosMediaStorage(Object.freeze({ client, staging }))
  }

  async checkHealth(
    minimumFreeBytes = 1n,
  ): Promise<MediaStorageHealthResult> {
    const staging = await this.dependencies.staging.checkHealth(minimumFreeBytes)
    if (staging.status === 'down') return staging
    try {
      await this.dependencies.client.headBucket()
    }
    catch {
      return healthResult('down', 'MEDIA_STORAGE_UNAVAILABLE')
    }
    return healthResult('up', 'MEDIA_STORAGE_READY')
  }

  /**
   * 三个命名空间统一走「受控读取 + 本地计算摘要」。
   *
   * 不能把 staging 键转给本地实例的 `checksumSha256`：那个方法只接受 `assets/` 与 `trash/`，
   * 传 staging 键会抛 `MEDIA_STORAGE_INVALID_KEY`（真实桶验收时踩到过）。
   */
  async checksumSha256(objectKey: string): Promise<string> {
    const opened = await this.openManagedObject(objectKey)
    return digestOfStream(opened.stream)
  }

  createStagingWrite(assetId: string): Promise<StagingWrite> {
    return this.dependencies.staging.createStagingWrite(assetId)
  }

  async finalize(stagingKey: string, objectKey: string): Promise<void> {
    const source = requireMediaObjectKeyNamespace(stagingKey, 'staging')
    const target = requireMediaObjectKeyNamespace(objectKey, 'assets')
    const staged = await this.dependencies.staging.stat(source)
    if (staged === null) {
      throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    }
    if (await this.headObject(target) !== null) {
      throw new MediaStorageError('MEDIA_STORAGE_CONFLICT')
    }

    // 摘要必须在上传前算出来（要写进对象元数据），因此先完整读取一次 staging 文件；
    // 这里同样不能复用本地实例的 checksumSha256——它只接受 assets/trash。
    const stagedForDigest = await this.dependencies.staging.openManagedObject(source)
    const sha256 = await digestOfStream(stagedForDigest.stream)
    const opened = await this.dependencies.staging.openManagedObject(source)
    try {
      await this.dependencies.client.putObject({
        contentLength: Number(staged.sizeBytes),
        key: target,
        sha256,
        stream: opened.stream,
      })
    }
    catch (error) {
      opened.stream.destroy()
      throw storageErrorFromClient(error)
    }

    // 上传成功后才移除本地 staging：失败时保留文件，交由既有 staging 超时清理路径处理。
    await this.dependencies.staging.purge(source)
  }

  async inventory(
    request: MediaStorageInventoryRequest,
  ): Promise<MediaStorageInventoryPage> {
    if (
      !Number.isSafeInteger(request.limit) ||
      request.limit < MIN_INVENTORY_LIMIT ||
      request.limit > MAX_INVENTORY_LIMIT
    ) {
      throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
    }
    const namespacePrefix = `${request.namespace}/`
    const prefix = request.prefix === undefined
      ? namespacePrefix
      : normalizeMediaObjectKey(request.prefix)
    if (!prefix.startsWith(namespacePrefix)) {
      throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
    }
    if (request.cursor !== undefined) {
      const cursor = requireMediaObjectKeyNamespace(request.cursor, request.namespace)
      if (!cursor.startsWith(prefix)) {
        throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
      }
    }
    if (request.namespace === 'staging') {
      return this.dependencies.staging.inventory(request)
    }

    let page
    try {
      page = await this.dependencies.client.listObjects({
        limit: request.limit,
        prefix,
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      })
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }
    return Object.freeze({
      nextCursor: page.nextCursor,
      objects: Object.freeze(page.objects.map(object => Object.freeze({ ...object }))),
    })
  }

  async open(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    return this.openInspectedObject(
      requireMediaObjectKeyNamespace(objectKey, 'assets'),
      range,
    )
  }

  async openManagedObject(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    const namespace = requireManagedNamespace(objectKey)
    if (namespace === 'staging') {
      return this.dependencies.staging.openManagedObject(objectKey, range)
    }
    return this.openInspectedObject(
      requireMediaObjectKeyNamespace(objectKey, namespace),
      range,
    )
  }

  async moveToTrash(objectKey: string, trashKey: string): Promise<void> {
    await this.move(
      requireMediaObjectKeyNamespace(objectKey, 'assets'),
      requireMediaObjectKeyNamespace(trashKey, 'trash'),
    )
  }

  async restoreFromTrash(trashKey: string, objectKey: string): Promise<void> {
    await this.move(
      requireMediaObjectKeyNamespace(trashKey, 'trash'),
      requireMediaObjectKeyNamespace(objectKey, 'assets'),
    )
  }

  async purge(key: string): Promise<void> {
    const namespace = requireManagedNamespace(key)
    if (namespace === 'staging') {
      return this.dependencies.staging.purge(key)
    }
    try {
      // DeleteObject 幂等：对象不存在同样返回成功，与本地实现的静默返回语义一致。
      await this.dependencies.client.deleteObject(key)
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }
  }

  async stat(key: string): Promise<StoredObjectStat | null> {
    const namespace = requireManagedNamespace(key)
    if (namespace === 'staging') {
      return this.dependencies.staging.stat(key)
    }
    const head = await this.headObject(key)
    if (head === null) return null
    return Object.freeze({
      modifiedAt: head.modifiedAt,
      sizeBytes: head.sizeBytes,
    })
  }

  withStagingValidationSource<T>(
    stagingKey: string,
    operation: (sourcePath: string) => Promise<T>,
  ): Promise<T> {
    return this.dependencies.staging.withStagingValidationSource(
      stagingKey,
      operation,
    )
  }

  /**
   * 分级校验：优先用上传时写入的对象元数据核对，元数据缺失时回退为回读全文。
   *
   * 这里不下载正文的前提是「长度 + 上传时记录的摘要」同时命中；只命中长度不足以放行，
   * 因为长度一致并不能证明字节一致。全字节比对仍由对账工具 `recovery-dry-run` 承担。
   */
  async verifyStoredObject(
    objectKey: string,
    expected: StoredObjectExpectation,
  ): Promise<boolean> {
    const namespace = requireManagedNamespace(objectKey)
    if (namespace === 'staging') {
      return this.dependencies.staging.verifyStoredObject(objectKey, expected)
    }
    const head = await this.headObject(objectKey)
    if (head === null) return false
    if (head.sizeBytes !== expected.sizeBytes) return false

    const recorded = head.metadata[SHA256_METADATA_KEY]
    if (recorded !== undefined) {
      return recorded === expected.checksumSha256
    }
    // 迁移进来的历史对象没有元数据摘要；此时必须实际读取字节，不能仅凭长度放行。
    return await this.checksumSha256(objectKey) === expected.checksumSha256
  }

  private async openInspectedObject(
    key: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    const head = await this.headObject(key)
    if (head === null) throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    const normalizedRange = normalizeRange(range, head.sizeBytes)

    let source: Readable
    try {
      source = await this.dependencies.client.openObjectStream(key, normalizedRange)
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }
    return Object.freeze({
      contentLength: normalizedRange
        ? BigInt(normalizedRange.end - normalizedRange.start + 1)
        : head.sizeBytes,
      modifiedAt: head.modifiedAt,
      sizeBytes: head.sizeBytes,
      stream: guardStoredObjectStream(source),
    })
  }

  private async headObject(key: string): Promise<CosStoredObjectHead | null> {
    try {
      return await this.dependencies.client.headObject(key)
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }
  }

  /**
   * 复制后删除的搬运：COS 没有原子 rename，因此按「先复制、校验尺寸、再删源」执行。
   * 中断最多留下「两处同时存在」的重复对象，对账会把这种形态记为 duplicateLocation 交由人工处理，
   * 不会静默丢掉任何一个副本。
   */
  private async move(sourceKey: string, targetKey: string): Promise<void> {
    const source = await this.stat(sourceKey)
    if (source === null) throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    if (await this.stat(targetKey) !== null) {
      throw new MediaStorageError('MEDIA_STORAGE_CONFLICT')
    }

    try {
      await this.dependencies.client.copyObject(sourceKey, targetKey)
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }

    const copied = await this.stat(targetKey)
    if (copied === null || copied.sizeBytes !== source.sizeBytes) {
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }

    try {
      await this.dependencies.client.deleteObject(sourceKey)
    }
    catch (error) {
      throw storageErrorFromClient(error)
    }
  }
}

/**
 * 只把本地语义字段交给本地实现。
 *
 * 逐字段构造而非展开配置对象：这样 COS 目标与非敏感定位信息不会渗入本地实现，
 * 本地实现的安全校验（root realpath、权限位、设备一致性、容量）也保持不变。
 * 存量迁移命令用同一个派生函数构造「源端本地存储」，保证与运行期完全一致的目录语义。
 */
export function deriveLocalMediaConfiguration(
  configuration: MediaConfiguration,
): LocalMediaConfiguration {
  return Object.freeze({
    contentDeliveryMode: configuration.contentDeliveryMode,
    driver: 'local',
    ffprobePath: configuration.ffprobePath,
    qpdfPath: configuration.qpdfPath,
    stagingTtlHours: configuration.stagingTtlHours,
    storageEnvironment: configuration.storageEnvironment,
    storageRoot: configuration.storageRoot,
    trashRetentionDays: configuration.trashRetentionDays,
  })
}

function toStagingConfiguration(
  configuration: CosMediaConfiguration,
): LocalMediaConfiguration {
  return deriveLocalMediaConfiguration(configuration)
}

export { SHA256_METADATA_KEY }
