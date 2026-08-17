import type { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type { MediaStorage } from './media-storage'
import type { MediaAssetReferenceRepository } from './media-reference.repository'
import type { MediaReconciliationPersistence } from './media-reconciliation.persistence'
import { MediaAssetRetentionService } from './media-retention.service'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const NOW = new Date('2026-08-14T08:00:00.000Z')
const RETENTION_UNTIL = new Date('2026-08-21T08:00:00.000Z')
const OBJECT_KEY = `assets/2026/08/${ASSET_ID}.webp`
const TRASH_KEY = `trash/2026/08/${ASSET_ID}.webp`

function createFixture(overrides: {
  readonly referenced?: boolean
  readonly status?: MediaAssetStatus
} = {}) {
  const events: string[] = []
  const status = overrides.status ?? MediaAssetStatus.READY
  const lockAsset = jest.fn().mockImplementation(() => {
    events.push('lock-asset')
    return Promise.resolve({
      id: ASSET_ID,
      objectKey: OBJECT_KEY,
      retentionUntil: status === MediaAssetStatus.TRASHED ? RETENTION_UNTIL : null,
      sizeBytes: 321n,
      status,
    })
  })
  const markTrashed = jest.fn().mockImplementation(() => {
    events.push('mark-trashed')
    return Promise.resolve(true)
  })
  const markReady = jest.fn().mockImplementation(() => {
    events.push('mark-ready')
    return Promise.resolve(true)
  })
  const hasActiveReferences = jest.fn().mockImplementation(() => {
    events.push('check-references')
    return Promise.resolve(overrides.referenced ?? false)
  })
  const stat = jest.fn().mockImplementation((key: string) => {
    events.push(`stat:${key.startsWith('assets/') ? 'assets' : 'trash'}`)
    if (status === MediaAssetStatus.TRASHED) {
      return Promise.resolve(key === TRASH_KEY ? { modifiedAt: NOW, sizeBytes: 321n } : null)
    }
    return Promise.resolve(key === OBJECT_KEY ? { modifiedAt: NOW, sizeBytes: 321n } : null)
  })
  const moveToTrash = jest.fn().mockImplementation(() => {
    events.push('move-to-trash')
    return Promise.resolve()
  })
  const restoreFromTrash = jest.fn().mockImplementation(() => {
    events.push('restore-from-trash')
    return Promise.resolve()
  })

  const persistence = {
    lockAsset,
    markReadyFromTrash: markReady,
    markTrashed,
  } as unknown as MediaReconciliationPersistence
  const references = { hasActiveReferences } as unknown as MediaAssetReferenceRepository
  const storage = {
    moveToTrash,
    restoreFromTrash,
    stat,
  } as unknown as MediaStorage
  const service = new MediaAssetRetentionService(
    persistence,
    references,
    storage,
    { trashRetentionDays: 7 },
    { now: () => new Date(NOW) },
  )

  return {
    events,
    hasActiveReferences,
    markReady,
    markTrashed,
    moveToTrash,
    persistence,
    references,
    restoreFromTrash,
    service,
    stat,
    storage,
  }
}

describe('MediaAssetRetentionService', () => {
  const transaction = {} as Prisma.TransactionClient

  it('locks MediaAsset, checks all references, moves content and starts seven-day retention', async () => {
    const fixture = createFixture()

    await expect(
      fixture.service.trashIfUnreferenced(transaction, ASSET_ID),
    ).resolves.toBe('TRASHED')

    expect(fixture.events).toEqual([
      'lock-asset',
      'check-references',
      'stat:assets',
      'stat:trash',
      'move-to-trash',
      'mark-trashed',
    ])
    expect(fixture.moveToTrash).toHaveBeenCalledWith(OBJECT_KEY, TRASH_KEY)
    expect(fixture.markTrashed).toHaveBeenCalledWith(
      transaction,
      ASSET_ID,
      NOW,
      RETENTION_UNTIL,
    )
  })

  it('does not touch storage or state while any active reference remains', async () => {
    const fixture = createFixture({ referenced: true })

    await expect(
      fixture.service.trashIfUnreferenced(transaction, ASSET_ID),
    ).resolves.toBe('ACTIVE_REFERENCE')
    expect(fixture.events).toEqual(['lock-asset', 'check-references'])
    expect(fixture.markTrashed).not.toHaveBeenCalled()
  })

  it('restores a retained TRASHED asset before READY and leaves association creation to the caller', async () => {
    const fixture = createFixture({ status: MediaAssetStatus.TRASHED })

    await expect(
      fixture.service.restoreForReference(transaction, ASSET_ID),
    ).resolves.toBe('RESTORED')

    expect(fixture.events).toEqual([
      'lock-asset',
      'stat:assets',
      'stat:trash',
      'restore-from-trash',
      'mark-ready',
    ])
    expect(fixture.restoreFromTrash).toHaveBeenCalledWith(TRASH_KEY, OBJECT_KEY)
    expect(fixture.markReady).toHaveBeenCalledWith(transaction, ASSET_ID)
  })

  it('isolates a size mismatch without moving content or changing database state', async () => {
    const fixture = createFixture()
    fixture.stat.mockResolvedValueOnce({ modifiedAt: NOW, sizeBytes: 999n })

    await expect(
      fixture.service.trashIfUnreferenced(transaction, ASSET_ID),
    ).resolves.toBe('ISOLATED')
    expect(fixture.moveToTrash).not.toHaveBeenCalled()
    expect(fixture.markTrashed).not.toHaveBeenCalled()
  })

  it('does not restore at or after the retention deadline', async () => {
    const fixture = createFixture({ status: MediaAssetStatus.TRASHED })
    const expiredService = new MediaAssetRetentionService(
      fixture.persistence,
      fixture.references,
      fixture.storage,
      { trashRetentionDays: 7 },
      { now: () => new Date(RETENTION_UNTIL) },
    )
    await expect(expiredService.restoreForReference(transaction, ASSET_ID)).resolves.toBe(
      'NOT_ELIGIBLE',
    )
    expect(fixture.stat).not.toHaveBeenCalled()
  })
})
