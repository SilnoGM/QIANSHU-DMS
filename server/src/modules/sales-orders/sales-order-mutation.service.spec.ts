import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import type { SalesOrderAutomaticStateService } from './sales-order-automatic-state.service'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import type { SalesOrderQueryService } from './sales-order-query.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VOUCHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function decimal(value: string) {
  return { toFixed: () => value }
}

function setup() {
  const order = {
    id: ORDER_ID,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SEA_TRANSIT',
    paymentStatus: 'UNPAID',
    currencyCode: 'TWD',
    currency: { symbol: 'NT$', minorUnit: 2 },
    lineSubtotalAmount: decimal('100.00'),
    agreedTotalAmount: decimal('100.00'),
    depositDueAmount: decimal('30.00'),
    balanceDueAmount: decimal('70.00'),
    customerName: '王小明',
    version: 1,
  }
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID }]),
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([
        { id: 'line-a', quantity: 2 },
        { id: 'line-b', quantity: 1 },
      ]),
    },
    purchaseOrder: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        orderStatus: 'CONFIRMED', fulfillmentStatus: 'SHIPPED',
        lines: [
          { sourceSalesOrderLineId: 'line-a', quantity: 2 },
          { sourceSalesOrderLineId: 'line-b', quantity: 1 },
        ],
      }]),
    },
    salesReceiptRequest: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    salesOrderPayment: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ _sum: { amount: decimal('0.00') } }),
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'payment-id' }),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
    salesOrderDocument: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      create: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'document-id' }),
    },
    mediaAsset: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: VOUCHER_ID }),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderAmountRevision: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
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
  const media = {
    activate: jest.fn<Promise<void>, [unknown, string]>()
      .mockResolvedValue(undefined),
  }
  const detail = { id: ORDER_ID }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const dictionaryLookup = {
    requireEffectiveValue: jest.fn<
      Promise<unknown>,
      [unknown, { value: string }]
    >().mockImplementation((_transaction, input) => Promise.resolve({
        dictionaryCode: 'payment.method',
        label: '银行转账',
        tone: 'DEFAULT',
        value: input.value,
      })),
  }
  const automaticState = {
    advanceWhenEligible:
      jest.fn<Promise<'NONE'>, [unknown, unknown, string, string]>()
        .mockResolvedValue('NONE'),
  }
  const service = new SalesOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    media as unknown as MediaAssetService,
    dictionaryLookup as unknown as DictionaryLookupService,
    query as unknown as SalesOrderQueryService,
    automaticState as unknown as SalesOrderAutomaticStateService,
    { now: () => new Date('2026-08-20T08:00:00.000Z') },
  )
  return {
    audit,
    automaticState,
    detail,
    dictionaryLookup,
    media,
    order,
    query,
    service,
    transaction,
  }
}

const context = {
  actorUserId: ACTOR_ID,
  requestId: 'request-1',
}

