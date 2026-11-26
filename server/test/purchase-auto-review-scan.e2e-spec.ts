import { randomUUID } from 'node:crypto'

import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import type { SystemNotificationService } from '../src/modules/notifications/system-notification.service'
import { PURCHASE_AUTO_REVIEW_ACTOR_ID } from '../src/modules/purchase-orders/auto-review/purchase-auto-review.constants'
import { PurchaseAutoReviewScanService } from '../src/modules/purchase-orders/auto-review/purchase-auto-review-scan.service'
import { PurchaseAutoReviewService } from '../src/modules/purchase-orders/auto-review/purchase-auto-review.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import {
  createAtomicityFixture,
  createCommands,
  createReviewMutations,
  customInput,
  prepareImageReview,
  type AtomicityFixture,
} from './purchase-shipping-mark-atomicity.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { createImageReviewService } from './purchase-order-image-review.fixture'

async function withFixture(action: (fixture: AtomicityFixture) => Promise<void>) {
  const fixture = await createAtomicityFixture()
  try { await action(fixture) }
  finally { jest.restoreAllMocks(); await fixture.dispose() }
}

function createScanService(
  fixture: AtomicityFixture,
  notifications: { publish: jest.Mock },
) {
  const query = new PurchaseOrderQueryService(
    fixture.prisma,
    new DictionaryLookupService(fixture.prisma),
    createPaymentRecipientFixture(fixture.prisma),
  )
  return new PurchaseAutoReviewScanService(
    fixture.prisma,
    new PurchaseAutoReviewService(fixture.prisma, fixture.audit),
    query,
    createReviewMutations(fixture),
    createImageReviewService(fixture.prisma, query, fixture.audit),
    notifications as unknown as SystemNotificationService,
    fixture.audit,
  )
}

async function enableAutoReview(fixture: AtomicityFixture): Promise<void> {
  await new PurchaseAutoReviewService(fixture.prisma, fixture.audit).update(
    { actorUserId: fixture.actor.id, requestId: randomUUID() },
    { enabled: true, expectedVersion: 1 },
  )
}

function createNotifications() {
  return {
    publish: jest.fn().mockResolvedValue({
      notificationId: randomUUID(), duplicated: false, channels: [], warnings: [],
    }),
  }
}

describe('purchase auto review scan with isolated PostgreSQL', () => {
  jest.setTimeout(90_000)

  it('prepares marks, reuses a matching draft, reviews the order and records an automatic audit', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      await prepareImageReview(fixture, id)
      await enableAutoReview(fixture)
      await fixture.prisma.purchaseOrderAutoReviewJob.create({ data: { purchaseOrderId: id } })
      const notifications = createNotifications()
      const now = new Date()

      const result = await createScanService(fixture, notifications).run({ dryRun: false, now: () => now })

      expect(result).toMatchObject({ enabled: true, claimed: 1, succeeded: 1, failed: 0, retried: 0 })
      const job = await fixture.prisma.purchaseOrderAutoReviewJob.findUniqueOrThrow({ where: { purchaseOrderId: id } })
      expect(job).toMatchObject({ state: 'SUCCEEDED', attempts: 1 })
      const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })
      expect(order).toMatchObject({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' })
      expect(await fixture.prisma.purchaseOrderPayable.count({ where: { purchaseOrderId: id } })).toBe(2)
      expect(await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: id }, select: { status: true } }))
        .toEqual([{ status: 'ACTIVE' }])
      expect(await fixture.prisma.purchaseOrderDocument.count({
        where: { purchaseOrderId: id, documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null },
      })).toBe(1)
      const reviewAudit = await fixture.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED', targetId: id },
      })
      expect(reviewAudit).toMatchObject({ actorUserId: PURCHASE_AUTO_REVIEW_ACTOR_ID })
      expect(reviewAudit.metadata).toMatchObject({ action: 'REVIEW', automatic: true })
      expect(notifications.publish).not.toHaveBeenCalled()
      const setting = await fixture.prisma.purchaseAutoReviewSettings.findUniqueOrThrow({ where: { id: 'default' } })
      expect(setting.lastScanAt).not.toBeNull()
    })
  })

  it('fails immediately when a purchase order voucher already exists and notifies reviewers', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      const prepared = await prepareImageReview(fixture, id)
      const draft = await fixture.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: prepared.imageDraftId } })
      await fixture.prisma.purchaseOrderDocument.create({ data: {
        purchaseOrderId: id,
        mediaAssetId: draft.mediaAssetId,
        documentType: 'ORDER_ISSUANCE_VOUCHER',
        title: '既有采购单',
        createdByUserId: fixture.actor.id,
      } })
      await enableAutoReview(fixture)
      await fixture.prisma.purchaseOrderAutoReviewJob.create({ data: { purchaseOrderId: id } })
      const notifications = createNotifications()

      const result = await createScanService(fixture, notifications).run({ dryRun: false, now: () => new Date() })

      expect(result).toMatchObject({ failed: 1, retried: 0, notificationFailed: 0 })
      const job = await fixture.prisma.purchaseOrderAutoReviewJob.findUniqueOrThrow({ where: { purchaseOrderId: id } })
      expect(job).toMatchObject({ state: 'FAILED', lastErrorCode: 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS' })
      expect(await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } }))
        .toMatchObject({ orderStatus: 'PENDING_REVIEW' })
      const failureAudit = await fixture.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'PURCHASE_ORDER_AUTO_REVIEW_FAILED', targetId: id },
      })
      expect(failureAudit).toMatchObject({ outcome: 'FAILURE', reasonCode: 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS' })
      expect(notifications.publish).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'PURCHASE_REVIEW_PENDING',
        dedupeKey: `purchase-review:${id}`,
      }))
    })
  })

  it('schedules a retry when the shipping mark rule is temporarily unavailable', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      await fixture.numberingCommands.disable(fixture.configContext, fixture.customRule.id, {
        expectedVersion: fixture.customRule.version,
      })
      await enableAutoReview(fixture)
      await fixture.prisma.purchaseOrderAutoReviewJob.create({ data: { purchaseOrderId: id } })
      const notifications = createNotifications()
      const now = new Date()

      const result = await createScanService(fixture, notifications).run({ dryRun: false, now: () => now })

      expect(result).toMatchObject({ retried: 1, failed: 0, notificationFailed: 0 })
      const job = await fixture.prisma.purchaseOrderAutoReviewJob.findUniqueOrThrow({ where: { purchaseOrderId: id } })
      expect(job).toMatchObject({
        state: 'PENDING',
        attempts: 1,
        lastErrorCode: 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE',
      })
      expect(job.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000)
      expect(await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } }))
        .toMatchObject({ orderStatus: 'PENDING_REVIEW' })
      expect(notifications.publish).not.toHaveBeenCalled()
    })
  })

  it('cancels pending jobs while the setting is off', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      await fixture.prisma.purchaseOrderAutoReviewJob.create({ data: { purchaseOrderId: id } })
      const now = new Date()

      const result = await createScanService(fixture, createNotifications()).run({ dryRun: false, now: () => now })

      expect(result).toMatchObject({ enabled: false, claimed: 0 })
      const job = await fixture.prisma.purchaseOrderAutoReviewJob.findUniqueOrThrow({ where: { purchaseOrderId: id } })
      expect(job).toMatchObject({ state: 'CANCELLED' })
      expect(job.completedAt).not.toBeNull()
    })
  })
})
