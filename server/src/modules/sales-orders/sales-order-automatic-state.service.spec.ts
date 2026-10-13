import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import {
  SalesOrderAutomaticStateService,
} from './sales-order-automatic-state.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SALES_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SETTLED_AT = new Date('2026-10-13T03:00:00.000Z')

/**
 * 对账成员行的读取替身：完成判定（口径 R3）只看「有没有成员行」与
 * 「成员行所属批次是否都已结束」，因此这里只造这两维事实。
 */
function memberRow(overrides: {
  readonly batchId?: string
  readonly completedAt?: Date | null
} = {}) {
  return {
    batchId: overrides.batchId ?? 'batch-1',
    reconciledAt: SETTLED_AT,
    batch: { completedAt: overrides.completedAt === undefined ? SETTLED_AT : overrides.completedAt },
    matchedLoadingItem: {
      shipment: { purchaseOrder: { salesOrderId: SALES_ORDER_ID } },
    },
  }
}

function setup(overrides: {
  readonly fulfillmentStatus?: 'SEA_TRANSIT' | 'SIGNED'
  readonly orderStatus?: 'CONFIRMED' | 'PENDING_RECONCILIATION' | 'COMPLETED' | 'CANCELLED'
  readonly paymentStatus?: 'PARTIALLY_PAID' | 'PAID'
  readonly memberRows?: readonly ReturnType<typeof memberRow>[]
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
    slhReconciliationBatchLine: {
      findMany: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue(overrides.memberRows ?? []),
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
  it('advances a confirmed signed and paid order to reconciliation but stops there without coverage', async () => {
    const fixture = setup()

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'PAYMENT',
    )).resolves.toBe('PENDING_RECONCILIATION')

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
    // 没有任何对账成员行：对账未完结（口径 R3），不能自动完成。
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledTimes(1)
  })

  it('completes a reconciliation order once every covering batch has ended', async () => {
    const fixture = setup({
      orderStatus: 'PENDING_RECONCILIATION',
      memberRows: [memberRow()],
    })

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'RECONCILIATION',
    )).resolves.toBe('COMPLETED')

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { orderStatus: 'COMPLETED', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'ORDER',
        fromStatus: 'PENDING_RECONCILIATION',
        toStatus: 'COMPLETED',
        reason: '订单对账已完成，系统自动完成订单',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transactionClient,
      expect.objectContaining({
        eventType: 'SALES_ORDER_ORDER_STATUS_CHANGED',
        metadata: {
          automatic: true,
          fromStatus: 'PENDING_RECONCILIATION',
          toStatus: 'COMPLETED',
          trigger: 'RECONCILIATION',
        },
      }),
    )
  })

  it('runs both stages in one call when the reconciliation closes the payment gap', async () => {
    // 代收货款回填把订单推进到已付清的场景：同一次 drain 内先入待对账、再完成。
    const fixture = setup({ memberRows: [memberRow()] })

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'RECONCILIATION',
    )).resolves.toBe('COMPLETED')

    expect(fixture.transaction.salesOrder.update).toHaveBeenNthCalledWith(1, {
      where: { id: SALES_ORDER_ID },
      data: { orderStatus: 'PENDING_RECONCILIATION', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrder.update).toHaveBeenNthCalledWith(2, {
      where: { id: SALES_ORDER_ID },
      data: { orderStatus: 'COMPLETED', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledTimes(2)
  })

  it('keeps the order in reconciliation while a covering batch is still in progress', async () => {
    const fixture = setup({
      orderStatus: 'PENDING_RECONCILIATION',
      memberRows: [memberRow({ completedAt: null })],
    })

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'RECONCILIATION',
    )).resolves.toBe('NONE')

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('keeps the order in reconciliation without any coverage', async () => {
    const fixture = setup({ orderStatus: 'PENDING_RECONCILIATION' })

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'RECONCILIATION',
    )).resolves.toBe('NONE')

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it.each([
    { fulfillmentStatus: 'SEA_TRANSIT' as const },
    { paymentStatus: 'PARTIALLY_PAID' as const },
    { orderStatus: 'COMPLETED' as const },
    { orderStatus: 'CANCELLED' as const },
  ])('does not write when the order is ineligible: %s', async (overrides) => {
    const fixture = setup(overrides)

    await expect(fixture.service.advanceWhenEligible(
      fixture.transactionClient,
      context,
      SALES_ORDER_ID,
      'FULFILLMENT',
    )).resolves.toBe('NONE')

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })
})
