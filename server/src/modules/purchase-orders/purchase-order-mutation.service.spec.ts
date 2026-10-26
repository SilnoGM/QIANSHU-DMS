import type { PurchaseOrderImageDraftService } from './order-images/purchase-order-image-draft.service'
import { PurchaseOrderWarehouseReceiptService } from './warehouse-receipts/purchase-order-warehouse-receipt.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import type { PurchaseShippingMarkResolverService } from '../purchase-shipping-marks/purchase-shipping-mark-resolver.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import type { PurchaseOrderQueryService } from './purchase-order-query.service'
import type { SalesOrderPurchaseCoverageService } from './sales-order-purchase-coverage.service'
import { Prisma } from '../../generated/prisma/client'
import type { PurchaseOrderPaymentType } from '../../generated/prisma/enums'
import type { PreparedPayablePayment, PurchasePayableService } from './payables/purchase-payable.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SOURCE_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PAYABLE_ID = '11111111-1111-4111-8111-111111111111'
const FUND_BATCH_ID = '22222222-2222-4222-8222-222222222222'

function decimal(value: string) {
  return new Prisma.Decimal(value)
}

function preparedPayment(amount: string, replay = false, paymentType: PurchaseOrderPaymentType = 'DEPOSIT'): PreparedPayablePayment {
  return {
    replay,
    recipientSnapshot: null, recipientQrMediaAssetId: null,    amount,
    paymentId: PAYMENT_ID,
    idempotencyKeyHash: Buffer.alloc(32, 1),
    requestFingerprintHash: Buffer.alloc(32, 2),
    payable: replay ? null : {
      id: PAYABLE_ID, purchaseOrderId: ORDER_ID, paymentType,
      dueAmount: decimal(amount), accountOwnerType: 'USER', ownerUserId: ACTOR_ID,
      createdByUserId: ACTOR_ID, createdAt: new Date('2026-08-27T10:00:00Z'), closedAt: null, version: 1,
    },
  }
}

