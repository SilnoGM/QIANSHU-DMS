import { ApiException } from '../../../infrastructure/http/api.exception'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  PurchaseAutoReviewService,
  noopPurchaseAutoReview,
} from './purchase-auto-review.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTEXT = { actorUserId: ACTOR_ID, requestId: 'request-1' }

function harness(options: {
  readonly enabled?: boolean
  readonly version?: number
  readonly settingMissing?: boolean
} = {}) {
  const current = {
    enabled: options.enabled ?? false,
    version: options.version ?? 1,
  }
  const transaction = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(options.settingMissing === true ? [] : [current]),
    purchaseAutoReviewSettings: { update: jest.fn().mockResolvedValue({}) },
    purchaseOrderAutoReviewJob: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  }
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)),
    $executeRaw: jest.fn().mockResolvedValue(1),
    purchaseAutoReviewSettings: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: current.enabled,
        version: current.version,
        updatedAt: new Date('2026-11-26T02:00:00.000Z'),
        lastScanAt: new Date('2026-11-26T03:00:00.000Z'),
        updatedBy: null,
      }),
    },
    purchaseOrderAutoReviewJob: { count: jest.fn().mockResolvedValue(0) },
  }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  return {
    audit,
    prisma,
    service: new PurchaseAutoReviewService(prisma as unknown as PrismaService, audit),
    transaction,
  }
}

describe('PurchaseAutoReviewService', () => {
  it('reports the current setting with job counts', async () => {
    const fixture = harness({ enabled: true, version: 3 })
    fixture.prisma.purchaseOrderAutoReviewJob.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)

    await expect(fixture.service.read()).resolves.toEqual({
      enabled: true,
      version: 3,
      updatedAt: '2026-11-26T02:00:00.000Z',
      updatedBy: null,
      lastScanAt: '2026-11-26T03:00:00.000Z',
      pendingJobCount: 2,
      failedJobCount: 1,
    })
  })

  it('treats a missing setting row as disabled', async () => {
    const fixture = harness()
    fixture.prisma.purchaseAutoReviewSettings.findUnique.mockResolvedValue(null)
    await expect(fixture.service.isEnabled()).resolves.toBe(false)
  })

  it('rejects an outdated setting version', async () => {
    const fixture = harness({ enabled: false, version: 2 })
    await expect(fixture.service.update(CONTEXT, { enabled: true, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_AUTO_REVIEW_STATE_CHANGED' })
    expect(fixture.transaction.purchaseAutoReviewSettings.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('enables the setting, bumps the version and writes an audit event', async () => {
    const fixture = harness({ enabled: false, version: 1 })
    await fixture.service.update(CONTEXT, { enabled: true, expectedVersion: 1 })

    expect(fixture.transaction.purchaseAutoReviewSettings.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: {
        enabled: true,
        version: { increment: 1 },
        updatedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.transaction.purchaseOrderAutoReviewJob.updateMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'PURCHASE_AUTO_REVIEW_SETTING_UPDATED',
        actorUserId: ACTOR_ID,
        metadata: { enabled: true, previousEnabled: false },
      }),
    )
  })

  it('cancels pending jobs when the setting is disabled', async () => {
    const fixture = harness({ enabled: true, version: 4 })
    await fixture.service.update(CONTEXT, { enabled: false, expectedVersion: 4 })

    expect(fixture.transaction.purchaseOrderAutoReviewJob.updateMany).toHaveBeenCalledWith({
      where: { state: 'PENDING' },
      data: {
        state: 'CANCELLED',
        completedAt: expect.any(Date) as unknown,
        leaseExpiresAt: null,
      },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ metadata: { enabled: false, previousEnabled: true } }),
    )
  })

  it('does not bump the version or write an audit event for an unchanged value', async () => {
    const fixture = harness({ enabled: true, version: 2 })
    await fixture.service.update(CONTEXT, { enabled: true, expectedVersion: 2 })
    expect(fixture.transaction.purchaseAutoReviewSettings.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it.each([
    [null],
    [[]],
    [{ enabled: 'yes', expectedVersion: 1 }],
    [{ enabled: true }],
    [{ enabled: true, expectedVersion: 0 }],
    [{ enabled: true, expectedVersion: 1, extra: 1 }],
  ])('rejects invalid input %p', async input => {
    const fixture = harness()
    await expect(fixture.service.update(CONTEXT, input))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects a non-canonical actor context', async () => {
    const fixture = harness()
    await expect(fixture.service.update(
      { actorUserId: 'not-a-uuid', requestId: 'request-1' },
      { enabled: true, expectedVersion: 1 },
    )).rejects.toBeInstanceOf(ApiException)
  })

  it('provides a no-op gateway for directly constructed services', async () => {
    await expect(noopPurchaseAutoReview.isEnabled()).resolves.toBe(false)
    await expect(noopPurchaseAutoReview.enqueueForOrder({} as never, 'order')).resolves.toBeUndefined()
  })
})
