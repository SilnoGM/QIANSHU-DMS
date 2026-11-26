/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import { ApiException } from '../../../infrastructure/http/api.exception'
import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { SystemNotificationService } from '../../notifications/system-notification.service'
import type { PurchaseOrderImageDraftService } from '../order-images/purchase-order-image-draft.service'
import type { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import type { PurchaseOrderQueryService } from '../purchase-order-query.service'
import { PurchaseAutoReviewScanService } from './purchase-auto-review-scan.service'
import type { PurchaseAutoReviewService } from './purchase-auto-review.service'

const NOW = new Date('2026-11-26T03:00:00.000Z')
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const JOB_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const PENDING_ORDER = {
  orderStatus: 'PENDING_REVIEW',
  fulfillmentStatus: 'ORDERED',
  purchaseType: 'SALES_LINKED',
  productMode: 'CATALOG',
  shippingMarkText: null,
  shippingMarkIssuanceId: null,
  salesOrder: { orderStatus: 'CONFIRMED' },
  _count: { parts: 1 },
  documents: [],
}

const DETAIL = {
  id: ORDER_ID,
  orderNo: 'PO/20261126-0001',
  version: 1,
  orderStatus: 'PENDING_REVIEW',
  purchaseTotalAmount: '100.00',
  currencyCode: 'CNY',
  customerName: '陈先生',
  partCount: 1,
  supplier: { label: '测试供应商' },
  lineSummary: { lineCount: 1 },
}

function harness(options: {
  readonly enabled?: boolean
  readonly due?: readonly { id: string, purchaseOrderId: string, attempts: number }[]
  readonly order?: Record<string, unknown> | null
  readonly orderLookups?: readonly (Record<string, unknown> | null)[]
} = {}) {
  const claims = options.due ?? [{ id: JOB_ID, purchaseOrderId: ORDER_ID, attempts: 1 }]
  const orders = options.orderLookups ?? [options.order ?? PENDING_ORDER]
  const orderMock = jest.fn()
  for (const row of orders) orderMock.mockResolvedValueOnce(row)
  orderMock.mockResolvedValue(orders[orders.length - 1] ?? null)

  const job = {
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrderAutoReviewJob: { update: jest.fn().mockResolvedValue({}) },
  }
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(claims),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)),
    purchaseOrder: { findUnique: orderMock },
    purchaseOrderAutoReviewJob: job,
  }
  const autoReview = {
    read: jest.fn().mockResolvedValue({
      enabled: options.enabled ?? true,
      version: 1,
      updatedAt: NOW.toISOString(),
      updatedBy: null,
      lastScanAt: null,
      pendingJobCount: 0,
      failedJobCount: 0,
    }),
    isEnabled: jest.fn().mockResolvedValue(options.enabled ?? true),
    enqueueForOrder: jest.fn().mockResolvedValue(undefined),
    touchLastScan: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(),
  }
  const query = { getById: jest.fn().mockResolvedValue(DETAIL) }
  const mutations = {
    prepareReviewShippingMarks: jest.fn().mockResolvedValue({ ...DETAIL, version: 2 }),
    review: jest.fn().mockResolvedValue({ ...DETAIL, version: 3 }),
  }
  const imageDrafts = { generate: jest.fn().mockResolvedValue({ id: 'draft-1' }) }
  const notifications = { publish: jest.fn().mockResolvedValue({}) }
  const audit = { record: jest.fn().mockResolvedValue({}) }

  return {
    audit,
    autoReview,
    imageDrafts,
    job,
    mutations,
    notifications,
    prisma,
    query,
    service: new PurchaseAutoReviewScanService(
      prisma as unknown as PrismaService,
      autoReview as unknown as PurchaseAutoReviewService,
      query as unknown as PurchaseOrderQueryService,
      mutations as unknown as PurchaseOrderMutationService,
      imageDrafts as unknown as PurchaseOrderImageDraftService,
      notifications as unknown as SystemNotificationService,
      audit,
    ),
    transaction,
  }
}

