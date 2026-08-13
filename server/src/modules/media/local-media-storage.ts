import { randomUUID } from 'node:crypto'
import {
  constants as fileSystemConstants,
  type Stats,
} from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  open,
  type FileHandle,
  realpath,
  rename,
  statfs,
  unlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'
import { finished } from 'node:stream/promises'

import type { MediaConfiguration } from '../../config/media.config'
import {
  type MediaByteRange,
  type MediaStorage,
  MediaStorageError,
  type MediaStorageHealthResult,
  normalizeMediaObjectKey,
  type ReadableStoredObject,
  requireMediaObjectKeyNamespace,
  type StagingWrite,
  type StoredObjectStat,
} from './media-storage'

const DIRECTORY_MODE = 0o750
const FILE_MODE = 0o640
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STORAGE_NAMESPACES = ['staging', 'assets', 'trash'] as const
const SERVER_ROOT = resolve(__dirname, '../../..')

export interface LocalFileSystemCapacity {
  readonly availableBlocks: bigint
  readonly blockSize: bigint
}

export interface LocalMediaStorageDependencies {
  readonly access: (path: string, mode: number) => Promise<void>
  readonly forbiddenRoots: readonly string[]
  readonly lstat: (path: string) => Promise<Stats>
  readonly mkdir: (path: string, mode: number) => Promise<void>
  readonly open: (path: string, flags: number, mode?: number) => Promise<FileHandle>
  readonly randomUuid: () => string
  readonly realpath: (path: string) => Promise<string>
  readonly rename: (source: string, target: string) => Promise<void>
  readonly statFileSystem: (path: string) => Promise<LocalFileSystemCapacity>
  readonly unlink: (path: string) => Promise<void>
}

interface StorageInspection {
  readonly device: number
  readonly root: string
}

interface InspectedObject {
  readonly metadata: Stats
  readonly path: string
}

const DEFAULT_DEPENDENCIES: Omit<LocalMediaStorageDependencies, 'forbiddenRoots'> = {
  access,
  lstat,
  mkdir: async (path, mode) => {
    await mkdir(path, { mode })
  },
  open,
  randomUuid: randomUUID,
  realpath,
  rename,
  statFileSystem: async (path) => {
    const metadata = await statfs(path, { bigint: true })
    return {
      availableBlocks: metadata.bavail,
      blockSize: metadata.bsize,
    }
  },
  unlink,
}

function defaultForbiddenRoots(): readonly string[] {
  return Object.freeze([
    SERVER_ROOT,
    resolve(SERVER_ROOT, 'dist'),
    resolve(process.cwd()),
    resolve(tmpdir()),
  ])
}

function createDependencies(
  overrides: Partial<LocalMediaStorageDependencies>,
): LocalMediaStorageDependencies {
  return Object.freeze({
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
    forbiddenRoots: Object.freeze([
      ...(overrides.forbiddenRoots ?? defaultForbiddenRoots()),
    ]),
  })
}

function readErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  try {
    return Reflect.get(error, 'code')
  }
  catch {
    return undefined
  }
}

function isMissingError(error: unknown): boolean {
  return readErrorCode(error) === 'ENOENT'
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = readErrorCode(error)
  return code === 'EEXIST' || code === 'ENOTEMPTY'
}

function isPathWithin(candidate: string, parent: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === '' || (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  )
}

function hasTrustedDirectoryPermissions(metadata: Stats): boolean {
  // group 可以读取/进入以供受控 Nginx 组访问，但不能写；other 不得拥有任何权限。
  return (metadata.mode & 0o027) === 0
}

function hasTrustedFilePermissions(metadata: Stats): boolean {
  // 文件允许 0600/0640 等更严格模式，禁止 executable、group write 和全部 other 权限。
  return (metadata.mode & 0o137) === 0
}

function requireManagedObjectKey(value: unknown): string {
  const normalized = normalizeMediaObjectKey(value)
  if (!STORAGE_NAMESPACES.some(namespace => normalized.startsWith(`${namespace}/`))) {
    throw new MediaStorageError('MEDIA_STORAGE_INVALID_KEY')
  }
  return normalized
}

function healthResult(
  status: MediaStorageHealthResult['status'],
  code: MediaStorageHealthResult['code'],
): MediaStorageHealthResult {
  return Object.freeze({ code, status })
}

function downHealthFrom(error: unknown): MediaStorageHealthResult {
  if (error instanceof MediaStorageError) {
    if (
      error.code === 'MEDIA_STORAGE_FILESYSTEM_MISMATCH' ||
      error.code === 'MEDIA_STORAGE_INSUFFICIENT_SPACE' ||
      error.code === 'MEDIA_STORAGE_ROOT_UNSAFE'
    ) {
      return healthResult('down', error.code)
    }
  }
  return healthResult('down', 'MEDIA_STORAGE_UNAVAILABLE')
}

