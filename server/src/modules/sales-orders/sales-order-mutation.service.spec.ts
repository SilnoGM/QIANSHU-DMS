import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import { DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
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
    lineSubtotalAmount: decimal('100.0000'),
    agreedTotalAmount: decimal('100.0000'),
    depositDueAmount: decimal('30.0000'),
    balanceDueAmount: decimal('70.0000'),
    customerName: '王小明',
    version: 1,
  }
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID }]),
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderPayment: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ _sum: { amount: decimal('0.0000') } }),
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
  const service = new SalesOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    media as unknown as MediaAssetService,
    dictionaryLookup as unknown as DictionaryLookupService,
    query as unknown as SalesOrderQueryService,
    { now: () => new Date('2026-08-20T08:00:00.000Z') },
  )
  return {
    audit,
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

  it('derives payment status from effective payments and hard-blocks overpayment', async () => {
    const fixture = setup()
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
      amount: '30',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).resolves.toEqual(fixture.detail)
    const paymentCall = fixture.transaction.salesOrderPayment.create
      .mock.calls[0]?.[0]
    expect(paymentCall).toMatchObject({
      data: {
        amount: '30.0000',
        createdByUserId: ACTOR_ID,
      },
      select: { id: true },
    })
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { paymentStatus: 'PARTIALLY_PAID', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create)
      .toHaveBeenCalledWith({
        data: {
          salesOrderId: ORDER_ID,
          dimension: 'PAYMENT',
          fromStatus: 'UNPAID',
          toStatus: 'PARTIALLY_PAID',
          reason: '用户添加实际收款 NT$30.00 TWD，剩余 NT$70.00 TWD 未收',
          changedByUserId: ACTOR_ID,
        },
      })
    expect(fixture.dictionaryLookup.requireEffectiveValue).toHaveBeenCalledWith(
      fixture.transaction,
      { dictionaryCode: 'payment.method', value: 'BANK_TRANSFER' },
    )
    expect(fixture.media.activate).toHaveBeenCalledWith(
      fixture.transaction,
      VOUCHER_ID,
    )
    expect(fixture.transaction.salesOrderDocument.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: ORDER_ID,
        mediaAssetId: VOUCHER_ID,
        paymentId: 'payment-id',
        documentType: 'PAYMENT_VOUCHER',
        title: '王小明-定金凭证-20260820160000000',
        remark: null,
        createdByUserId: ACTOR_ID,
      },
      select: { id: true },
    })

    const overpaid = setup()
    overpaid.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('90.0000') },
    })
    await expect(overpaid.service.recordPayment(context, ORDER_ID, {
      paymentType: 'BALANCE',
      amount: '20',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
    })
  })

  it('records a completed-payment reason when one payment settles the order', async () => {
    const fixture = setup()
    await expect(fixture.service.recordPayment(context, ORDER_ID, {
      paymentType: 'BALANCE',
      amount: '100',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).resolves.toEqual(fixture.detail)

    expect(fixture.transaction.salesOrderStatusHistory.create)
      .toHaveBeenCalledWith({
        data: {
          salesOrderId: ORDER_ID,
          dimension: 'PAYMENT',
          fromStatus: 'UNPAID',
          toStatus: 'PAID',
          reason: '用户添加实际收款 NT$100.00 TWD，剩余 NT$0.00 TWD，订单已付清',
          changedByUserId: ACTOR_ID,
        },
      })
  })

  it.each(['DEPOSIT', 'PROGRESS', 'INVOICE_TAX', 'BALANCE', 'OTHER'] as const)(
    'records %s as an effective payment with one required voucher',
    async (paymentType) => {
      const fixture = setup()
      await expect(fixture.service.recordPayment(context, ORDER_ID, {
        paymentType,
        amount: '1',
        receivedAt: '2026-08-20T07:00:00.000Z',
        paymentMethod: 'BANK_TRANSFER',
        remark: null,
        voucher: { mediaAssetId: VOUCHER_ID },
      })).resolves.toEqual(fixture.detail)
      expect(JSON.stringify(
        fixture.transaction.salesOrderPayment.create.mock.calls[0]?.[0],
      )).toContain(`"paymentType":"${paymentType}"`)
    },
  )

  it('rejects missing vouchers and the removed referenceNo field', async () => {
    const missing = setup()
    await expect(missing.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(missing.transaction.salesOrderPayment.create).not.toHaveBeenCalled()

    const legacy = setup()
    await expect(legacy.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      referenceNo: 'REMOVED',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('requires one effective payment.method value in the payment transaction', async () => {
    const missing = setup()
    await expect(missing.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: null,
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(missing.transaction.salesOrderPayment.create).not.toHaveBeenCalled()

    const unavailable = setup()
    unavailable.dictionaryLookup.requireEffectiveValue.mockRejectedValue(
      new DictionaryValueUnavailableError('DICTIONARY_ITEM_NOT_FOUND'),
    )
    await expect(unavailable.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'UNKNOWN_METHOD',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_PAYMENT_METHOD_UNAVAILABLE',
    })
    expect(unavailable.transaction.salesOrderPayment.create).not.toHaveBeenCalled()
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
        oldDepositDueAmount: '30.0000',
        oldBalanceDueAmount: '70.0000',
        newDepositDueAmount: '40.0000',
        newBalanceDueAmount: '60.0000',
        reason: '客户调整付款计划',
        changedByUserId: ACTOR_ID,
      } })
  })

  it('blocks cancellation when effective payments exist', async () => {
    const fixture = setup()
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('1.0000') },
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
      _sum: { amount: decimal('100.0000') },
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

  it('rechecks signed and paid before completing a reconciliation order', async () => {
    const fixture = setup()
    fixture.order.orderStatus = 'PENDING_RECONCILIATION'
    fixture.order.fulfillmentStatus = 'SIGNED'
    fixture.order.paymentStatus = 'PAID'
    fixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100.0000') },
    })

    await expect(fixture.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'COMPLETED',
      reason: '对账确认无误',
    })).resolves.toEqual(fixture.detail)
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { orderStatus: 'COMPLETED', version: { increment: 1 } },
    })

    const blocked = setup()
    blocked.order.orderStatus = 'PENDING_RECONCILIATION'
    blocked.order.fulfillmentStatus = 'SIGNED'
    blocked.order.paymentStatus = 'PARTIALLY_PAID'
    await expect(blocked.service.updateOrderStatus(context, ORDER_ID, {
      toStatus: 'COMPLETED',
      reason: null,
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_COMPLETION_CONDITIONS_NOT_MET',
    })
    expect(blocked.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('freezes payment recording and voiding after completion', async () => {
    const recordFixture = setup()
    recordFixture.order.orderStatus = 'COMPLETED'
    recordFixture.order.fulfillmentStatus = 'SIGNED'
    recordFixture.order.paymentStatus = 'PAID'
    recordFixture.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('100.0000') },
    })
    await expect(recordFixture.service.recordPayment(context, ORDER_ID, {
      paymentType: 'OTHER',
      amount: '1',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: 'BANK_TRANSFER',
      remark: null,
      voucher: { mediaAssetId: VOUCHER_ID },
    })).rejects.toMatchObject({ code: 'SALES_ORDER_COMPLETED' })
    expect(recordFixture.transaction.salesOrderPayment.create).not.toHaveBeenCalled()

    const voidFixture = setup()
    voidFixture.order.orderStatus = 'COMPLETED'
    voidFixture.order.fulfillmentStatus = 'SIGNED'
    voidFixture.order.paymentStatus = 'PAID'
    voidFixture.transaction.salesOrderPayment.findFirst.mockResolvedValue({
      id: 'payment-id',
      amount: decimal('100.0000'),
      voidedAt: null,
    })
    await expect(voidFixture.service.voidPayment(
      context,
      ORDER_ID,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      { reason: '错误收款' },
    )).rejects.toMatchObject({ code: 'SALES_ORDER_COMPLETED' })
    expect(voidFixture.transaction.salesOrderPayment.update).not.toHaveBeenCalled()
  })
})
