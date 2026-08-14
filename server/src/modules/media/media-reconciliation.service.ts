import { performance } from 'node:perf_hooks'

import type { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type {
  MediaStorage,
  StoredObjectInventoryEntry,
  StoredObjectStat,
} from './media-storage'
import {
  runMediaReconciliationDryRun,
  type MediaReconciliationDryRunOptions,
  type MediaReconciliationDryRunResult,
} from './media-reconciliation.dry-run'
import type { MediaAssetReferenceRepository } from './media-reference.repository'
import type {
  ExpiredAssetTransition,
  MediaReconciliationPersistence,
  ReconciliationAssetRecord,
} from './media-reconciliation.persistence'
import { trashKeyFor } from './media-retention.service'

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 100
const INVENTORY_PAGE_SIZE = 100
const MAX_STAGING_PAGES_PER_ASSET = 5
const DEFAULT_TIME_BUDGET_MS = 5_000
const MAX_TIME_BUDGET_MS = 60_000

export type {
  MediaReconciliationDryRunOptions,
  MediaReconciliationDryRunResult,
  MediaReconciliationIssueCounts,
} from './media-reconciliation.dry-run'

export interface MediaReconciliationBatchOptions {
  readonly batchSize?: number
  readonly timeBudgetMs?: number
}

export interface MediaReconciliationCleanupResult {
  readonly completed: number
  readonly failed: number
  readonly isolated: number
  readonly scanned: number
}

interface ReconciliationDependencies {
  readonly monotonicNow: () => number
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: ReconciliationDependencies = {
  monotonicNow: () => performance.now(),
  now: () => new Date(),
}

type CleanupOutcome = 'COMPLETED' | 'FAILED' | 'ISOLATED'

interface MutableCleanupResult {
  completed: number
  failed: number
  isolated: number
  scanned: number
}

function requireBatchSize(value: number | undefined): number {
  const normalized = value ?? DEFAULT_BATCH_SIZE
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_BATCH_SIZE) {
    throw new Error('Media reconciliation batch size is invalid')
  }
  return normalized
}

function requireTimeBudget(value: number | undefined): number {
  const normalized = value ?? DEFAULT_TIME_BUDGET_MS
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > MAX_TIME_BUDGET_MS
  ) {
    throw new Error('Media reconciliation time budget is invalid')
  }
  return normalized
}

function emptyCleanupResult(): MutableCleanupResult {
  return { completed: 0, failed: 0, isolated: 0, scanned: 0 }
}

function recordOutcome(result: MutableCleanupResult, outcome: CleanupOutcome): void {
  result.scanned += 1
  if (outcome === 'COMPLETED') result.completed += 1
  else if (outcome === 'ISOLATED') result.isolated += 1
  else result.failed += 1
}

function freezeCleanupResult(
  result: MutableCleanupResult,
): MediaReconciliationCleanupResult {
  return Object.freeze({ ...result })
}

function exactSize(
  stat: StoredObjectStat | null,
  expectedSize: bigint,
): boolean {
  return stat !== null && stat.sizeBytes === expectedSize
}

/**
 * Reconciler 不修复业务引用，也不根据文件存在性伪造 READY。
 * 清理只处理已经满足状态、时间和零引用条件的资产；dry run 只返回低基数计数。
 */
export class MediaReconciliationService {
  private readonly dependencies: ReconciliationDependencies