describe('SalesOrderMutationService', () => {
  it.each([
    ['PENDING', 'PREPARING'],
    ['PREPARING', 'LAND_TRANSIT'],
  ])('checks approved purchase coverage for manual %s to %s transitions', async (fromStatus, toStatus) => {
    const fixture = setup()
    fixture.order.fulfillmentStatus = fromStatus
    fixture.transaction.purchaseOrder.findMany.mockResolvedValue([{
      orderStatus: 'CONFIRMED', fulfillmentStatus: 'SHIPPED',
      lines: [{ sourceSalesOrderLineId: 'line-a', quantity: 2 }],
    }, {
      orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED',
      lines: [{ sourceSalesOrderLineId: 'line-b', quantity: 1 }],
    }])

    await expect(fixture.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus }))
      .rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()

    const approved = setup()
    approved.order.fulfillmentStatus = fromStatus
    await expect(approved.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus }))
      .resolves.toEqual(approved.detail)
    expect(approved.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { fulfillmentStatus: toStatus, version: { increment: 1 } },
    })
    expect(approved.transaction.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {
        purchaseType: 'SALES_LINKED', salesOrderId: ORDER_ID,
        orderStatus: { not: 'CANCELLED' },
      } }),
    )
    const sqlCalls = approved.transaction.$queryRaw.mock.calls.map(call => (
      (call[0] as { strings: readonly string[] }).strings.join(' ')
    )).filter(sql => sql.includes('FOR UPDATE'))
    expect(sqlCalls[0]).toContain('sales_order_lines')
    expect(sqlCalls[1]).toContain('purchase_orders')
    expect(sqlCalls[2]).toContain('sales_orders')
  })

  it.each([
    ['CONFIRMED', 'PREPARING'],
    ['PENDING_REVIEW', 'SHIPPED'],
    ['PENDING_REVIEW', 'SIGNED'],
  ])('blocks manual land transit with an effective purchase %s and %s', async (orderStatus, fulfillmentStatus) => {
    const fixture = setup()
    fixture.order.fulfillmentStatus = 'PREPARING'
    fixture.transaction.purchaseOrder.findMany.mockResolvedValue([{
      orderStatus: 'COMPLETED', fulfillmentStatus: 'SIGNED',
      lines: [
        { sourceSalesOrderLineId: 'line-a', quantity: 2 },
        { sourceSalesOrderLineId: 'line-b', quantity: 1 },
      ],
    }, { orderStatus, fulfillmentStatus, lines: [] }])

    await expect(fixture.service.updateFulfillmentStatus(context, ORDER_ID, { toStatus: 'LAND_TRANSIT' }))
      .rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('records ordered status history and enforces the signed receipt gate', async () => {
    const fixture = setup()
    await expect(fixture.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'SIGNED', reason: '客户已签收' },
    )).resolves.toEqual(fixture.detail)
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
    })
    const historyCall = fixture.transaction.salesOrderStatusHistory.create
      .mock.calls[0]?.[0]
    expect(historyCall).toMatchObject({ data: {
        dimension: 'FULFILLMENT',
        fromStatus: 'SEA_TRANSIT',
        toStatus: 'SIGNED',
        reason: '客户已签收',
        changedByUserId: ACTOR_ID,
      } })

    const blocked = setup()
    blocked.transaction.salesOrderDocument.count.mockResolvedValue(0)
    await expect(blocked.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'SIGNED', reason: null },
    )).rejects.toMatchObject({
      code: 'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
    })
    expect(blocked.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('rechecks automatic reconciliation after fulfillment reaches signed', async () => {
    const fixture = setup()

    await expect(fixture.service.updateFulfillmentStatus(
      context,
      ORDER_ID,
      { toStatus: 'SIGNED', reason: '客户已签收' },
    )).resolves.toEqual(fixture.detail)

    expect(fixture.automaticState.advanceWhenEligible)
      .toHaveBeenCalledWith(
        fixture.transaction,
        context,
        ORDER_ID,
        'FULFILLMENT',
      )
  })

  it.each(['DEPOSIT', 'PROGRESS', 'INVOICE_TAX', 'BALANCE', 'OTHER'] as const)('blocks direct %s receipts after review cutover', async paymentType => {
    const fixture = setup()
    await expect(fixture.service.recordPayment(context, ORDER_ID, { paymentType, amount: '1', voucher: { mediaAssetId: VOUCHER_ID } })).rejects.toMatchObject({ code: 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED' })
    expect(fixture.transaction.salesOrderPayment.create).not.toHaveBeenCalled()
  })

  it('preserves before/after snapshots for a confirmed payment-term revision', async () => {
    const fixture = setup()
    await expect(fixture.service.updatePaymentTerms(context, ORDER_ID, {
      agreedTotalAmount: '100',
      depositDueAmount: '40',
      balanceDueAmount: '60',
      reason: '客户调整付款计划',
    })).resolves.toEqual(fixture.detail)
    const revisionCall = fixture.transaction.salesOrderAmountRevision.create
      .mock.calls[0]?.[0]
    expect(revisionCall).toMatchObject({ data: {
        oldDepositDueAmount: '30.00',
        oldBalanceDueAmount: '70.00',
        newDepositDueAmount: '40.00',
        newBalanceDueAmount: '60.00',
        reason: '客户调整付款计划',
        changedByUserId: ACTOR_ID,
      } })
  })

  it.each([
    ['0.00', 'UNPAID'],
    ['50.00', 'PARTIALLY_PAID'],
    ['100.00', 'PAID'],
  ] as const)(
    'recalculates payment status as %s received becomes %s after payment-term changes',
    async (receivedAmount, expectedStatus) => {
      const fixture = setup()
      fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
        _sum: { amount: decimal(receivedAmount) },
      })

      await expect(fixture.service.updatePaymentTerms(context, ORDER_ID, {
        agreedTotalAmount: '100',
        depositDueAmount: '40',
        balanceDueAmount: '60',
        reason: '客户调整付款计划',
      })).resolves.toEqual(fixture.detail)

      expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: {
          agreedTotalAmount: '100.00',
          depositDueAmount: '40.00',
          balanceDueAmount: '60.00',
          paymentStatus: expectedStatus,
          version: { increment: 1 },
        },
      })
      if (expectedStatus === 'UNPAID') {
        expect(fixture.transaction.salesOrderStatusHistory.create)
          .not.toHaveBeenCalled()
      }
      else {
        expect(fixture.transaction.salesOrderStatusHistory.create)
          .toHaveBeenCalledWith({
            data: {
              salesOrderId: ORDER_ID,
              dimension: 'PAYMENT',
              fromStatus: 'UNPAID',
              toStatus: expectedStatus,
              reason: '修改付款约定后系统重新计算付款状态',
              changedByUserId: ACTOR_ID,
            },
          })
      }
      expect(fixture.automaticState.advanceWhenEligible)
        .toHaveBeenCalledWith(
          fixture.transaction,
          context,
          ORDER_ID,
          'PAYMENT_TERMS',
        )
    },
  )

  it('blocks cancellation when effective payments exist', async () => {
    const fixture = setup()
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('1.00') },
    })
    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'CANCELLED',
      reason: '取消',
    })).rejects.toMatchObject({ code: 'SALES_ORDER_CANCEL_HAS_PAYMENTS' })
  })

  it('enters reconciliation and records ordered history only after signed and paid', async () => {
    const fixture = setup()
    fixture.order.fulfillmentStatus = 'SIGNED'
    fixture.order.paymentStatus = 'PAID'
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100.00') },
    })

    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'PENDING_RECONCILIATION',
      reason: '提交财务对账',
    })).resolves.toEqual(fixture.detail)

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        orderStatus: 'PENDING_RECONCILIATION',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'CONFIRMED',
        toStatus: 'PENDING_RECONCILIATION',
        reason: '提交财务对账',
        changedByUserId: ACTOR_ID,
      },
    })
  })

  it('rejects reconciliation unless the locked order is signed and paid', async () => {
    const fixture = setup()
    fixture.order.fulfillmentStatus = 'SIGNED'
    fixture.order.paymentStatus = 'PARTIALLY_PAID'

    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'PENDING_RECONCILIATION',
      reason: null,
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_RECONCILIATION_CONDITIONS_NOT_MET',
    })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('rejects manual completion: the completed state is advanced only by the automatic service', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_RECONCILIATION'
    fixture.order.fulfillmentStatus = 'SIGNED'
    fixture.order.paymentStatus = 'PAID'
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100.00') },
    })

    // 即便已签收已付清，手工入口也不允许把订单置为已完成（无论当前处于哪个状态）。
    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'COMPLETED',
      reason: '对账确认无误',
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_COMPLETION_IS_AUTOMATIC',
    })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()

    const confirmed = setup()
    confirmed.order.orderStatus = 'CONFIRMED'
    await expect(confirmed.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'COMPLETED',
      reason: null,
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_COMPLETION_IS_AUTOMATIC',
    })
    expect(confirmed.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('freezes payment recording and voiding after completion', async () => {
    const recordFixture = setup()
    recordFixture.order.orderStatus = 'COMPLETED'
    recordFixture.order.fulfillmentStatus = 'SIGNED'
    recordFixture.order.paymentStatus = 'PAID'
    recordFixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100.00') },
    })
    await expect(recordFixture.service.recordPayment(context, ORDER_ID, {
      paymentType: 'OTHER',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({ code: 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED' })
    expect(recordFixture.transaction.salesOrderPayment.create).not.toHaveBeenCalled()

    const voidFixture = setup()
    voidFixture.order.orderStatus = 'COMPLETED'
    voidFixture.order.fulfillmentStatus = 'SIGNED'
    voidFixture.order.paymentStatus = 'PAID'
    voidFixture.transaction.salesOrderPayment.findFirst.mockResolvedValue({
      id: 'payment-id',
      amount: decimal('100.00'),
      voidedAt: null,
    })
    await expect(voidFixture.service.voidPayment(
      context,
      ORDER_ID,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      { reason: '错误收款' },
    )).rejects.toMatchObject({ code: 'SALES_ORDER_RECEIPT_REVIEW_REQUIRED' })
    expect(voidFixture.transaction.salesOrderPayment.update).not.toHaveBeenCalled()
  })
})