function storageErrorFromFileSystem(error: unknown): MediaStorageError {
  if (readErrorCode(error) === 'EXDEV') {
    return new MediaStorageError('MEDIA_STORAGE_FILESYSTEM_MISMATCH')
  }
  if (isAlreadyExistsError(error)) {
    return new MediaStorageError('MEDIA_STORAGE_CONFLICT')
  }
  return new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
}

async function canonicalizeForbiddenRoot(
  value: string,
  dependencies: LocalMediaStorageDependencies,
): Promise<string> {
  const normalized = resolve(value)
  try {
    return await dependencies.realpath(normalized)
  }
  catch {
    // 不存在的部署候选仍按规范化绝对路径参与禁止范围判断；错误详情不得离开本函数。
    return normalized
  }
}

async function ensureDirectory(
  root: string,
  rootDevice: number,
  segments: readonly string[],
  dependencies: LocalMediaStorageDependencies,
): Promise<void> {
  let current = root

  for (const segment of segments) {
    current = join(current, segment)
    try {
      await dependencies.mkdir(current, DIRECTORY_MODE)
    }
    catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw storageErrorFromFileSystem(error)
      }
    }

    let metadata: Stats
    let canonical: string
    try {
      metadata = await dependencies.lstat(current)
      canonical = await dependencies.realpath(current)
    }
    catch (error) {
      throw storageErrorFromFileSystem(error)
    }

    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      canonical !== current ||
      !hasTrustedDirectoryPermissions(metadata)
    ) {
      throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
    }
    if (metadata.dev !== rootDevice) {
      throw new MediaStorageError('MEDIA_STORAGE_FILESYSTEM_MISMATCH')
    }

    try {
      await dependencies.access(
        current,
        fileSystemConstants.W_OK | fileSystemConstants.X_OK,
      )
    }
    catch {
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }
  }
}

async function inspectStorage(
  configuration: MediaConfiguration,
  dependencies: LocalMediaStorageDependencies,
  minimumFreeBytes: bigint,
): Promise<StorageInspection> {
  if (
    configuration.driver !== 'local' ||
    !isAbsolute(configuration.storageRoot) ||
    resolve(configuration.storageRoot) === parse(resolve(configuration.storageRoot)).root
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_ROOT_UNSAFE')
  }
  if (minimumFreeBytes < 0n) {
    throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
  }

  let rootMetadata: Stats
  let canonicalRoot: string
  try {
    rootMetadata = await dependencies.lstat(configuration.storageRoot)
    canonicalRoot = await dependencies.realpath(configuration.storageRoot)
  }
  catch {
    throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
  }

  if (
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory() ||
    !hasTrustedDirectoryPermissions(rootMetadata)
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_ROOT_UNSAFE')
  }

  for (const forbiddenRoot of dependencies.forbiddenRoots) {
    const canonicalForbiddenRoot = await canonicalizeForbiddenRoot(
      forbiddenRoot,
      dependencies,
    )
    if (isPathWithin(canonicalRoot, canonicalForbiddenRoot)) {
      throw new MediaStorageError('MEDIA_STORAGE_ROOT_UNSAFE')
    }
  }

  try {
    await dependencies.access(
      canonicalRoot,
      fileSystemConstants.W_OK | fileSystemConstants.X_OK,
    )
  }
  catch {
    throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
  }

  for (const namespace of STORAGE_NAMESPACES) {
    try {
      await ensureDirectory(
        canonicalRoot,
        rootMetadata.dev,
        [namespace],
        dependencies,
      )
    }
    catch (error) {
      if (
        error instanceof MediaStorageError &&
        error.code === 'MEDIA_STORAGE_PATH_UNSAFE'
      ) {
        throw new MediaStorageError('MEDIA_STORAGE_ROOT_UNSAFE')
      }
      throw error
    }
  }

  let capacity: LocalFileSystemCapacity
  try {
    capacity = await dependencies.statFileSystem(canonicalRoot)
  }
  catch {
    throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
  }
  if (
    capacity.availableBlocks < 0n ||
    capacity.blockSize <= 0n ||
    capacity.availableBlocks * capacity.blockSize < minimumFreeBytes
  ) {
    throw new MediaStorageError('MEDIA_STORAGE_INSUFFICIENT_SPACE')
  }

  return Object.freeze({
    device: rootMetadata.dev,
    root: canonicalRoot,
  })
}

