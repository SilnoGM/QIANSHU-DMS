import type { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type { MediaStorage, StoredObjectStat } from './media-storage'
import { requireMediaObjectKeyNamespace } from './media-storage'
import type { MediaAssetReferenceRepository } from './media-reference.repository'
import type { MediaReconciliationPersistence } from './media-reconciliation.persistence'

export type MediaAssetRetentionResult =
  | 'ACTIVE_REFERENCE'
  | 'ISOLATED'
  | 'NOT_ELIGIBLE'
  | 'RESTORED'
  | 'STATE_CONFLICT'
  | 'TRASHED'

interface MediaRetentionConfiguration {
  readonly trashRetentionDays: number
}

interface MediaRetentionDependencies {
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: MediaRetentionDependencies = {
  now: () => new Date(),
}

export function trashKeyFor(objectKey: string): string {
  const assetKey = requireMediaObjectKeyNamespace(objectKey, 'assets')
  return requireMediaObjectKeyNamespace(
    `trash/${assetKey.slice('assets/'.length)}`,
    'trash',
  )
}

function hasExpectedSize(
  value: StoredObjectStat | null,
  expected: bigint,
): boolean {
  return value !== null && value.sizeBytes === expected
}

/**
 * ProductMedia 调用方必须先锁 Product，再调用本服务锁 MediaAsset；服务内部随后查询全部显式引用。
 * 该顺序与清理 worker 保持一致，禁止持有 MediaAsset 后反向等待 Product。
 */
export class MediaAssetRetentionService {
  private readonly dependencies: MediaRetentionDependencies

  constructor(
    private readonly persistence: MediaReconciliationPersistence,
    private readonly references: MediaAssetReferenceRepository,
    private readonly storage: MediaStorage,
    private readonly configuration: MediaRetentionConfiguration,
    dependencyOverrides: Partial<MediaRetentionDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async trashIfUnreferenced(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<MediaAssetRetentionResult> {
    const asset = await this.persistence.lockAsset(transaction, assetId)
    if (
      !asset ||
      asset.status !== MediaAssetStatus.READY ||
      asset.objectKey === null ||
      asset.sizeBytes === null
    ) {
      return 'NOT_ELIGIBLE'
    }
    if (await this.references.hasActiveReferences(transaction, assetId)) {
      return 'ACTIVE_REFERENCE'
    }

    const trashKey = trashKeyFor(asset.objectKey)
    const [activeStat, trashStat] = await Promise.all([
      this.storage.stat(asset.objectKey),
      this.storage.stat(trashKey),
    ])
    if (
      (activeStat !== null && !hasExpectedSize(activeStat, asset.sizeBytes)) ||
      (trashStat !== null && !hasExpectedSize(trashStat, asset.sizeBytes)) ||
      (activeStat === null && trashStat === null) ||
      (activeStat !== null && trashStat !== null)
    ) {
      return 'ISOLATED'
    }
    if (activeStat !== null) {
      await this.storage.moveToTrash(asset.objectKey, trashKey)
    }

    const now = this.dependencies.now()
    const retentionUntil = new Date(
      now.getTime() + this.configuration.trashRetentionDays * 24 * 60 * 60 * 1_000,
    )
    const changed = await this.persistence.markTrashed(
      transaction,
      assetId,
      now,
      retentionUntil,
    )
    return changed ? 'TRASHED' : 'STATE_CONFLICT'
  }

  async restoreForReference(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<MediaAssetRetentionResult> {
    const asset = await this.persistence.lockAsset(transaction, assetId)
    const now = this.dependencies.now()
    if (
      !asset ||
      asset.status !== MediaAssetStatus.TRASHED ||
      asset.objectKey === null ||
      asset.sizeBytes === null ||
      asset.retentionUntil === null ||
      asset.retentionUntil.getTime() <= now.getTime()
    ) {
      return 'NOT_ELIGIBLE'
    }

    const trashKey = trashKeyFor(asset.objectKey)
    const [activeStat, trashStat] = await Promise.all([
      this.storage.stat(asset.objectKey),
      this.storage.stat(trashKey),
    ])
    if (
      (activeStat !== null && !hasExpectedSize(activeStat, asset.sizeBytes)) ||
      (trashStat !== null && !hasExpectedSize(trashStat, asset.sizeBytes)) ||
      (activeStat === null && trashStat === null) ||
      (activeStat !== null && trashStat !== null)
    ) {
      return 'ISOLATED'
    }
    if (trashStat !== null) {
      await this.storage.restoreFromTrash(trashKey, asset.objectKey)
    }

    const changed = await this.persistence.markReadyFromTrash(transaction, assetId)
    return changed ? 'RESTORED' : 'STATE_CONFLICT'
  }
}
