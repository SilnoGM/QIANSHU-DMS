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

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAYMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIA_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SOURCE_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

function setup() {
  const order = {
    id: ORDER_ID,
    orderNo: 'PO/20260901-00001',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    paymentStatus: 'UNPAID',
    purchaseTotalAmount: decimal('100'),
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
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderPart: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{ sourceSalesOrderLineId: SOURCE_LINE_ID }]),
    },
    purchaseOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderPayment: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ _sum: { amount: null } }),
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
  const service = new PurchaseOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    dictionaryLookup as unknown as DictionaryLookupService,
    media as unknown as MediaAssetService,
    query as unknown as PurchaseOrderQueryService,
    coverage as unknown as SalesOrderPurchaseCoverageService,
    numbering as unknown as NumberingGeneratorService,
    resolver as unknown as PurchaseShippingMarkResolverService,
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
    query,
    service,
    transaction,
  }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderMutationService', () => {
  it('activates pending parts in the review transaction without changing historical marks', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    await fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, status: 'PENDING_REVIEW' },
      data: { status: 'ACTIVE' },
    })
  })

  it.each(['PENDING_REVIEW', 'CONFIRMED'])('cancels %s parts while preserving marks and allocations', async status => {
    const fixture = setup()
    fixture.order.orderStatus = status
    await fixture.service.updateOrderStatus(context, ORDER_ID, { toStatus: 'CANCELLED', reason: '采购取消' })
    expect(fixture.transaction.purchaseOrderPart.updateMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: ORDER_ID, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
  })

  it.each([
    ['40001', 'PURCHASE_ORDER_STATE_CHANGED'],
    ['23514', 'AUDIT_WRITE_FAILED'],
  ])('preserves audit persistence %s classification during review without retrying issuance', async (code, expectedCode) => {
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
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })).rejects.toMatchObject({ code: expectedCode })
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(fixture.numbering.generateScopedInTransaction).toHaveBeenCalledTimes(1)
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })

  it('issues and persists one base mark while approving a v5 order', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order, orderStatus: 'PENDING_REVIEW', createRequestFingerprintVersion: 'purchase-order.create.v5',
      createRequestFingerprintHash: Buffer.alloc(32, 1), productMode: 'CUSTOM', supplierValue: null,
      shippingMarkText: null, shippingMarkIssuanceId: null, _count: { parts: 1 },
    })
    await fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })
    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID }, data: {
        orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: { increment: 1 },
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
    await fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })
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
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })).rejects.toMatchObject({
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
    await fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })
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
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_STATE_CHANGED' })
    expect(fixture.query.getById).not.toHaveBeenCalled()
  })
  it('reviews a pending order once, records both dimensions and advances sales after the update', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_REVIEW'
    fixture.transaction.purchaseOrder.findUnique
      .mockResolvedValueOnce({ ...fixture.order })
      .mockResolvedValue({ ...fixture.order, orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING', version: 2 })

    await expect(fixture.service.review(context, ORDER_ID, {
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
      [fixture.transaction, expect.objectContaining({ eventType: 'PURCHASE_ORDER_ORDER_STATUS_CHANGED', metadata: { action: 'REVIEW', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED' } })],
      [fixture.transaction, expect.objectContaining({ eventType: 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED', metadata: { action: 'REVIEW', fromStatus: 'ORDERED', toStatus: 'PREPARING' } })],
    ]))
    expect(fixture.coverage.advanceWhenFullyCovered).toHaveBeenCalledWith(fixture.transaction, {
      actorUserId: ACTOR_ID, purchaseOrderId: ORDER_ID, purchaseOrderNo: fixture.order.orderNo,
      requestId: context.requestId, salesOrderId: fixture.order.salesOrderId,
    })
    expect(fixture.transaction.purchaseOrder.update.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.coverage.advanceWhenFullyCovered.mock.invocationCallOrder[0] ?? 0,
    )
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 }))
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
    await expect(fixture.service.review(context, ORDER_ID, { expectedVersion: 1 }))
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
    await fixture.service.review(context, ORDER_ID, { expectedVersion: 1 })
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
      reason: expect.stringContaining('累计有效付款 100.0000 CNY') as unknown,
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

  it('atomically completes a paid order when fulfillment reaches SIGNED', async () => {
    const fixture = setup()
    fixture.transaction.purchaseOrder.findUnique.mockResolvedValue({
      ...fixture.order,
      fulfillmentStatus: 'SHIPPED',
      paymentStatus: 'PAID',
    })

    await fixture.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'SIGNED', reason: null },
    )

    expect(fixture.transaction.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        fulfillmentStatus: 'SIGNED',
        orderStatus: 'COMPLETED',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.purchaseOrderStatusHistory.create.mock.calls).toContainEqual([{
      data: {
        purchaseOrderId: ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        reason: expect.stringContaining('签收后满足已签收且已付清') as unknown,
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
          trigger: 'FULFILLMENT',
        },
      }),
    )
  })

  it('records payment without requiring a voucher and derives PARTIALLY_PAID', async () => {
    const fixture = setup()
    await fixture.service.recordPayment(context, ORDER_ID, {
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
        amount: '30.0000',
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
        reason: expect.stringContaining('新增付款 30.0000 CNY') as unknown,
        changedByUserId: ACTOR_ID,
      },
    }]])
    expect(fixture.transaction.purchaseOrderDocument.create).not.toHaveBeenCalled()
    expect(fixture.media.activate).not.toHaveBeenCalled()
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
})