export class LocalMediaStorage implements MediaStorage {
  private constructor(
    private readonly configuration: MediaConfiguration,
    private readonly dependencies: LocalMediaStorageDependencies,
    private readonly root: string,
    private readonly rootDevice: number,
  ) {}

  static async checkHealth(
    configuration: MediaConfiguration,
    dependencyOverrides: Partial<LocalMediaStorageDependencies> = {},
    minimumFreeBytes = 1n,
  ): Promise<MediaStorageHealthResult> {
    const dependencies = createDependencies(dependencyOverrides)
    try {
      await inspectStorage(configuration, dependencies, minimumFreeBytes)
      return healthResult('up', 'MEDIA_STORAGE_READY')
    }
    catch (error) {
      return downHealthFrom(error)
    }
  }

  static async create(
    configuration: MediaConfiguration,
    dependencyOverrides: Partial<LocalMediaStorageDependencies> = {},
  ): Promise<LocalMediaStorage> {
    const dependencies = createDependencies(dependencyOverrides)
    let inspection: StorageInspection
    try {
      inspection = await inspectStorage(configuration, dependencies, 1n)
    }
    catch (error) {
      if (error instanceof MediaStorageError) throw error
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }

    return new LocalMediaStorage(
      configuration,
      dependencies,
      inspection.root,
      inspection.device,
    )
  }

  async checkHealth(minimumFreeBytes = 1n): Promise<MediaStorageHealthResult> {
    try {
      await inspectStorage(
        this.configuration,
        this.dependencies,
        minimumFreeBytes,
      )
      return healthResult('up', 'MEDIA_STORAGE_READY')
    }
    catch (error) {
      return downHealthFrom(error)
    }
  }

  async createStagingWrite(assetId: string): Promise<StagingWrite> {
    if (!UUID_PATTERN.test(assetId)) {
      throw new MediaStorageError('MEDIA_STORAGE_INVALID_ASSET_ID')
    }
    await this.requireAvailableCapacity(1n)

    const randomPart = this.dependencies.randomUuid()
    if (!UUID_PATTERN.test(randomPart)) {
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }
    const key = requireMediaObjectKeyNamespace(
      `staging/${assetId}.${randomPart}.part`,
      'staging',
    )
    // Storage 实例创建后的目录仍可能被本机其他进程替换；每次写入前重新逐段验证父目录，
    // 不能只依赖启动时的健康结果或 leaf O_NOFOLLOW。
    const path = await this.ensureTargetParent(key)

    let handle: FileHandle
    try {
      handle = await this.dependencies.open(
        path,
        fileSystemConstants.O_CREAT |
        fileSystemConstants.O_EXCL |
        fileSystemConstants.O_WRONLY |
        (fileSystemConstants.O_NOFOLLOW ?? 0),
        FILE_MODE,
      )
    }
    catch (error) {
      throw storageErrorFromFileSystem(error)
    }

    const stream = handle.createWriteStream({ autoClose: true })
    let cancellation: Promise<void> | undefined
    const cancel = (): Promise<void> => {
      cancellation ??= (async () => {
        if (!stream.closed) {
          stream.destroy()
          await finished(stream).catch(() => undefined)
        }
        await this.purgeExpectedNamespace(key, 'staging')
      })()
      return cancellation
    }

    return Object.freeze({ key, stream, cancel })
  }

  async finalize(stagingKey: string, objectKey: string): Promise<void> {
    await this.move(
      requireMediaObjectKeyNamespace(stagingKey, 'staging'),
      requireMediaObjectKeyNamespace(objectKey, 'assets'),
    )
  }

  async open(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    const key = requireMediaObjectKeyNamespace(objectKey, 'assets')
    const inspected = await this.inspectObject(key)
    if (!inspected) throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')

    let handle: FileHandle
    try {
      handle = await this.dependencies.open(
        inspected.path,
        fileSystemConstants.O_RDONLY | (fileSystemConstants.O_NOFOLLOW ?? 0),
      )
    }
    catch (error) {
      if (isMissingError(error)) {
        throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
      }
      throw storageErrorFromFileSystem(error)
    }

    let openedMetadata: Stats
    try {
      openedMetadata = await handle.stat()
    }
    catch {
      await handle.close().catch(() => undefined)
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }
    if (
      !openedMetadata.isFile() ||
      openedMetadata.dev !== this.rootDevice ||
      openedMetadata.ino !== inspected.metadata.ino
    ) {
      await handle.close().catch(() => undefined)
      throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
    }

    const sizeBytes = BigInt(openedMetadata.size)
    let normalizedRange: MediaByteRange | undefined
    try {
      normalizedRange = this.normalizeRange(range, openedMetadata.size)
    }
    catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
    const stream = handle.createReadStream({
      autoClose: true,
      ...(normalizedRange ?? {}),
    })
    const contentLength = normalizedRange
      ? BigInt(normalizedRange.end - normalizedRange.start + 1)
      : sizeBytes

    return Object.freeze({
      contentLength,
      modifiedAt: new Date(openedMetadata.mtimeMs),
      sizeBytes,
      stream,
    })
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
    await this.purgeExpectedNamespace(requireManagedObjectKey(key))
  }

