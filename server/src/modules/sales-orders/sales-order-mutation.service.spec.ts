import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { AuditService } from '../audit/audit.service'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import type { SalesOrderQueryService } from './sales-order-query.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function decimal(value: string) {
  return { toFixed: () => value }
}

function setup() {
  const order = {
    id: ORDER_ID,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SHIPPED',
    paymentStatus: 'UNPAID',
    lineSubtotalAmount: decimal('100.0000'),
    agreedTotalAmount: decimal('100.0000'),
    depositDueAmount: decimal('30.0000'),
    balanceDueAmount: decimal('70.0000'),
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
  const detail = { id: ORDER_ID }
  const query = {
    getById: jest.fn<Promise<typeof detail>, [string]>().mockResolvedValue(detail),
  }
  const service = new SalesOrderMutationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    query as unknown as SalesOrderQueryService,
    { now: () => new Date('2026-08-20T08:00:00.000Z') },
  )
  return { audit, detail, order, query, service, transaction }
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
        fromStatus: 'SHIPPED',
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
      referenceNo: 'REF-1',
      remark: null,
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

    const overpaid = setup()
    overpaid.transaction.salesOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: decimal('90.0000') },
    })
    await expect(overpaid.service.recordPayment(context, ORDER_ID, {
      paymentType: 'BALANCE',
      amount: '20',
      receivedAt: '2026-08-20T07:00:00.000Z',
      paymentMethod: null,
      referenceNo: null,
      remark: null,
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL',
    })
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
})
