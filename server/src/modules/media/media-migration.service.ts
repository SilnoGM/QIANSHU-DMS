import type { CosObjectClient } from './cos-object-client'
import type { MediaStorage } from './media-storage'

const INVENTORY_PAGE_SIZE = 500
const MAX_INVENTORY_PAGES = 10_000
const MIGRATION_NAMESPACES = ['assets', 'trash'] as const

/**
 * 对象键布局：`<namespace>/<YYYY>/<MM>/<assetId><extension>`（trash 同形）。
 * 只解析出 assetId 用于回查数据库摘要，不保留原始键以外的任何标识。
 */
const STORED_ASSET_PATTERN =
  /^(?:assets|trash)\/[0-9]{4}\/[0-9]{2}\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[a-z0-9]+$/iu

export interface MediaMigrationAssetRecord {
  readonly checksumSha256: string
  readonly sizeBytes: bigint
}

export interface MediaMigrationDependencies {
  /** 目标端写入：简单 PUT，因此直接使用对象客户端而不是存储端口（端口没有「任意对象写入」语义）。 */
  readonly client: CosObjectClient
  /** 数据库摘要查询：命中则免去重新计算，缺失时回退为读取源对象。 */
  readonly lookupAsset: (assetId: string) => Promise<MediaMigrationAssetRecord | null>
  readonly source: MediaStorage
  /** 目标端校验：复用驱动的分级校验，保证搬运后的对象立刻可验证。 */
  readonly target: MediaStorage
}

export interface MediaMigrationResult {
  readonly copied: number
  readonly failed: number
  readonly scanned: number
  readonly skipped: number
}

export type MediaMigrationMode = 'apply' | 'preview'

interface MutableCounters {
  copied: number
  failed: number
  scanned: number
  skipped: number
}

function assetIdFromKey(key: string): string | null {
  const matched = key.match(STORED_ASSET_PATTERN)
  return matched?.[1]?.toLowerCase() ?? null
}

/**
 * 把本地 driver 的既有对象搬运到对象存储。
 *
 * 设计要点：
 * - 只读源端、只写目标端，任何失败都不删除源对象，因此本地目录始终是回滚面；
 * - 幂等可续跑：目标端已通过校验的对象直接跳过，中断后重跑不会重复上传；
 * - 逐一校验：每个对象上传后立即用驱动的分级校验确认，未通过即计为失败；
 * - 不做数据库写入：`storage_driver` 记录"物化时的驱动"并被不可变触发器保护，
 *   迁移只搬运字节，不改写该列（切换驱动由部署配置决定，与运行期分派解耦）。
 */
export class MediaMigrationService {
  constructor(private readonly dependencies: MediaMigrationDependencies) {}

  async run(mode: MediaMigrationMode): Promise<MediaMigrationResult> {
    // 先证明目标桶可达：否则「全部需要搬迁」的预览结论会把连接故障误报成工作量。
    await this.dependencies.client.headBucket()

    const counters: MutableCounters = {
      copied: 0,
      failed: 0,
      scanned: 0,
      skipped: 0,
    }

    for (const namespace of MIGRATION_NAMESPACES) {
      let cursor: string | undefined
      for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
        const inventory = await this.dependencies.source.inventory({
          limit: INVENTORY_PAGE_SIZE,
          namespace,
          ...(cursor === undefined ? {} : { cursor }),
        })
        for (const object of inventory.objects) {
          counters.scanned += 1
          await this.migrateObject(object.key, mode, counters)
        }
        cursor = inventory.nextCursor ?? undefined
        if (cursor === undefined) break
      }
    }

    return Object.freeze({ ...counters })
  }

  private async migrateObject(
    key: string,
    mode: MediaMigrationMode,
    counters: MutableCounters,
  ): Promise<void> {
    let expected: MediaMigrationAssetRecord
    try {
      expected = await this.expectationFor(key)
    }
    catch {
      counters.failed += 1
      return
    }

    let migrated: boolean
    try {
      migrated = await this.dependencies.target.verifyStoredObject(key, expected)
    }
    catch {
      // 目标端不可用不等于「未迁移」：计失败让整轮退出非零，由运维排查后再重跑。
      counters.failed += 1
      return
    }
    if (migrated) {
      counters.skipped += 1
      return
    }
    if (mode === 'preview') return

    try {
      const stored = await this.dependencies.source.openManagedObject(key)
      try {
        await this.dependencies.client.putObject({
          contentLength: Number(stored.sizeBytes),
          key,
          sha256: expected.checksumSha256,
          stream: stored.stream,
        })
      }
      catch (error) {
        stored.stream.destroy()
        throw error
      }
      const verified = await this.dependencies.target.verifyStoredObject(key, expected)
      if (!verified) throw new Error('Media migration verification failed')
    }
    catch {
      counters.failed += 1
      return
    }
    counters.copied += 1
  }

  /**
   * 期望摘要优先取数据库记录（可信元数据），迁移对象没有对应记录时才回读源对象计算，
   * 避免为每个对象都付一次本地全量读取。
   */
  private async expectationFor(key: string): Promise<MediaMigrationAssetRecord> {
    const assetId = assetIdFromKey(key)
    const record = assetId === null
      ? null
      : await this.dependencies.lookupAsset(assetId)
    if (record !== null) return record

    const stored = await this.dependencies.source.openManagedObject(key)
    try {
      const checksumSha256 = await this.dependencies.source.checksumSha256(key)
      return { checksumSha256, sizeBytes: stored.sizeBytes }
    }
    finally {
      stored.stream.destroy()
    }
  }
}
