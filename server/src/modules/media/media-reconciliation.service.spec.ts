import type { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type { MediaStorage } from './media-storage'
import type { MediaAssetReferenceRepository } from './media-reference.repository'
import type {
  ReconciliationAssetRecord,
  MediaReconciliationPersistence,
} from './media-reconciliation.persistence'
import { MediaReconciliationService } from './media-reconciliation.service'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const UNKNOWN_ASSET_ID = '00000000-0000-4000-8000-000000000654'
const NOW = new Date('2026-08-14T08:00:00.000Z')
const OBJECT_KEY = `assets/2026/08/${ASSET_ID}.webp`
const TRASH_KEY = `trash/2026/08/${ASSET_ID}.webp`
const STAGING_KEY = `staging/${ASSET_ID}.00000000-0000-4000-8000-000000000987.part`

function asset(
  status: MediaAssetStatus,
  overrides: Partial<ReconciliationAssetRecord> = {},
): ReconciliationAssetRecord {
  return {
    checksumSha256: status === MediaAssetStatus.UPLOADING ? null : 'a'.repeat(64),
    id: ASSET_ID,
    objectKey: status === MediaAssetStatus.UPLOADING ? null : OBJECT_KEY,
    retentionUntil: status === MediaAssetStatus.TRASHED ? NOW : null,
    sizeBytes: status === MediaAssetStatus.UPLOADING ? null : 321n,
    status,
    ...overrides,
  }
}

function createFixture(options: {
  readonly monotonicNow?: () => number
  readonly uploadCandidates?: readonly ReconciliationAssetRecord[]
  readonly trashCandidates?: readonly ReconciliationAssetRecord[]
} = {}) {
  const uploadCandidates = [...(options.uploadCandidates ?? [])]
  const trashCandidates = [...(options.trashCandidates ?? [])]
  const markExpiredPurged = jest.fn().mockResolvedValue(true)
  const markTrashPurged = jest.fn().mockResolvedValue(true)
  const listAssets = jest.fn().mockResolvedValue({ nextCursor: null, records: [] })
  const readAssetsByIds = jest.fn().mockResolvedValue([])
  const transaction = {} as Prisma.TransactionClient
  const withExpiredUploadClaim = jest.fn().mockImplementation(async (
    _now: Date,
    operation: (tx: Prisma.TransactionClient, value: ReconciliationAssetRecord) => Promise<unknown>,
    excludedIds: readonly string[] = [],
  ) => {
    const candidate = uploadCandidates.find(value => !excludedIds.includes(value.id))
    return candidate ? operation(transaction, candidate) : null
  })
  const withExpiredTrashClaim = jest.fn().mockImplementation(async (
    _now: Date,
    operation: (tx: Prisma.TransactionClient, value: ReconciliationAssetRecord) => Promise<unknown>,
    excludedIds: readonly string[] = [],
  ) => {
    const candidate = trashCandidates.find(value => !excludedIds.includes(value.id))
    return candidate ? operation(transaction, candidate) : null
  })
  const persistence = {
    listAssets,
    markExpiredPurged,
    markTrashPurged,
    readAssetsByIds,
    withExpiredTrashClaim,
    withExpiredUploadClaim,
  } as unknown as MediaReconciliationPersistence
  const hasActiveReferences = jest.fn().mockResolvedValue(false)
  const references = { hasActiveReferences } as unknown as MediaAssetReferenceRepository
  const inventory = jest.fn().mockResolvedValue({ nextCursor: null, objects: [] })
  const checksumSha256 = jest.fn().mockResolvedValue('a'.repeat(64))
  const purge = jest.fn().mockResolvedValue(undefined)
  const stat = jest.fn().mockResolvedValue(null)
  const storage = {
    checksumSha256,
    inventory,
    purge,
    stat,
  } as unknown as MediaStorage
  const service = new MediaReconciliationService(
    persistence,
    references,
    storage,
    'dev',
    {
      monotonicNow: options.monotonicNow ?? (() => 0),
      now: () => new Date(NOW),
    },
  )

  return {
    checksumSha256,
    hasActiveReferences,
    inventory,
    listAssets,
    markExpiredPurged,
    markTrashPurged,
    purge,
    readAssetsByIds,
    service,
    stat,
    withExpiredTrashClaim,
    withExpiredUploadClaim,
  }
}

describe('MediaReconciliationService', () => {
  it('purges only staging objects owned by an expired unprepared upload and retains a PURGED fact', async () => {
    const fixture = createFixture({
      uploadCandidates: [asset(MediaAssetStatus.UPLOADING)],
    })
    fixture.inventory.mockResolvedValue({
      nextCursor: null,
      objects: [{ key: STAGING_KEY, modifiedAt: NOW, sizeBytes: 123n }],
    })

    await expect(fixture.service.cleanupExpiredUploads({ batchSize: 10 })).resolves.toEqual({
      completed: 1,
      failed: 0,
      isolated: 0,
      scanned: 1,
    })

    expect(fixture.inventory).toHaveBeenCalledWith({
      limit: 100,
      namespace: 'staging',
      prefix: `staging/${ASSET_ID}.`,
    })
    expect(fixture.purge).toHaveBeenCalledWith(STAGING_KEY)
    expect(fixture.markExpiredPurged).toHaveBeenCalledWith(
      expect.anything(),
      { id: ASSET_ID, status: MediaAssetStatus.UPLOADING },
      NOW,
    )
  })

  it('isolates prepared final content whose size differs and performs no mutation', async () => {
    const fixture = createFixture({
      uploadCandidates: [asset(MediaAssetStatus.FAILED)],
    })
    fixture.stat.mockImplementation((key: string) => Promise.resolve(
      key === OBJECT_KEY ? { modifiedAt: NOW, sizeBytes: 999n } : null,
    ))

    await expect(fixture.service.cleanupExpiredUploads({ batchSize: 1 })).resolves.toEqual({
      completed: 0,
      failed: 0,
      isolated: 1,
      scanned: 1,
    })
    expect(fixture.purge).not.toHaveBeenCalled()
    expect(fixture.markExpiredPurged).not.toHaveBeenCalled()
  })

  it('excludes an isolated candidate and continues with the rest of the bounded batch', async () => {
    const fixture = createFixture({
      uploadCandidates: [
        asset(MediaAssetStatus.FAILED),
        asset(MediaAssetStatus.UPLOADING, { id: UNKNOWN_ASSET_ID }),
      ],
    })
    fixture.stat.mockImplementation((key: string) => Promise.resolve(
      key === OBJECT_KEY ? { modifiedAt: NOW, sizeBytes: 999n } : null,
    ))

    await expect(fixture.service.cleanupExpiredUploads({ batchSize: 2 })).resolves.toEqual({
      completed: 1,
      failed: 0,
      isolated: 1,
      scanned: 2,
    })
    expect(fixture.withExpiredUploadClaim).toHaveBeenNthCalledWith(
      2,
      NOW,
      expect.any(Function),
      [ASSET_ID],
    )
  })

  it('rechecks references after claiming TRASHED and never purges a referenced asset', async () => {
    const fixture = createFixture({
      trashCandidates: [asset(MediaAssetStatus.TRASHED)],
    })
    fixture.hasActiveReferences.mockResolvedValue(true)

    await expect(fixture.service.cleanupExpiredTrash({ batchSize: 1 })).resolves.toEqual({
      completed: 0,
      failed: 0,
      isolated: 1,
      scanned: 1,
    })
    expect(fixture.stat).not.toHaveBeenCalled()
    expect(fixture.purge).not.toHaveBeenCalled()
    expect(fixture.markTrashPurged).not.toHaveBeenCalled()
  })

  it('purges an exact retained object and conditionally transitions TRASHED to PURGED', async () => {
    const fixture = createFixture({
      trashCandidates: [asset(MediaAssetStatus.TRASHED)],
    })
    fixture.stat.mockImplementation((key: string) => Promise.resolve(
      key === TRASH_KEY ? { modifiedAt: NOW, sizeBytes: 321n } : null,
    ))

    await expect(fixture.service.cleanupExpiredTrash({ batchSize: 1 })).resolves.toMatchObject({
      completed: 1,
      isolated: 0,
    })
    expect(fixture.purge).toHaveBeenCalledTimes(1)
    expect(fixture.purge).toHaveBeenCalledWith(TRASH_KEY)
    expect(fixture.markTrashPurged).toHaveBeenCalledWith(expect.anything(), ASSET_ID)
  })

  it('allows concurrent workers to clean a claimed candidate only once', async () => {
    let claimed = false
    const fixture = createFixture()
    fixture.withExpiredUploadClaim.mockImplementation(async (
      _now: Date,
      operation: (
        tx: Prisma.TransactionClient,
        value: ReconciliationAssetRecord,
      ) => Promise<unknown>,
    ) => {
      if (claimed) return null
      claimed = true
      return operation({} as Prisma.TransactionClient, asset(MediaAssetStatus.UPLOADING))
    })

    const results = await Promise.all([
      fixture.service.cleanupExpiredUploads({ batchSize: 1 }),
      fixture.service.cleanupExpiredUploads({ batchSize: 1 }),
    ])

    expect(results.map(result => result.completed).sort()).toEqual([0, 1])
    expect(fixture.markExpiredPurged).toHaveBeenCalledTimes(1)
  })

  it('stops before claiming another candidate after the configured time budget', async () => {
    const monotonicNow = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_001)
    const fixture = createFixture({
      monotonicNow,
      uploadCandidates: [
        asset(MediaAssetStatus.UPLOADING),
        asset(MediaAssetStatus.UPLOADING, { id: UNKNOWN_ASSET_ID }),
      ],
    })

    await expect(fixture.service.cleanupExpiredUploads({
      batchSize: 10,
      timeBudgetMs: 1_000,
    })).resolves.toMatchObject({ completed: 1, scanned: 1 })
    expect(fixture.withExpiredUploadClaim).toHaveBeenCalledTimes(1)
  })

  it('maps legacy storage objects so both layouts stay reconcilable during the migration', async () => {
    const fixture = createFixture()
    fixture.inventory.mockImplementation(({ namespace }: { namespace: string }) =>
      Promise.resolve(namespace === 'assets'
        ? {
            nextCursor: null,
            objects: [{ key: OBJECT_KEY, modifiedAt: NOW, sizeBytes: 321n }],
          }
        : { nextCursor: null, objects: [] }))
    fixture.readAssetsByIds.mockResolvedValue([asset(MediaAssetStatus.READY)])

    const result = await fixture.service.dryRun({ batchSize: 100, maxBatches: 10 })

    expect(fixture.readAssetsByIds).toHaveBeenCalledWith([ASSET_ID])
    expect(result).toMatchObject({
      matched: 1,
      issues: { orphanObject: 0, unmappableObject: 0 },
    })
  })

  it('skips objects that belong to another environment instead of counting them as issues', async () => {
    const fixture = createFixture()
    fixture.inventory.mockImplementation(({ namespace }: { namespace: string }) =>
      Promise.resolve(namespace === 'assets'
        ? {
            nextCursor: null,
            objects: [
              {
                key: `assets/dev/voucher/2026/08/${ASSET_ID}.webp`,
                modifiedAt: NOW,
                sizeBytes: 321n,
              },
              // 共桶邻居：键完全合法但不属于本环境，既不能计 orphan 也不能计 unmappable。
              {
                key: `assets/prod/voucher/2026/08/${ASSET_ID}.webp`,
                modifiedAt: NOW,
                sizeBytes: 321n,
              },
            ],
          }
        : { nextCursor: null, objects: [] }))
    fixture.readAssetsByIds.mockResolvedValue([asset(MediaAssetStatus.READY, {
      objectKey: `assets/dev/voucher/2026/08/${ASSET_ID}.webp`,
    })])

    const result = await fixture.service.dryRun({ batchSize: 100, maxBatches: 10 })

    // 只有本环境的对象进入数据库回查，另一个环境的对象被整体跳过。
    expect(fixture.readAssetsByIds).toHaveBeenCalledWith([ASSET_ID])
    expect(result).toMatchObject({
      storageScanned: 2,
      matched: 1,
      issues: { orphanObject: 0, unmappableObject: 0, unexpectedLocation: 0 },
    })
  })

  it('reports a mutation-free bounded dry run without returning identifiers or object keys', async () => {
    const fixture = createFixture()
    fixture.listAssets
      .mockResolvedValueOnce({
        nextCursor: null,
        records: [asset(MediaAssetStatus.READY)],
      })
    fixture.stat.mockImplementation((key: string) => Promise.resolve(
      key === OBJECT_KEY ? { modifiedAt: NOW, sizeBytes: 999n } : null,
    ))
    fixture.inventory.mockImplementation(({ namespace }: { namespace: string }) =>
      Promise.resolve(namespace === 'assets'
        ? {
            nextCursor: null,
            objects: [{
              key: `assets/2026/08/${UNKNOWN_ASSET_ID}.webp`,
              modifiedAt: NOW,
              sizeBytes: 1n,
            }],
          }
        : { nextCursor: null, objects: [] }))
    fixture.readAssetsByIds.mockResolvedValue([])

    const result = await fixture.service.dryRun({ batchSize: 100, maxBatches: 10 })

    expect(result).toEqual({
      complete: true,
      databaseScanned: 1,
      issues: {
        checksumMismatch: 0,
        duplicateLocation: 0,
        missing: 0,
        orphanObject: 1,
        sizeMismatch: 1,
        unexpectedLocation: 0,
        unmappableObject: 0,
      },
      matched: 0,
      storageScanned: 1,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(ASSET_ID)
    expect(serialized).not.toContain('assets/')
    expect(fixture.purge).not.toHaveBeenCalled()
    expect(fixture.markExpiredPurged).not.toHaveBeenCalled()
    expect(fixture.markTrashPurged).not.toHaveBeenCalled()
  })

  it('verifies SHA-256 after exact size and reports only a mismatch count', async () => {
    const fixture = createFixture()
    fixture.listAssets.mockResolvedValueOnce({
      nextCursor: null,
      records: [asset(MediaAssetStatus.READY)],
    })
    fixture.stat.mockImplementation((key: string) => Promise.resolve(
      key === OBJECT_KEY ? { modifiedAt: NOW, sizeBytes: 321n } : null,
    ))
    fixture.checksumSha256.mockResolvedValue('b'.repeat(64))

    const result = await fixture.service.dryRun({ batchSize: 100, maxBatches: 10 })

    expect(result.issues).toMatchObject({ checksumMismatch: 1 })
    expect(result.matched).toBe(0)
    expect(fixture.checksumSha256).toHaveBeenCalledWith(OBJECT_KEY)
    expect(JSON.stringify(result)).not.toContain(ASSET_ID)
    expect(JSON.stringify(result)).not.toContain(OBJECT_KEY)
    expect(fixture.purge).not.toHaveBeenCalled()
  })
})