function setup() {
  const order = {
    id: ORDER_ID,
    orderNo: 'PO/20260901-00001',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    paymentStatus: 'UNPAID',
    lineSubtotalAmount: decimal('100'),
    purchaseTotalAmount: decimal('100'),
    depositDueAmount: decimal('30'),
    balanceDueAmount: decimal('70'),
    purchaseType: 'SALES_LINKED',
    salesOrderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    version: 1,
    createRequestFingerprintVersion: 'purchase-order.create.v4',
  }
  const transaction = {
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID }]),
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrder: { findUnique: jest.fn().mockResolvedValue({ orderStatus: 'CONFIRMED' }) },
    purchaseOrderPart: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{ sourceSalesOrderLineId: SOURCE_LINE_ID }]),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderAmountRevision: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderPayable: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([]),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderPayment: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ _sum: { amount: null } }),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: PAYMENT_ID }),
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: PAYMENT_ID,
        amount: decimal('30'),
        voidedAt: null,
      }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    mediaAsset: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: MEDIA_ID }),
    },
    purchaseOrderDocument: {
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'document-id' }),
    },
  }
  const prisma = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: typeof transaction) => Promise<unknown>]
    >(callback => callback(transaction)),
  }
  ;(transaction.purchaseOrder as Record<string, unknown>).findFirst = transaction.purchaseOrder.findUnique
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const dictionaryLookup = {
    requireEffectiveValue: jest.fn<Promise<unknown>, [unknown, unknown]>()
      .mockResolvedValue({
        dictionaryCode: 'payment.method',
        value: 'BANK',
        label: '银行转账',
        tone: 'DEFAULT',
      }),
  }
  const media = {
    activate: jest.fn<Promise<void>, [unknown, string]>()
      .mockResolvedValue(undefined),
  }
  const detail = { id: ORDER_ID }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const coverage = {
    advanceWhenFullyCovered:
      jest.fn<Promise<void>, [unknown, unknown]>().mockResolvedValue(undefined),
    recalculateAfterPurchaseCancellation:
      jest.fn<Promise<void>, [unknown, unknown]>().mockResolvedValue(undefined),
  }
  const numbering = {
    generateScopedInTransaction: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({
      number: 'MARK-0001', issuanceId: MEDIA_ID, ruleCode: 'CURRENT_MARK', ruleRevision: 7,
    }),
  }
  const resolver = {
    resolve: jest.fn<Promise<unknown>, [unknown, unknown, boolean]>().mockResolvedValue({
      availability: 'AVAILABLE', resolutionToken: 'b'.repeat(64), ruleCode: 'CURRENT_MARK',
    }),
  }
  const warehouseReceipts = { receiveAll: jest.fn().mockResolvedValue(detail) }
  const imageDrafts = { attachForReview: jest.fn().mockResolvedValue(undefined), invalidateForOrder: jest.fn().mockResolvedValue(undefined) }
  const payables = {
    createForReview: jest.fn<Promise<void>, Parameters<PurchasePayableService['createForReview']>>().mockResolvedValue(undefined),
    closeForCancellation: jest.fn<Promise<void>, Parameters<PurchasePayableService['closeForCancellation']>>().mockResolvedValue(undefined),
    preparePayment: jest.fn<Promise<PreparedPayablePayment>, Parameters<PurchasePayableService['preparePayment']>>()
      .mockImplementation((_tx, _context, _orderId, input) => Promise.resolve(preparedPayment(input.amount, false, input.paymentType as PurchaseOrderPaymentType))),
    postPayment: jest.fn<ReturnType<PurchasePayableService['postPayment']>, Parameters<PurchasePayableService['postPayment']>>()
      .mockImplementation((_tx, _context, prepared) => Promise.resolve({
        recipientSnapshot: {}, recipientQrMediaAssetId: null,
        id: prepared.paymentId, payableId: PAYABLE_ID, fundPostingBatchId: FUND_BATCH_ID,
        idempotencyKeyHash: prepared.idempotencyKeyHash, requestFingerprintHash: prepared.requestFingerprintHash,
      })),
    reversePayment: jest.fn<ReturnType<PurchasePayableService['reversePayment']>, Parameters<PurchasePayableService['reversePayment']>>().mockResolvedValue(null),
  }
  const service = new PurchaseOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    dictionaryLookup as unknown as DictionaryLookupService,
    media as unknown as MediaAssetService,
    query as unknown as PurchaseOrderQueryService,
    coverage as unknown as SalesOrderPurchaseCoverageService,
    numbering as unknown as NumberingGeneratorService,
    resolver as unknown as PurchaseShippingMarkResolverService,
    warehouseReceipts as unknown as PurchaseOrderWarehouseReceiptService,
    imageDrafts as unknown as PurchaseOrderImageDraftService,
    payables as unknown as PurchasePayableService,
    { now: () => new Date('2026-08-27T12:00:00.000Z') },
  )
  return {
    audit,
    coverage,
    detail,
    dictionaryLookup,
    media,
    order,
    numbering,
    resolver,
    warehouseReceipts,
    imageDrafts,
    payables,
    query,
    service,
    transaction,
  }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderMutationService', () => {
  it('requires a generated image draft before review can change any business fact', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('activates pending parts in the review transaction without changing historical marks', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    await fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, status: 'PENDING_REVIEW' },
      data: { status: 'ACTIVE' },
    })
    expect(fixture.payables.createForReview).toHaveBeenCalledWith(fixture.transaction, context, ORDER_ID)
  })

  it.each(['PENDING_REVIEW', 'CONFIRMED'])('cancels %s parts while preserving marks and allocations', async status => {
    const fixture = setup()
    fixture.order.orderStatus = status
    await fixture.service.updateOrderStatus(context, ORDER_ID, { toStatus: 'CANCELLED', reason: '采购取消' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
    expect(fixture.payables.closeForCancellation).toHaveBeenCalledWith(fixture.transaction, ORDER_ID)
  })

  it('rejects a pending review order with reason and skips sales coverage recalculation', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'

    await fixture.service.reject(context, ORDER_ID, {
      expectedVersion: 1,
      reason: '  价格需要修改 ',
    })

    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: expect.objectContaining({
        orderStatus: 'CANCELLED',
        rejectedAt: expect.any(Date) as unknown,
        rejectedByUserId: ACTOR_ID,
        rejectionReason: '价格需要修改',
        version: { increment: 1 },
      }) as Record<string, unknown>,
    })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
    expect(fixture.payables.closeForCancellation).toHaveBeenCalledWith(fixture.transaction, ORDER_ID)
    expect(fixture.imageDrafts.invalidateForOrder).toHaveBeenCalledWith(fixture.transaction, ORDER_ID)
    expect(fixture.coverage.recalculateAfterPurchaseCancellation).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dimension: 'ORDER',
        fromStatus: 'PENDING_REVIEW',
        toStatus: 'CANCELLED',
        reason: '价格需要修改',
      }) as Record<string, unknown>,
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, expect.objectContaining({
      eventType: 'PURCHASE_ORDER_REJECTED',
      metadata: expect.objectContaining({ action: 'REJECT', reason: '价格需要修改' }) as Record<string, unknown>,
    }) as Record<string, unknown>)
  })

  it('refuses rejection after review or with a stale version', async () => {
    const reviewed = setup()
    reviewed.order.orderStatus = 'CONFIRMED'
    await expect(reviewed.service.reject(context, ORDER_ID, {
      expectedVersion: 1,
      reason: '价格需要修改',
    })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(reviewed.transaction.purchaseOrder.update).not.toHaveBeenCalled()

    const stale = setup()
    stale.order.orderStatus = 'PENDING_REVIEW'
    await expect(stale.service.reject(context, ORDER_ID, {
      expectedVersion: 2,
      reason: '价格需要修改',
    })).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(stale.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('propagates payable creation failure from the review transaction before returning success', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    fixture.payables.createForReview.mockRejectedValue(new ApiException(409, 'PURCHASE_ORDER_STATE_CHANGED', '采购应付款创建失败'))
    await expect(fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(fixture.coverage.advanceWhenFullyCovered).not.toHaveBeenCalled()
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it.each([
    ['40001', 'PURCHASE_ORDER_STATE_CHANGED'],
    ['23514', 'AUDIT_WRITE_FAILED'],
  ])('preserves audit persistence %s classification during mark preparation without retrying issuance', async (code, expectedCode) => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: 'purchase-order.create.v5',
      createRequestFingerprintHash: Buffer.alloc(32, 1), productMode: 'CUSTOM', supplierValue: null,
      shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: 1 },
    })
    fixture.transaction.auditEvent.create.mockRejectedValue({
      code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: code } } },
    })
    fixture.audit.record.mockImplementation((tx, event) => new AuditService().record(
      tx as Parameters<AuditService['record']>[0], event as Parameters<AuditService['record']>[1],
    ))
    await expect(fixture.service.prepareReviewShippingMarks(context, ORDER_ID, { expectedVersion: 1 })).rejects.toMatchObject({ code: expectedCode })
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(fixture.numbering.generateScopedInTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it.each(['purchase-order.create.v5', 'purchase-order.create.v6'])('issues and persists one base mark while keeping a %s order pending review', async version => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: version,
      createRequestFingerprintHash: Buffer.alloc(32, 1), productMode: 'CUSTOM', supplierValue: null,
      shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: 1 },
    })
    await fixture.service.prepareReviewShippingMarks(context, ORDER_ID, { expectedVersion: 1 })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID }, data: {
        version: { increment: 1 },
        shippingMarkText: 'MARK-0001', shippingMarkIssuanceId: MEDIA_ID,
      },
    })
    expect(fixture.resolver.resolve).toHaveBeenCalledWith(fixture.transaction, { productMode: 'CUSTOM', supplierValue: null }, true)
    expect(fixture.numbering.generateScopedInTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.numbering.generateScopedInTransaction).toHaveBeenCalledWith(fixture.transaction, {
      ruleCode: 'CURRENT_MARK', consumerCode: 'PURCHASE_ORDER.REVIEW_SHIPPING_MARK', idempotencyKey: ORDER_ID,
      requestFingerprint: Buffer.alloc(32, 1).toString('hex'),
    })
    const sql = fixture.transaction.$executeRaw.mock.calls[0][0] as { values: unknown[], sql: string }
    expect(sql.values).toEqual([1, 'MARK-0001', 'MARK-0001', ORDER_ID])
    expect(sql.sql).toContain('greatest(2, length(part_number::text))')
    expect(fixture.transaction.$executeRaw).toHaveBeenCalledTimes(1)
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.transaction, expect.objectContaining({
      metadata: expect.objectContaining({ shippingMarkIssuanceId: MEDIA_ID, shippingMarkRuleCode: 'CURRENT_MARK', shippingMarkRevision: 7, partCount: 1 }) as unknown,
    }))
  })

  it.each([2, 1000])('uses one issuance and one bulk derived-mark update for %i parts', async count => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: 'purchase-order.create.v5',
      createRequestFingerprintHash: Buffer.alloc(32, 1), productMode: 'CATALOG', supplierValue: 'SUPPLIER_A',
      shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: count },
    })
    await fixture.service.prepareReviewShippingMarks(context, ORDER_ID, { expectedVersion: 1 })
    expect(fixture.numbering.generateScopedInTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.$executeRaw).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.$executeRaw.mock.calls[0][0]).toMatchObject({ values: [count, 'MARK-0001', 'MARK-0001', ORDER_ID] })
    expect(fixture.resolver.resolve).toHaveBeenCalledWith(fixture.transaction, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, true)
  })

  it.each(['NUMBERING_CAPACITY_EXHAUSTED', 'NUMBERING_RULE_STATE_CHANGED'] as const)('propagates %s without review writes', async code => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: 'purchase-order.create.v5',
      createRequestFingerprintHash: Buffer.alloc(32, 1), productMode: 'CUSTOM', supplierValue: null,
      shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: 1 },
    })
    fixture.numbering.generateScopedInTransaction.mockRejectedValue(new NumberingGenerationError(code))
    await expect(fixture.service.prepareReviewShippingMarks(context, ORDER_ID, { expectedVersion: 1 })).rejects.toMatchObject({
      code: code === 'NUMBERING_CAPACITY_EXHAUSTED' ? 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE' : 'PURCHASE_ORDER_STATE_CHANGED',
    })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(fixture.transaction.$executeRaw).not.toHaveBeenCalled()
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it.each(['purchase-order.create.v3', 'purchase-order.create.v4'])('preserves existing marks when reviewing %s', async version => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: version })
    await fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 })
    expect(fixture.resolver.resolve).not.toHaveBeenCalled()
    expect(fixture.numbering.generateScopedInTransaction).not.toHaveBeenCalled()
    expect(fixture.transaction.$executeRaw).not.toHaveBeenCalled()
  })
  it('propagates sales coverage failure from the review transaction without returning success', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    fixture.coverage.advanceWhenFullyCovered.mockRejectedValue(
      new ApiException(409, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单依赖状态已变化，请重试'),
    )
    await expect(fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })
  it('reviews a pending order once, records both dimensions and advances sales after the update', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    fixture.transaction.purchaseOrder.findUnique
      .mockResolvedValueOnce({ ...fixture.order })
      .mockResolvedValueOnce({ ...fixture.order })
      .mockResolvedValue({ ...fixture.order, orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: 2 })

    await expect(fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID,
      expectedVersion: 1, reason: ' 核对通过 ',
    })).resolves.toEqual(fixture.detail)

    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: { increment: 1 } },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create.mock.calls).toEqual([
      [{ data: { purchaseOrderId: ORDER_ID, dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', reason: '核对通过', changedByUserId: ACTOR_ID } }],
      [{ data: { purchaseOrderId: ORDER_ID, dimension: 'FULFILLMENT', fromStatus: 'ORDERED', toStatus: 'PREPARING', reason: '核对通过', changedByUserId: ACTOR_ID } }],
    ])
    expect(fixture.audit.record).toHaveBeenCalledTimes(2)
    expect(fixture.audit.record.mock.calls).toEqual(expect.arrayContaining([
      [fixture.transaction, expect.objectContaining({ eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED', metadata: { action: 'REVIEW', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', imageDraftId: MEDIA_ID } })],
      [fixture.transaction, expect.objectContaining({ eventType: 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED', metadata: { action: 'REVIEW', fromStatus: 'ORDERED', toStatus: 'PREPARING', imageDraftId: MEDIA_ID } })],
    ]))
    expect(fixture.coverage.advanceWhenFullyCovered).toHaveBeenCalledWith(fixture.transaction, {
      actorUserId: ACTOR_ID, purchaseOrderId: ORDER_ID, purchaseOrderNo: fixture.order.orderNo,
      requestId: context.requestId, salesOrderId: fixture.order.salesOrderId,
    })
    expect(fixture.transaction.purchaseOrder.update.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.coverage.advanceWhenFullyCovered.mock.invocationCallOrder[0] ?? 0,
    )
    await expect(fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledTimes(2)
    expect(fixture.coverage.advanceWhenFullyCovered).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['PENDING_REVIEW', 'ORDERED', 2],
    ['PENDING_REVIEW', 'PREPARING', 1],
    ['CONFIRMED', 'PREPARING', 1],
    ['CANCELLED', 'ORDERED', 1],
    ['COMPLETED', 'SIGNED', 1],
  ])('rejects stale or non-reviewable %s/%s v%s without writes', async (orderStatus, fulfillmentStatus, version) => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, orderStatus, fulfillmentStatus, version })
    await expect(fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
    expect(fixture.coverage.advanceWhenFullyCovered).not.toHaveBeenCalled()
  })

  it('reviews stock orders without sales coverage and leaves payment status unchanged', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', purchaseType: 'STOCK', salesOrderId: null,
      paymentStatus: 'PAID', purchaseTotalAmount: decimal('0'),
    })
    await fixture.service.review(context, ORDER_ID, { imageDraftId: MEDIA_ID, expectedVersion: 1 })
    expect(fixture.coverage.advanceWhenFullyCovered).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.update.mock.calls[0]?.[0]).toMatchObject({
      data: { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' },
    })
    expect(fixture.transaction.purchaseOrder.update.mock.calls[0]?.[0]).not.toHaveProperty('data.paymentStatus')
  })

  it.each([{}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: '1' },
    { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedVersion: 1, unexpected: true },
    { expectedVersion: 1, reason: '' }, { expectedVersion: 1, reason: null }, { expectedVersion: 1, reason: 'x'.repeat(501) },
  ])('rejects malformed review input %j before locking', async (input) => {
    const fixture = setup()
    await expect(fixture.service.review(context, ORDER_ID, input))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.transaction.purchaseOrder.findUnique).not.toHaveBeenCalled()
  })

  it('blocks payment and generic fulfillment on pending review orders but allows cancellation', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT', amount: '30', paidAt: '2026-08-27T11:00:00.000Z', paymentMethod: 'BANK',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
    await expect(fixture.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus: 'PREPARING' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, { toStatus: 'CONFIRMED' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderPayment.create).not.toHaveBeenCalled()
    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, { toStatus: 'CANCELLED' }))
      .resolves.toEqual(fixture.detail)
  })

  it('counts OTHER payments toward full payment without filtering payment types', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({ _sum: { amount: decimal('70') } })
    await fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'OTHER', amount: '30', paidAt: '2026-08-27T11:00:00.000Z', paymentMethod: 'BANK',
    })
    expect(fixture.transaction.purchaseOrderPayment.aggregate).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, voidedAt: null }, _sum: { amount: true },
    })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { orderStatus: 'CONFIRMED', paymentStatus: 'PAID', version: { increment: 1 } },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: expect.stringContaining('累计有效付款 100.00 CNY') as unknown,
    }) as unknown })
  })
  it('cancels only without active payments and records immutable history', async () => {
    const fixture = setup()
    await expect(fixture.service.updateOrderStatus(
      context,
      ORDER_ID,
      { toStatus: 'CANCELLED', reason: '不再采购' },
    )).resolves.toEqual(fixture.detail)
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { orderStatus: 'CANCELLED', version: { increment: 1 } },
    })
    const historyInput = fixture.transaction.purchaseOrderStatusHistory.create
      .mock.calls[0]?.[0]
    expect(historyInput).toMatchObject({ data: {
        dimension: 'ORDER',
        fromStatus: 'CONFIRMED',
        toStatus: 'CANCELLED',
        reason: '不再采购',
      } })
    expect(fixture.transaction.purchaseOrderLine.findMany).toHaveBeenCalled()
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED' }),
    )
    expect(fixture.coverage.recalculateAfterPurchaseCancellation)
      .toHaveBeenCalledWith(fixture.transaction, {
        actorUserId: ACTOR_ID,
        purchaseOrderId: ORDER_ID,
        purchaseOrderNo: 'PO/20260901-00001',
        requestId: 'request-1',
        salesOrderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      })

    const paid = setup()
    paid.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('1') },
    })
    await expect(paid.service.updateOrderStatus(
      context,
      ORDER_ID,
      { toStatus: 'CANCELLED' },
    )).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS' })
    expect(paid.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(paid.payables.closeForCancellation).not.toHaveBeenCalled()
  })

  it('does not recalculate sales coverage when cancelling a stock purchase', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order,
      purchaseType: 'STOCK',
      salesOrderId: null,
    })

    await fixture.service.updateOrderStatus(
      context,
      ORDER_ID,
      { toStatus: 'CANCELLED', reason: null },
    )

    expect(fixture.coverage.recalculateAfterPurchaseCancellation)
      .not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: '用户取消采购订单',
    }) as unknown })
  })

  it('blocks cancellation after any shipment and blocks generic shipment writes', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, fulfillmentStatus: 'PARTIALLY_SHIPPED' })
    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, { toStatus: 'CANCELLED' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' })
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({ ...fixture.order, fulfillmentStatus: 'PREPARING' })
    await expect(fixture.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus: 'SHIPPED' }))
      .rejects.toMatchObject({ code: 'PURCHASE_ORDER_FULFILLMENT_TRANSITION_INVALID' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('advances fulfillment in order and blocks cancelled orders', async () => {
    const fixture = setup()
    await fixture.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'PREPARING', reason: null },
    )
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        fulfillmentStatus: 'PREPARING',
        orderStatus: 'CONFIRMED',
        version: { increment: 1 },
      },
    })

    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: '用户确认采购订单进入备货中',
    }) as unknown })
    const cancelled = setup()
    cancelled.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...cancelled.order,
      orderStatus: 'CANCELLED',
    })
    await expect(cancelled.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'PREPARING' },
    )).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCELLED' })
  })

  it('delegates legacy SIGNED to the warehouse fact command without changing the parent directly', async () => {
    const fixture = setup()
    await expect(fixture.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus: 'SIGNED', reason: '已到仓' })).resolves.toBe(fixture.detail)
    expect(fixture.warehouseReceipts.receiveAll).toHaveBeenCalledWith(context, ORDER_ID, '已到仓')
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('records payment without requiring a voucher and derives PARTIALLY_PAID', async () => {
    const fixture = setup()
    await fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT',
      amount: '30',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: ' bank ',
      remark: null,
    })
    expect(fixture.dictionaryLookup.requireEffectiveValue).toHaveBeenCalledWith(
      fixture.transaction,
      { dictionaryCode: 'payment.method', value: 'BANK' },
    )
    const paymentInput = fixture.transaction.purchaseOrderPayment.create
      .mock.calls[0]?.[0]
    expect(paymentInput).toMatchObject({
      data: {
        purchaseOrderId: ORDER_ID,
        paymentType: 'DEPOSIT',
        amount: '30.00',
        paymentMethod: 'BANK',
      },
      select: { id: true },
    })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        orderStatus: 'CONFIRMED',
        paymentStatus: 'PARTIALLY_PAID',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create.mock.calls).toEqual([[{
      data: {
        purchaseOrderId: ORDER_ID,
        dimension: 'PAYMENT',
        fromStatus: 'UNPAID',
        toStatus: 'PARTIALLY_PAID',
        reason: expect.stringContaining('新增付款 30.00 CNY') as unknown,
        changedByUserId: ACTOR_ID,
      },
    }]])
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
    expect(fixture.media.activate).not.toHaveBeenCalled()
  })

  it('uses the locked payable remaining amount for funds, payment persistence and status calculation', async () => {
    const fixture = setup()
    const prepared = preparedPayment('25.00')
    fixture.payables.preparePayment.mockResolvedValueOnce(prepared)
    const confirmation = { payableId: PAYABLE_ID, expectedVersion: 1, idempotencyKey: MEDIA_ID }
    await fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT', amount: '30', paidAt: '2026-08-27T11:00:00.000Z', paymentMethod: 'BANK',
    }, confirmation)
    expect(fixture.payables.preparePayment).toHaveBeenCalledWith(fixture.transaction, context, ORDER_ID,
      { paymentType: 'DEPOSIT', amount: '30.00', paidAt: new Date('2026-08-27T11:00:00Z'), paymentMethod: 'BANK', remark: null, mediaAssetId: null, recipientAccountId: ACTOR_ID, recipientProfileVersion: 1 }, confirmation)
    expect(fixture.payables.postPayment).toHaveBeenCalledWith(fixture.transaction, context, prepared, fixture.order.orderNo)
    expect(fixture.transaction.purchaseOrderPayment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      id: PAYMENT_ID, payableId: PAYABLE_ID, fundPostingBatchId: FUND_BATCH_ID, amount: '25.00',
    }) as unknown }))
    expect(fixture.transaction.purchaseOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: expect.stringContaining('新增付款 25.00 CNY，累计有效付款 25.00 CNY') as unknown,
    }) as unknown })
    expect(fixture.payables.postPayment.mock.invocationCallOrder[0]).toBeLessThan(fixture.transaction.purchaseOrderPayment.create.mock.invocationCallOrder[0])
  })

  it('returns the existing result on a payable replay without charging or recording payment again', async () => {
    const fixture = setup()
    fixture.payables.preparePayment.mockResolvedValueOnce(preparedPayment('30.00', true))
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT', amount: '30', paidAt: '2026-08-27T11:00:00.000Z', paymentMethod: 'BANK',
    })).resolves.toBe(fixture.detail)
    expect(fixture.payables.postPayment).not.toHaveBeenCalled()
    expect(fixture.dictionaryLookup.requireEffectiveValue).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderPayment.create).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('propagates fund posting failure before writing payment or returning success', async () => {
    const fixture = setup()
    fixture.payables.postPayment.mockRejectedValueOnce(new ApiException(422, 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE', '资金记账失败'))
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT', amount: '30', paidAt: '2026-08-27T11:00:00.000Z', paymentMethod: 'BANK',
    })).rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderPayment.create).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it('atomically completes a signed order when payment reaches PAID', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order,
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PARTIALLY_PAID',
    })
    fixture.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('70') },
    })

    await fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'BALANCE',
      amount: '30',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK',
    })

    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        orderStatus: 'COMPLETED',
        paymentStatus: 'PAID',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create.mock.calls).toContainEqual([{
      data: {
        purchaseOrderId: ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        reason: expect.stringContaining('付款后满足已签收且已付清') as unknown,
        changedByUserId: ACTOR_ID,
      },
    }])
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED',
        metadata: {
          automatic: true,
          fromStatus: 'CONFIRMED',
          toStatus: 'COMPLETED',
          trigger: 'PAYMENT',
        },
      }),
    )
  })

  it.each([
    ['DEPOSIT', '定金凭证'],
    ['BALANCE', '尾款凭证'],
    ['OTHER', '其他付款凭证'],
  ])('names the %s voucher from the persisted order number in the payment transaction', async (paymentType, label) => {
    const fixture = setup()
    await fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType,
      amount: '30',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK',
      voucher: { mediaAssetId: MEDIA_ID },
    })
    expect(fixture.media.activate).toHaveBeenCalledWith(
      fixture.transaction,
      MEDIA_ID,
    )
    const documentInput = fixture.transaction.purchaseOrderDocument.create
      .mock.calls[0]?.[0]
    expect(documentInput).toMatchObject({
      data: {
        purchaseOrderId: ORDER_ID,
        paymentId: PAYMENT_ID,
        mediaAssetId: MEDIA_ID,
        documentType: 'PAYMENT_VOUCHER',
        title: `${fixture.order.orderNo}-${label}`,
      },
      select: { id: true },
    })
  })

  it.each([
    { orderNo: 'FORGED-ORDER' },
    { voucher: { mediaAssetId: MEDIA_ID, title: 'Forged title' } },
  ])('rejects client overrides of the voucher naming source', async (overrides) => {
    const fixture = setup()
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT', amount: '30', paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK', voucher: { mediaAssetId: MEDIA_ID }, ...overrides,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.transaction.purchaseOrderPayment.create).not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
  })

  it('rejects overpayment and any payment on a cancelled order', async () => {
    const overpaid = setup()
    overpaid.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('80') },
    })
    await expect(overpaid.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'BALANCE',
      amount: '30',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PAYMENT_EXCEEDS_TOTAL' })

    const cancelled = setup()
    cancelled.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...cancelled.order,
      orderStatus: 'CANCELLED',
    })
    await expect(cancelled.service.recordPayment(context, ORDER_ID, {
      recipientAccountId: ACTOR_ID, recipientProfileVersion: 1,
      paymentType: 'DEPOSIT',
      amount: '30',
      paidAt: '2026-08-27T11:00:00.000Z',
      paymentMethod: 'BANK',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CANCELLED' })
  })

  it('voids rather than deletes a payment and recomputes payment status', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order,
      paymentStatus: 'PARTIALLY_PAID',
    })
    fixture.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('30') },
    })
    await fixture.service.voidPayment(
      context,
      ORDER_ID,
      PAYMENT_ID,
      { reason: '重复录入' },
    )
    expect(fixture.transaction.purchaseOrderPayment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: {
        fundReversalBatchId: null,
        voidedAt: new Date('2026-08-27T12:00:00.000Z'),
        voidedByUserId: ACTOR_ID,
        voidReason: '重复录入',
      },
    })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        orderStatus: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        version: { increment: 1 },
      },
    })
  })

  it('atomically reopens a completed order when voiding payment makes it partially paid', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order,
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PAID',
    })
    fixture.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100') },
    })

    await fixture.service.voidPayment(
      context,
      ORDER_ID,
      PAYMENT_ID,
      { reason: '冲销已完成订单付款' },
    )

    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        orderStatus: 'CONFIRMED',
        paymentStatus: 'PARTIALLY_PAID',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create.mock.calls).toContainEqual([{
      data: {
        purchaseOrderId: ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'COMPLETED',
        toStatus: 'CONFIRMED',
        reason: expect.stringContaining('付款作废后不再满足已付清') as unknown,
        changedByUserId: ACTOR_ID,
      },
    }])
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED',
        metadata: {
          automatic: true,
          fromStatus: 'COMPLETED',
          toStatus: 'CONFIRMED',
          trigger: 'PAYMENT',
        },
      }),
    )
  })

  it('requires the linked fund reversal before persisting payment voiding', async () => {
    const fixture = setup()
    const payment = { id: PAYMENT_ID, amount: decimal('30'), voidedAt: null, payableId: PAYABLE_ID, fundPostingBatchId: FUND_BATCH_ID }
    fixture.transaction.purchaseOrderPayment.findFirst.mockResolvedValue(payment)
    fixture.transaction.purchaseOrderPayment.aggregate.mockResolvedValue({ _sum: { amount: decimal('30') } })
    fixture.payables.reversePayment.mockResolvedValueOnce(MEDIA_ID)
    await fixture.service.voidPayment(context, ORDER_ID, PAYMENT_ID, { reason: '重复付款' })
    expect(fixture.payables.reversePayment).toHaveBeenCalledWith(fixture.transaction, context, payment, '重复付款')
    expect(fixture.transaction.purchaseOrderPayment.update).toHaveBeenCalledWith({ where: { id: PAYMENT_ID }, data: {
      fundReversalBatchId: MEDIA_ID, voidedAt: new Date('2026-08-27T12:00:00Z'), voidedByUserId: ACTOR_ID, voidReason: '重复付款',
    } })
    expect(fixture.payables.reversePayment.mock.invocationCallOrder[0]).toBeLessThan(fixture.transaction.purchaseOrderPayment.update.mock.invocationCallOrder[0])
    fixture.payables.reversePayment.mockRejectedValueOnce(new ApiException(422, 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE', '资金冲正失败'))
    fixture.transaction.purchaseOrderPayment.update.mockClear()
    fixture.query.getById.mockClear()
    await expect(fixture.service.voidPayment(context, ORDER_ID, PAYMENT_ID, { reason: '再次核对' }))
      .rejects.toMatchObject({ code: 'PURCHASE_PAYABLE_POSTING_UNAVAILABLE' })
    expect(fixture.transaction.purchaseOrderPayment.update).not.toHaveBeenCalled()
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })
})