  constructor(
    private readonly persistence: MediaReconciliationPersistence,
    private readonly references: MediaAssetReferenceRepository,
    private readonly storage: MediaStorage,
    dependencyOverrides: Partial<ReconciliationDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async cleanupExpiredUploads(
    options: MediaReconciliationBatchOptions = {},
  ): Promise<MediaReconciliationCleanupResult> {
    const batchSize = requireBatchSize(options.batchSize)
    const timeBudgetMs = requireTimeBudget(options.timeBudgetMs)
    const startedAt = this.dependencies.monotonicNow()
    const now = this.dependencies.now()
    const excludedAssetIds: string[] = []
    const result = emptyCleanupResult()

    while (
      result.scanned < batchSize &&
      this.dependencies.monotonicNow() - startedAt < timeBudgetMs
    ) {
      const claimed = await this.persistence.withExpiredUploadClaim(
        now,
        async (transaction, candidate) => {
          excludedAssetIds.push(candidate.id)
          return this.cleanupExpiredUpload(transaction, candidate, now)
        },
        [...excludedAssetIds],
      )
      if (claimed === null) break
      recordOutcome(result, claimed)
    }
    return freezeCleanupResult(result)
  }

  async cleanupExpiredTrash(
    options: MediaReconciliationBatchOptions = {},
  ): Promise<MediaReconciliationCleanupResult> {
    const batchSize = requireBatchSize(options.batchSize)
    const timeBudgetMs = requireTimeBudget(options.timeBudgetMs)
    const startedAt = this.dependencies.monotonicNow()
    const now = this.dependencies.now()
    const excludedAssetIds: string[] = []
    const result = emptyCleanupResult()

    while (
      result.scanned < batchSize &&
      this.dependencies.monotonicNow() - startedAt < timeBudgetMs
    ) {
      const claimed = await this.persistence.withExpiredTrashClaim(
        now,
        async (transaction, candidate) => {
          excludedAssetIds.push(candidate.id)
          return this.cleanupTrashedAsset(transaction, candidate)
        },
        [...excludedAssetIds],
      )
      if (claimed === null) break
      recordOutcome(result, claimed)
    }
    return freezeCleanupResult(result)
  }

  async dryRun(
    options: MediaReconciliationDryRunOptions = {},
  ): Promise<MediaReconciliationDryRunResult> {
    const batchSize = requireBatchSize(options.batchSize)
    const timeBudgetMs = requireTimeBudget(options.timeBudgetMs)
    return runMediaReconciliationDryRun(this.persistence, this.storage, {
      batchSize,
      maxBatches: options.maxBatches,
      monotonicNow: this.dependencies.monotonicNow,
      timeBudgetMs,
    })
  }

  private async cleanupExpiredUpload(
    transaction: Prisma.TransactionClient,
    candidate: ReconciliationAssetRecord,
    now: Date,
  ): Promise<CleanupOutcome> {
    try {
      if (
        candidate.status !== MediaAssetStatus.UPLOADING &&
        candidate.status !== MediaAssetStatus.FAILED
      ) {
        return 'ISOLATED'
      }
      if (await this.references.hasActiveReferences(transaction, candidate.id)) {
        return 'ISOLATED'
      }
      if ((candidate.objectKey === null) !== (candidate.sizeBytes === null)) {
        return 'ISOLATED'
      }

      const stagingObjects = await this.readStagingObjects(candidate.id)
      const managedKeys = stagingObjects.map(object => object.key)
      if (candidate.objectKey !== null && candidate.sizeBytes !== null) {
        const trashKey = trashKeyFor(candidate.objectKey)
        const [activeStat, trashStat] = await Promise.all([
          this.storage.stat(candidate.objectKey),
          this.storage.stat(trashKey),
        ])
        if (
          (activeStat !== null && !exactSize(activeStat, candidate.sizeBytes)) ||
          (trashStat !== null && !exactSize(trashStat, candidate.sizeBytes))
        ) {
          return 'ISOLATED'
        }
        managedKeys.push(candidate.objectKey, trashKey)
      }

      for (const key of managedKeys) await this.storage.purge(key)
      const transition: ExpiredAssetTransition = {
        id: candidate.id,
        status: candidate.status,
      }
      return await this.persistence.markExpiredPurged(transaction, transition, now)
        ? 'COMPLETED'
        : 'FAILED'
    }
    catch {
      return 'FAILED'
    }
  }

  private async cleanupTrashedAsset(
    transaction: Prisma.TransactionClient,
    candidate: ReconciliationAssetRecord,
  ): Promise<CleanupOutcome> {
    try {
      if (
        candidate.status !== MediaAssetStatus.TRASHED ||
        candidate.objectKey === null ||
        candidate.sizeBytes === null
      ) {
        return 'ISOLATED'
      }
      if (await this.references.hasActiveReferences(transaction, candidate.id)) {
        return 'ISOLATED'
      }

      const trashKey = trashKeyFor(candidate.objectKey)
      const [activeStat, trashStat] = await Promise.all([
        this.storage.stat(candidate.objectKey),
        this.storage.stat(trashKey),
      ])
      if (
        (activeStat !== null && !exactSize(activeStat, candidate.sizeBytes)) ||
        (trashStat !== null && !exactSize(trashStat, candidate.sizeBytes)) ||
        (activeStat === null && trashStat === null) ||
        (activeStat !== null && trashStat !== null)
      ) {
        return 'ISOLATED'
      }

      await this.storage.purge(activeStat === null ? trashKey : candidate.objectKey)
      return await this.persistence.markTrashPurged(transaction, candidate.id)
        ? 'COMPLETED'
        : 'FAILED'
    }
    catch {
      return 'FAILED'
    }
  }

  private async readStagingObjects(
    assetId: string,
  ): Promise<readonly StoredObjectInventoryEntry[]> {
    const objects: StoredObjectInventoryEntry[] = []
    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < MAX_STAGING_PAGES_PER_ASSET; pageIndex += 1) {
      const page = await this.storage.inventory({
        ...(cursor === undefined ? {} : { cursor }),
        limit: INVENTORY_PAGE_SIZE,
        namespace: 'staging',
        prefix: `staging/${assetId}.`,
      })
      objects.push(...page.objects)
      if (page.nextCursor === null) return objects
      cursor = page.nextCursor
    }
    throw new Error('Media reconciliation staging inventory is too large')
  }

}
