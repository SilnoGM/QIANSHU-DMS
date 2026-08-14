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
  const purge = jest.fn().mockResolvedValue(undefined)
  const stat = jest.fn().mockResolvedValue(null)
  const storage = { inventory, purge, stat } as unknown as MediaStorage
  const service = new MediaReconciliationService(
    persistence,
    references,
    storage,
    {
      monotonicNow: options.monotonicNow ?? (() => 0),
      now: () => new Date(NOW),
    },
  )

  return {
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
})