describe('PurchaseOrderMutationService amount revision', () => {
  const LINE_A = '33333333-3333-4333-8333-333333333333'
  const LINE_B = '44444444-4444-4444-8444-444444444444'
  const depositPayable = {
    id: '55555555-5555-4555-8555-555555555555',
    paymentType: 'DEPOSIT',
    dueAmount: decimal('30'),
    version: 1,
    closedAt: null,
  }
  const balancePayable = {
    id: '66666666-6666-4666-8666-666666666666',
    paymentType: 'BALANCE',
    dueAmount: decimal('70'),
    version: 1,
    closedAt: null,
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      expectedVersion: 1,
      reason: '价格录入错误',
      depositDueAmount: '20.00',
      lines: [
        { lineId: LINE_A, actualUnitPriceAmount: '30.00' },
        { lineId: LINE_B, actualUnitPriceAmount: '60.00' },
      ],
      ...overrides,
    }
  }

  function fixtureForRevision() {
    const fixture = setup()
    fixture.transaction.purchaseOrderLine.findMany.mockResolvedValue([
      {
        id: LINE_A,
        lineType: 'CATALOG',
        quantity: 1,
        actualPurchaseUnitPriceAmount: decimal('30'),
        lineTotalAmount: decimal('30'),
      },
      {
        id: LINE_B,
        lineType: 'CUSTOM',
        quantity: 2,
        actualPurchaseUnitPriceAmount: decimal('35'),
        lineTotalAmount: decimal('70'),
      },
    ])
    fixture.transaction.purchaseOrderPayable.findMany.mockResolvedValue([
      depositPayable,
      balancePayable,
    ])
    return fixture
  }

  it('updates lines, order, payables, revision history and audit atomically', async () => {
    const fixture = fixtureForRevision()
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input()))
      .resolves.toEqual(fixture.detail)

    expect(fixture.transaction.purchaseOrderAmountRevision.create).toHaveBeenCalledWith({
      data: {
        purchaseOrderId: ORDER_ID,
        oldLineSubtotalAmount: '100.00',
        oldPurchaseTotalAmount: '100.00',
        oldDepositDueAmount: '30.00',
        oldBalanceDueAmount: '70.00',
        newLineSubtotalAmount: '150.00',
        newPurchaseTotalAmount: '150.00',
        newDepositDueAmount: '20.00',
        newBalanceDueAmount: '130.00',
        reason: '价格录入错误',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.transaction.purchaseOrderLine.update).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.purchaseOrderLine.update).toHaveBeenCalledWith({
      where: { id: LINE_B },
      data: {
        actualPurchaseUnitPriceAmount: '60.00',
        referencePurchaseUnitPriceAmount: '60.00',
        lineTotalAmount: '120.00',
      },
    })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        lineSubtotalAmount: '150.00',
        purchaseTotalAmount: '150.00',
        depositDueAmount: '20.00',
        balanceDueAmount: '130.00',
        paymentStatus: 'UNPAID',
        orderStatus: 'CONFIRMED',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.purchaseOrderPayable.update).toHaveBeenCalledWith({
      where: { id: depositPayable.id },
      data: { dueAmount: '20.00', version: { increment: 1 } },
    })
    expect(fixture.transaction.purchaseOrderPayable.update).toHaveBeenCalledWith({
      where: { id: balancePayable.id },
      data: { dueAmount: '130.00', version: { increment: 1 } },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        eventType: 'PURCHASE_ORDER_AMOUNT_REVISED',
        targetId: ORDER_ID,
        metadata: expect.objectContaining({
          oldTotal: '100.00',
          newTotal: '150.00',
          oldDeposit: '30.00',
          newDeposit: '20.00',
          oldBalance: '70.00',
          newBalance: '130.00',
          lineCount: 2,
        }) as unknown,
      }),
    )
  })

  it('refuses revision while any active payment remains', async () => {
    const fixture = fixtureForRevision()
    fixture.transaction.purchaseOrderPayment.count.mockResolvedValue(1)
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input()))
      .rejects.toMatchObject({
        code: 'PURCHASE_ORDER_AMOUNT_REVISION_HAS_PAYMENTS',
        status: 409,
      })
    expect(fixture.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('rejects a stale order version before writing', async () => {
    const fixture = fixtureForRevision()
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input({
      expectedVersion: 2,
    }))).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_STATE_CHANGED',
      status: 409,
    })
    expect(fixture.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
  })

  it('rejects an unchanged amount revision', async () => {
    const fixture = fixtureForRevision()
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input({
      depositDueAmount: '30.00',
      lines: [
        { lineId: LINE_A, actualUnitPriceAmount: '30.00' },
        { lineId: LINE_B, actualUnitPriceAmount: '35.00' },
      ],
    }))).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_AMOUNT_REVISION_UNCHANGED',
    })
    expect(fixture.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
  })

  it('rejects line-only repricing when order totals, deposit and balance do not change', async () => {
    const fixture = fixtureForRevision()
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input({
      depositDueAmount: '30.00',
      lines: [
        { lineId: LINE_A, actualUnitPriceAmount: '50.00' },
        { lineId: LINE_B, actualUnitPriceAmount: '25.00' },
      ],
    }))).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_AMOUNT_REVISION_UNCHANGED',
    })
    expect(fixture.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
  })

  it('rejects a deposit above the recalculated total', async () => {
    const fixture = fixtureForRevision()
    await expect(fixture.service.reviseAmount(context, ORDER_ID, input({
      depositDueAmount: '151.00',
    }))).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_AMOUNT_INVALID',
    })
    expect(fixture.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
  })

  it('rejects cancelled orders and incomplete line sets', async () => {
    const cancelled = fixtureForRevision()
    cancelled.order.orderStatus = 'CANCELLED'
    await expect(cancelled.service.reviseAmount(context, ORDER_ID, input()))
      .rejects.toMatchObject({
        code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
      })

    const incomplete = fixtureForRevision()
    await expect(incomplete.service.reviseAmount(context, ORDER_ID, input({
      lines: [{ lineId: LINE_A, actualUnitPriceAmount: '30.00' }],
    }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(incomplete.transaction.purchaseOrderAmountRevision.create)
      .not.toHaveBeenCalled()
  })
})