  async stat(key: string): Promise<StoredObjectStat | null> {
    const inspected = await this.inspectObject(requireManagedObjectKey(key))
    if (!inspected) return null
    return Object.freeze({
      modifiedAt: new Date(inspected.metadata.mtimeMs),
      sizeBytes: BigInt(inspected.metadata.size),
    })
  }

  private async requireAvailableCapacity(minimumFreeBytes: bigint): Promise<void> {
    let capacity: LocalFileSystemCapacity
    try {
      capacity = await this.dependencies.statFileSystem(this.root)
    }
    catch {
      throw new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE')
    }
    if (
      capacity.availableBlocks < 0n ||
      capacity.blockSize <= 0n ||
      capacity.availableBlocks * capacity.blockSize < minimumFreeBytes
    ) {
      throw new MediaStorageError('MEDIA_STORAGE_INSUFFICIENT_SPACE')
    }
  }

  private resolveNormalizedKey(key: string): string {
    const target = join(this.root, ...key.split('/'))
    if (!isPathWithin(target, this.root) || target === this.root) {
      throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
    }
    return target
  }

  private async inspectObject(key: string): Promise<InspectedObject | null> {
    const normalized = normalizeMediaObjectKey(key)
    const segments = normalized.split('/')
    let current = this.root

    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index])
      let metadata: Stats
      let canonical: string
      try {
        metadata = await this.dependencies.lstat(current)
        canonical = await this.dependencies.realpath(current)
      }
      catch (error) {
        if (isMissingError(error)) return null
        throw storageErrorFromFileSystem(error)
      }

      if (
        metadata.isSymbolicLink() ||
        canonical !== current ||
        metadata.dev !== this.rootDevice
      ) {
        throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
      }

      const isLeaf = index === segments.length - 1
      if ((!isLeaf && !metadata.isDirectory()) || (isLeaf && !metadata.isFile())) {
        throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
      }
      if (
        (!isLeaf && !hasTrustedDirectoryPermissions(metadata)) ||
        (isLeaf && !hasTrustedFilePermissions(metadata))
      ) {
        throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
      }

      if (isLeaf) return { metadata, path: current }
    }

    throw new MediaStorageError('MEDIA_STORAGE_PATH_UNSAFE')
  }

  private async ensureTargetParent(key: string): Promise<string> {
    const normalized = normalizeMediaObjectKey(key)
    const segments = normalized.split('/')
    await ensureDirectory(
      this.root,
      this.rootDevice,
      segments.slice(0, -1),
      this.dependencies,
    )
    return this.resolveNormalizedKey(normalized)
  }

  private async move(sourceKey: string, targetKey: string): Promise<void> {
    const source = await this.inspectObject(sourceKey)
    if (!source) throw new MediaStorageError('MEDIA_STORAGE_NOT_FOUND')
    const targetPath = await this.ensureTargetParent(targetKey)
    const existingTarget = await this.inspectObject(targetKey)
    if (existingTarget) throw new MediaStorageError('MEDIA_STORAGE_CONFLICT')

    try {
      // 目标目录为 Storage 独占且权限受限；预先拒绝冲突后使用同设备 rename，保证内容以完整文件原子可见。
      await this.dependencies.rename(source.path, targetPath)
    }
    catch (error) {
      throw storageErrorFromFileSystem(error)
    }
  }

  private async purgeExpectedNamespace(
    key: string,
    namespace?: 'assets' | 'staging' | 'trash',
  ): Promise<void> {
    const normalized = namespace
      ? requireMediaObjectKeyNamespace(key, namespace)
      : normalizeMediaObjectKey(key)
    const inspected = await this.inspectObject(normalized)
    if (!inspected) return
    try {
      await this.dependencies.unlink(inspected.path)
    }
    catch (error) {
      if (isMissingError(error)) return
      throw storageErrorFromFileSystem(error)
    }
  }

  private normalizeRange(
    range: MediaByteRange | undefined,
    sizeBytes: number,
  ): MediaByteRange | undefined {
    if (range === undefined) return undefined
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end >= sizeBytes
    ) {
      throw new MediaStorageError('MEDIA_STORAGE_INVALID_RANGE')
    }
    return { end: range.end, start: range.start }
  }
}