describe('PurchaseAutoReviewScanService', () => {
  it('cancels pending jobs and writes a heartbeat when the setting is off', async () => {
    const fixture = harness({ enabled: false })
    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ enabled: false, claimed: 0, cancelled: 0 })
    expect(fixture.job.updateMany).toHaveBeenCalledWith({
      where: { state: 'PENDING' },
      data: { state: 'CANCELLED', completedAt: NOW, leaseExpiresAt: null },
    })
    expect(fixture.autoReview.touchLastScan).toHaveBeenCalledWith(NOW)
    expect(fixture.prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('lists due jobs without claiming them in dry-run mode', async () => {
    const fixture = harness()
    const result = await fixture.service.run({ dryRun: true, now: () => NOW })

    expect(result.candidates).toEqual([ORDER_ID])
    expect(fixture.job.update).not.toHaveBeenCalled()
    expect(fixture.autoReview.touchLastScan).not.toHaveBeenCalled()
  })

  it('runs the three review steps and marks the job succeeded', async () => {
    const fixture = harness()
    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, retried: 0 })
    expect(fixture.mutations.prepareReviewShippingMarks).toHaveBeenCalledWith(
      { actorUserId: '00000000-0000-4000-8000-000000002449', requestId: JOB_ID },
      ORDER_ID,
      { expectedVersion: 1 },
    )
    expect(fixture.imageDrafts.generate).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: '00000000-0000-4000-8000-000000002449' }),
      ORDER_ID,
      { expectedVersion: 2, regenerate: false },
    )
    expect(fixture.mutations.review).toHaveBeenCalledWith(
      expect.any(Object),
      ORDER_ID,
      { expectedVersion: 2, imageDraftId: 'draft-1', reason: '系统自动托管审核通过' },
    )
    expect(fixture.job.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: {
        state: 'SUCCEEDED',
        completedAt: NOW,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    })
    expect(fixture.autoReview.touchLastScan).toHaveBeenCalledWith(NOW)
  })

  it('treats an order reviewed by a human as succeeded without calling the pipeline', async () => {
    const fixture = harness({ order: { ...PENDING_ORDER, orderStatus: 'CONFIRMED' } })
    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ succeeded: 1 })
    expect(fixture.mutations.prepareReviewShippingMarks).not.toHaveBeenCalled()
    expect(fixture.job.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'SUCCEEDED' }),
    }))
  })

  it('marks a cancelled order as cancelled', async () => {
    const fixture = harness({ order: { ...PENDING_ORDER, orderStatus: 'CANCELLED' } })
    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ cancelled: 1 })
    expect(fixture.job.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'CANCELLED' }),
    }))
  })

  it('schedules a retry for a transient failure', async () => {
    const fixture = harness()
    fixture.mutations.prepareReviewShippingMarks.mockRejectedValue(
      new ApiException(409, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单依赖状态已变化，请重试'),
    )

    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ retried: 1, failed: 0, notificationFailed: 0 })
    expect(fixture.job.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: {
        state: 'PENDING',
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        leaseExpiresAt: null,
        lastErrorCode: 'PURCHASE_ORDER_STATE_CHANGED',
        lastErrorMessage: '采购订单依赖状态已变化，请重试',
      },
    })
    expect(fixture.notifications.publish).not.toHaveBeenCalled()
  })

  it('fails the job, audits it and notifies reviewers when retries are exhausted', async () => {
    const fixture = harness({ due: [{ id: JOB_ID, purchaseOrderId: ORDER_ID, attempts: 4 }] })
    fixture.imageDrafts.generate.mockRejectedValue(
      new ApiException(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体存储暂不可用'),
    )

    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ failed: 1, retried: 0 })
    expect(fixture.transaction.purchaseOrderAutoReviewJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({
        state: 'FAILED',
        completedAt: NOW,
        lastErrorCode: 'MEDIA_STORAGE_UNAVAILABLE',
      }) as unknown,
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'PURCHASE_ORDER_AUTO_REVIEW_FAILED',
        targetId: ORDER_ID,
        reasonCode: 'MEDIA_STORAGE_UNAVAILABLE',
      }),
    )
    expect(fixture.notifications.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PURCHASE_REVIEW_PENDING',
      dedupeKey: `purchase-review:${ORDER_ID}`,
    }))
  })

  it('fails immediately for a terminal image error', async () => {
    const fixture = harness()
    fixture.imageDrafts.generate.mockRejectedValue(
      new ApiException(422, 'PURCHASE_ORDER_IMAGE_TOO_LARGE', '采购单内容超过单张图片可读尺寸'),
    )

    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ failed: 1, retried: 0 })
    expect(fixture.job.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'PENDING' }),
    }))
  })

  it('keeps the failure notification failure visible in the result', async () => {
    const fixture = harness({ due: [{ id: JOB_ID, purchaseOrderId: ORDER_ID, attempts: 4 }] })
    fixture.mutations.review.mockRejectedValue(
      new ApiException(422, 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS', '该采购订单已有有效采购单凭证'),
    )
    fixture.notifications.publish.mockRejectedValue(new Error('numbering unavailable'))

    const result = await fixture.service.run({ dryRun: false, now: () => NOW })

    expect(result).toMatchObject({ failed: 1, notificationFailed: 1 })
  })
})
