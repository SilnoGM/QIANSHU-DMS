import type { Readable } from 'node:stream'

import type { MediaKeyMigrationCandidate } from './media-key-migration.service'

/**
 * 复制阶段的三个端口都用最小接口：对象存储的真实实现（CosObjectClient / CosMediaStorage）结构性满足它们，
 * 单测与命令层不必为了注入而构造完整的 MediaStorage 端口。
 *
 * `putObject` 携带 assetId：本地驱动没有「按任意键写入 assets」的原语，它的复制实现要先写 staging 再
 * finalize，而 staging 键需要资产标识（`staging/{assetId}.{uuid}.part`）。把它放进请求里，复制实现
 * 就能保持无状态；对象存储实现忽略该字段。
 */
export interface MediaKeyMigrationCopyClient {
  putObject(request: {
    readonly assetId: string
    readonly contentLength: number
    readonly key: string
    readonly sha256: string
    readonly stream: Readable
  }): Promise<unknown>
}

export interface MediaKeyMigrationCopySource {
  openManagedObject(key: string): Promise<{
    readonly sizeBytes: bigint
    readonly stream: Readable
  }>
}

export interface MediaKeyMigrationCopyTarget {
  stat(key: string): Promise<{ readonly sizeBytes: bigint } | null>
  verifyStoredObject(
    key: string,
    expected: { readonly checksumSha256: string, readonly sizeBytes: bigint },
  ): Promise<boolean>
}

export interface MediaKeyMigrationCopyDependencies {
  readonly client: MediaKeyMigrationCopyClient
  readonly source: MediaKeyMigrationCopySource
  readonly target: MediaKeyMigrationCopyTarget
}

export interface MediaKeyMigrationCopyResult {
  readonly copied: number
  readonly failed: number
  readonly skipped: number
}

export interface MediaKeyMigrationCopyOperations {
  copyBatch(
    candidates: readonly MediaKeyMigrationCandidate[],
  ): Promise<MediaKeyMigrationCopyResult>
}

interface MutableCopyCounters {
  copied: number
  failed: number
  skipped: number
}

/**
 * 键重命名迁移的第二阶段：把旧键上的字节复制到新键，不改数据库。
 *
 * 顺序不可颠倒：`preview → copy → apply`。改键只在目标对象存在且长度一致时才被允许
 * （见 MediaKeyMigrationService.applyBatch），所以先跑 apply 只会得到一批拒绝改键的行；
 * 复制阶段则完全不碰数据库，失败重跑是安全的。
 *
 * 与 media-migration.service（本地 → 对象存储）的区别：那一支搬的是「驱动」，本支搬的是「键」，
 * 源与目标在同一个桶里，因此只有键不同、字节相同。
 */
export class MediaKeyMigrationCopyService implements MediaKeyMigrationCopyOperations {
  constructor(private readonly dependencies: MediaKeyMigrationCopyDependencies) {}

  async copyBatch(
    candidates: readonly MediaKeyMigrationCandidate[],
  ): Promise<MediaKeyMigrationCopyResult> {
    const counters: MutableCopyCounters = { copied: 0, failed: 0, skipped: 0 }
    for (const candidate of candidates) {
      await this.copyCandidate(candidate, counters)
    }
    return Object.freeze({ ...counters })
  }

  /**
   * 单个候选：目标对象已存在且校验通过则跳过，否则从旧键流式复制到新键并立即复核。
   *
   * 任何失败都只计数、绝不删除源对象：改键之前数据库仍指向旧键，源对象是这一阶段的唯一回滚面；
   * 单条失败也不中断整批，退出码由命令层按 failed 汇总决定。
   */
  private async copyCandidate(
    candidate: MediaKeyMigrationCandidate,
    counters: MutableCopyCounters,
  ): Promise<void> {
    const { checksumSha256, sizeBytes } = candidate
    // 摘要或长度缺失时无法证明副本与原件一致（列可空），宁可不复制并计失败，交给运维核对。
    if (checksumSha256 === null || sizeBytes === null) {
      counters.failed += 1
      return
    }
    const expected = { checksumSha256, sizeBytes }

    try {
      // 先看存在性再看内容：对不存在的键做校验没有意义，而「已复制」必须以
      // 「目标对象存在且长度与摘要都对得上」为准——同名但内容不同的对象不能当成副本。
      const existing = await this.dependencies.target.stat(candidate.newKey)
      if (existing !== null) {
        const verified = await this.dependencies.target.verifyStoredObject(
          candidate.newKey,
          expected,
        )
        if (verified) {
          counters.skipped += 1
          return
        }
      }
    }
    catch {
      // 目标端不可达不等于「未复制」：计失败，避免把连接故障当成待复制对象继续推进。
      counters.failed += 1
      return
    }

    try {
      const stored = await this.dependencies.source.openManagedObject(candidate.oldKey)
      try {
        await this.dependencies.client.putObject({
          assetId: candidate.assetId,
          contentLength: Number(stored.sizeBytes),
          key: candidate.newKey,
          sha256: checksumSha256,
          stream: stored.stream,
        })
      }
      catch (error) {
        stored.stream.destroy()
        throw error
      }
      const copied = await this.dependencies.target.verifyStoredObject(
        candidate.newKey,
        expected,
      )
      if (!copied) throw new Error('Media key migration copy verification failed')
    }
    catch {
      counters.failed += 1
      return
    }
    counters.copied += 1
  }
}
