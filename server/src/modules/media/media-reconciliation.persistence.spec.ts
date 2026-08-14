import type { Prisma } from '../../generated/prisma/client'
import { MediaAssetStatus } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { MediaReconciliationPersistence } from './media-reconciliation.persistence'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const NOW = new Date('2026-08-14T08:00:00.000Z')

function sqlText(value: unknown): string {
  return (value as { strings: readonly string[] }).strings.join('?')
}

describe('MediaReconciliationPersistence', () => {
  it('claims one expired UPLOADING/FAILED row with FOR UPDATE SKIP LOCKED', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{
      id: ASSET_ID,
      objectKey: null,
      sizeBytes: null,
      status: MediaAssetStatus.UPLOADING,
    }])
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(transaction)),
    } as unknown as PrismaService
    const persistence = new MediaReconciliationPersistence(prisma)
    const operation = jest.fn().mockResolvedValue('handled')

    await expect(
      persistence.withExpiredUploadClaim(NOW, operation),
    ).resolves.toBe('handled')

    const calls = queryRaw.mock.calls as unknown as [[unknown]]
    const text = sqlText(calls[0][0])
    expect(text).toContain(`"status" IN ('UPLOADING', 'FAILED')`)
    expect(text).toContain('FOR UPDATE SKIP LOCKED')
    expect(text).toContain('LIMIT 1')
    expect(operation).toHaveBeenCalledWith(transaction, expect.objectContaining({ id: ASSET_ID }))
  })

  it('converges expired UPLOADING through FAILED before PURGED with old-state conditions', async () => {
    const updateMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    const transaction = {
      mediaAsset: { updateMany },
    } as unknown as Prisma.TransactionClient
    const persistence = new MediaReconciliationPersistence({} as PrismaService)

    await expect(persistence.markExpiredPurged(
      transaction,
      { id: ASSET_ID, status: MediaAssetStatus.UPLOADING },
      NOW,
    )).resolves.toBe(true)

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: ASSET_ID, status: MediaAssetStatus.UPLOADING },
      data: {
        failureCode: 'MEDIA_ASSET_UPLOAD_EXPIRED',
        status: MediaAssetStatus.FAILED,
      },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: ASSET_ID, status: MediaAssetStatus.FAILED },
      data: {
        deletedAt: NOW,
        retentionUntil: null,
        status: MediaAssetStatus.PURGED,
        uploadExpiresAt: null,
      },
    })
  })

  it('claims retention-expired TRASHED rows independently of upload cleanup', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(transaction)),
    } as unknown as PrismaService

    await new MediaReconciliationPersistence(prisma).withExpiredTrashClaim(
      NOW,
      jest.fn(),
    )

    const calls = queryRaw.mock.calls as unknown as [[unknown]]
    const text = sqlText(calls[0][0])
    expect(text).toContain(`"status" = 'TRASHED'`)
    expect(text).toContain('"retention_until" <=')
    expect(text).toContain('FOR UPDATE SKIP LOCKED')
  })

  it('parameterizes bounded exclusions so one isolated row cannot starve the batch', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(transaction)),
    } as unknown as PrismaService

    await new MediaReconciliationPersistence(prisma).withExpiredUploadClaim(
      NOW,
      jest.fn(),
      [ASSET_ID],
    )

    const calls = queryRaw.mock.calls as unknown as [[{
      strings: readonly string[]
      values: readonly unknown[]
    }]]
    expect(calls[0][0].strings.join('?')).toContain('"id" NOT IN')
    expect(calls[0][0].strings.join('?')).not.toContain(ASSET_ID)
    expect(calls[0][0].values).toEqual(expect.arrayContaining([ASSET_ID]))
  })

  it('locks one MediaAsset before reference checks and state changes', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient

    await new MediaReconciliationPersistence({} as PrismaService).lockAsset(
      transaction,
      ASSET_ID,
    )

    const calls = queryRaw.mock.calls as unknown as [[{
      strings: readonly string[]
      values: readonly unknown[]
    }]]
    expect(calls[0][0].strings.join('?')).toContain('FOR UPDATE')
    expect(calls[0][0].strings.join('?')).not.toContain(ASSET_ID)
    expect(calls[0][0].values).toEqual([ASSET_ID])
  })

  it('pages database inventory and resolves bounded storage asset identifiers', async () => {
    const first = {
      id: ASSET_ID,
      objectKey: null,
      retentionUntil: null,
      sizeBytes: null,
      status: MediaAssetStatus.UPLOADING,
    }
    const second = { ...first, id: '00000000-0000-4000-8000-000000000322' }
    const findMany = jest.fn()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first])
    const prisma = { mediaAsset: { findMany } } as unknown as PrismaService
    const persistence = new MediaReconciliationPersistence(prisma)

    await expect(persistence.listAssets(undefined, 1)).resolves.toEqual({
      nextCursor: ASSET_ID,
      records: [first],
    })
    await expect(persistence.readAssetsByIds([ASSET_ID])).resolves.toEqual([first])

    expect(findMany).toHaveBeenNthCalledWith(1, {
      orderBy: { id: 'asc' },
      select: {
        id: true,
        objectKey: true,
        retentionUntil: true,
        sizeBytes: true,
        status: true,
      },
      take: 2,
      where: undefined,
    })
    expect(findMany).toHaveBeenNthCalledWith(2, {
      select: {
        id: true,
        objectKey: true,
        retentionUntil: true,
        sizeBytes: true,
        status: true,
      },
      where: { id: { in: [ASSET_ID] } },
    })
  })
})
