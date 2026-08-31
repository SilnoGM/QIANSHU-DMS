import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { MediaAssetService } from '../media/media-asset.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import type { PurchaseOrderQueryService } from './purchase-order-query.service'

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
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    paymentStatus: 'UNPAID',
    purchaseTotalAmount: decimal('100'),
    version: 1,
  }
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: ORDER_ID }]),
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(order),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
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
  const service = new PurchaseOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    dictionaryLookup as unknown as DictionaryLookupService,
    media as unknown as MediaAssetService,
    query as unknown as PurchaseOrderQueryService,
    { now: () => new Date('2026-08-27T12:00:00.000Z') },
  )
  return {
    audit,
    detail,
    dictionaryLookup,
    media,
    order,
    service,
    transaction,
  }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderMutationService', () => {
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
        reason: null,
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
        reason: null,
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
        reason: null,
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

  it('optionally attaches one prepared payment voucher in the payment transaction', async () => {
    const fixture = setup()
    await fixture.service.recordPayment(context, ORDER_ID, {
      paymentType: 'DEPOSIT',
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
      },
      select: { id: true },
    })
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
        reason: null,
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
