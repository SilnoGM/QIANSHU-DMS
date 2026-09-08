import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import {
  SalesOrderAutomaticStateService,
} from './sales-order-automatic-state.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SALES_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function setup(overrides: {
  readonly fulfillmentStatus?: 'SEA_TRANSIT' | 'SIGNED'
  readonly orderStatus?: 'CONFIRMED' | 'PENDING_RECONCILIATION' | 'COMPLETED'
  readonly paymentStatus?: 'PARTIALLY_PAID' | 'PAID'
} = {}) {
  const transaction = {
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        fulfillmentStatus: overrides.fulfillmentStatus ?? 'SIGNED',
        orderStatus: overrides.orderStatus ?? 'CONFIRMED',
        paymentStatus: overrides.paymentStatus ?? 'PAID',
      }),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const service = new SalesOrderAutomaticStateService(
    audit as unknown as AuditService,
  )
  return {
    audit,
    service,
    transaction,
    transactionClient: transaction as unknown as Prisma.TransactionClient,
  }
}

const context = {
  actorUserId: ACTOR_ID,
  requestId: 'automatic-reconciliation-test',
}

describe('SalesOrderAutomaticStateService', () => {
  it('atomically advances a confirmed signed and paid order to reconciliation', async () => {
    const fixture = setup()

    await expect(fixture.service.advanceToPendingReconciliationWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'PAYMENT',
    )).resolves.toBe(true)

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: {
        orderStatus: 'PENDING_RECONCILIATION',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'CONFIRMED',
        toStatus: 'PENDING_RECONCILIATION',
        reason: '订单已签收且已付清，系统自动进入待对账',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transactionClient,
      expect.objectContaining({
        eventType: 'SALES_ORDER_ORDER_STATUS_CHANGED',
        actorUserId: ACTOR_ID,
        requestId: 'automatic-reconciliation-test',
        targetId: SALES_ORDER_ID,
        targetType: 'SALES_ORDER',
        metadata: {
          automatic: true,
          fromStatus: 'CONFIRMED',
          toStatus: 'PENDING_RECONCILIATION',
          trigger: 'PAYMENT',
        },
      }),
    )
  })

  it.each([
    { fulfillmentStatus: 'SEA_TRANSIT' as const },
    { paymentStatus: 'PARTIALLY_PAID' as const },
    { orderStatus: 'PENDING_RECONCILIATION' as const },
    { orderStatus: 'COMPLETED' as const },
  ])('does not write when the order is ineligible: %s', async (overrides) => {
    const fixture = setup(overrides)

    await expect(fixture.service.advanceToPendingReconciliationWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'FULFILLMENT',
    )).resolves.toBe(false)

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })
})
