import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import {
  isSalesOrderPurchaseFullyCovered,
  SalesOrderPurchaseCoverageService,
} from './sales-order-purchase-coverage.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PURCHASE_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_LINE_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SALES_LINE_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function input() {
  return {
    actorUserId: ACTOR_ID,
    purchaseOrderId: PURCHASE_ORDER_ID,
    purchaseOrderNo: 'PO/20260901-00001',
    requestId: 'purchase-coverage-test',
    salesOrderId: SALES_ORDER_ID,
  }
}

interface PurchaseLineFact {
  readonly sourceSalesOrderLineId: string
  readonly quantity: number
  orderStatus: 'PENDING_REVIEW' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
}

function setup(overrides: {
  readonly fulfillmentStatus?:
    | 'PENDING'
    | 'PREPARING'
    | 'LAND_TRANSIT'
    | 'WAREHOUSE_ARRIVED'
    | 'SEA_TRANSIT'
    | 'SIGNED'
  readonly orderStatus?:
    | 'CONFIRMED'
    | 'PENDING_RECONCILIATION'
    | 'COMPLETED'
    | 'CANCELLED'
  readonly purchasedRows?: readonly {
    readonly sourceSalesOrderLineId: string | null
    readonly _sum: { readonly quantity: number | null }
  }[]
  readonly salesLines?: readonly {
    readonly id: string
    readonly quantity: number
  }[]
  readonly purchaseLines?: readonly PurchaseLineFact[]
  readonly shipmentStatuses?: readonly (
    | 'ORDERED'
    | 'PREPARING'
    | 'SHIPPED'
    | 'SIGNED'
  )[]
} = {}) {
  const calls: string[] = []
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>(() => {
      calls.push('lock')
      return Promise.resolve([{
        fulfillmentStatus: overrides.fulfillmentStatus ?? 'PENDING',
        id: SALES_ORDER_ID,
        orderStatus: overrides.orderStatus ?? 'CONFIRMED',
      }])
    }),
    purchaseOrderLine: {
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>((query) => {
        calls.push('purchases')
        if (overrides.purchaseLines !== undefined) {
          const filter = (query as {
            where: { purchaseOrder: { orderStatus: { in?: string[], not?: string } } }
          }).where.purchaseOrder.orderStatus
          const quantities = new Map<string, number>()
          for (const line of overrides.purchaseLines) {
            if (filter.in && !filter.in.includes(line.orderStatus)) continue
            if (filter.not === line.orderStatus) continue
            quantities.set(line.sourceSalesOrderLineId,
              (quantities.get(line.sourceSalesOrderLineId) ?? 0) + line.quantity)
          }
          return Promise.resolve([...quantities].map(([sourceSalesOrderLineId, quantity]) => ({
            sourceSalesOrderLineId, _sum: { quantity },
          })))
        }
        return Promise.resolve([...(overrides.purchasedRows ?? [{
          sourceSalesOrderLineId: SALES_LINE_A_ID,
          _sum: { quantity: 2 },
        }, {
          sourceSalesOrderLineId: SALES_LINE_B_ID,
          _sum: { quantity: 1 },
        }])])
      }),
    },
    purchaseOrder: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(
        (overrides.shipmentStatuses ?? ['SHIPPED']).map(fulfillmentStatus => ({
          fulfillmentStatus,
          orderStatus: 'CONFIRMED',
        })),
      ),
    },
    salesOrder: {
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(() => {
        calls.push('sales-lines')
        return Promise.resolve([...(overrides.salesLines ?? [{
          id: SALES_LINE_A_ID,
          quantity: 2,
        }, {
          id: SALES_LINE_B_ID,
          quantity: 1,
        }])])
      }),
    },
    salesOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const service = new SalesOrderPurchaseCoverageService(
    audit as unknown as AuditService,
  )
  return {
    audit,
    calls,
    service,
    transaction,
    transactionClient: transaction as unknown as Prisma.TransactionClient,
  }
}

describe('isSalesOrderPurchaseFullyCovered', () => {
  it('does not treat an empty or partially purchased sales order as covered', () => {
    expect(isSalesOrderPurchaseFullyCovered([], new Map())).toBe(false)
    expect(isSalesOrderPurchaseFullyCovered([
      { id: SALES_LINE_A_ID, quantity: 2 },
      { id: SALES_LINE_B_ID, quantity: 1 },
    ], new Map([
      [SALES_LINE_A_ID, 2],
    ]))).toBe(false)
  })

  it('requires every source line to be covered independently', () => {
    expect(isSalesOrderPurchaseFullyCovered([
      { id: SALES_LINE_A_ID, quantity: 2 },
      { id: SALES_LINE_B_ID, quantity: 1 },
    ], new Map([
      [SALES_LINE_A_ID, 2],
      [SALES_LINE_B_ID, 1],
    ]))).toBe(true)
  })
})

describe('SalesOrderPurchaseCoverageService', () => {
  it('locks the source order before reads and advances a fully covered order', async () => {
    const fixture = setup()

    await fixture.service.advanceWhenFullyCovered(
      fixture.transactionClient,
      input(),
    )

    expect(fixture.calls).toEqual(['lock', 'sales-lines', 'purchases'])
    expect(fixture.transaction.salesOrderLine.findMany).toHaveBeenCalledWith({
      where: { salesOrderId: SALES_ORDER_ID, removedAt: null },
      select: { id: true, quantity: true },
    })
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: {
        fulfillmentStatus: 'PREPARING',
        version: { increment: 1 },
      },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create)
      .toHaveBeenCalledWith({ data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'PENDING',
        toStatus: 'PREPARING',
        reason: '采购订单审核通过后已覆盖全部销售产品',
        changedByUserId: ACTOR_ID,
      } })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transactionClient,
      expect.objectContaining({
        eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
        actorUserId: ACTOR_ID,
        requestId: 'purchase-coverage-test',
        targetId: SALES_ORDER_ID,
        targetType: 'SALES_ORDER',
        metadata: {
          automatic: true,
          fromStatus: 'PENDING',
          purchaseOrderId: PURCHASE_ORDER_ID,
          purchaseOrderNo: 'PO/20260901-00001',
          toStatus: 'PREPARING',
          trigger: 'PURCHASE_COVERAGE',
        },
      }),
    )
  })

  it('advances only after separate approvals cover every reserved sales line', async () => {
    const purchaseLines: PurchaseLineFact[] = [{
      sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2, orderStatus: 'PENDING_REVIEW',
    }, {
      sourceSalesOrderLineId: SALES_LINE_B_ID, quantity: 1, orderStatus: 'PENDING_REVIEW',
    }]
    const fixture = setup({ purchaseLines })

    await fixture.service.advanceWhenFullyCovered(fixture.transactionClient, input())
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    purchaseLines[0].orderStatus = 'CONFIRMED'
    await fixture.service.advanceWhenFullyCovered(fixture.transactionClient, input())
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    purchaseLines[1].orderStatus = 'COMPLETED'
    await fixture.service.advanceWhenFullyCovered(fixture.transactionClient, input())
    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledTimes(1)
  })

  it('recalculates cancellation from approved coverage even when pending orders reserve the gap', async () => {
    const fixture = setup({
      fulfillmentStatus: 'PREPARING',
      purchaseLines: [{
        sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2, orderStatus: 'CONFIRMED',
      }, {
        sourceSalesOrderLineId: SALES_LINE_B_ID, quantity: 1, orderStatus: 'PENDING_REVIEW',
      }, {
        sourceSalesOrderLineId: SALES_LINE_B_ID, quantity: 1, orderStatus: 'CANCELLED',
      }],
    })

    await fixture.service.recalculateAfterPurchaseCancellation(fixture.transactionClient, input())

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'PENDING', version: { increment: 1 } },
    })
  })

  it('does not advance shipping when pending-review quantities are needed for coverage', async () => {
    const fixture = setup({
      fulfillmentStatus: 'PREPARING',
      purchaseLines: [{
        sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2, orderStatus: 'CONFIRMED',
      }, {
        sourceSalesOrderLineId: SALES_LINE_B_ID, quantity: 1, orderStatus: 'PENDING_REVIEW',
      }],
    })

    await expect(fixture.service.advanceWhenAllPurchasesShipped(fixture.transactionClient, {
      actorUserId: ACTOR_ID,
      changedPurchaseOrderCount: 1,
      requestId: 'factory-shipment-review-test',
      salesOrderId: SALES_ORDER_ID,
    })).resolves.toEqual({ advancedToLandTransit: false, fulfillmentStatus: 'PREPARING' })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('does not accept an unreviewed order with a shipped snapshot as shipping complete', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    fixture.transaction.purchaseOrder.findMany.mockResolvedValue([{
      orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'SHIPPED',
    }])

    await expect(fixture.service.advanceWhenAllPurchasesShipped(fixture.transactionClient, {
      actorUserId: ACTOR_ID,
      changedPurchaseOrderCount: 1,
      requestId: 'factory-shipment-invalid-snapshot',
      salesOrderId: SALES_ORDER_ID,
    })).resolves.toEqual({ advancedToLandTransit: false, fulfillmentStatus: 'PREPARING' })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('does not write when any sales line remains unpurchased', async () => {
    const fixture = setup({
      purchasedRows: [{
        sourceSalesOrderLineId: SALES_LINE_A_ID,
        _sum: { quantity: 2 },
      }],
    })

    await fixture.service.advanceWhenFullyCovered(
      fixture.transactionClient,
      input(),
    )

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('does not recalculate or overwrite a later fulfillment state', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })

    await fixture.service.advanceWhenFullyCovered(
      fixture.transactionClient,
      input(),
    )

    expect(fixture.calls).toEqual(['lock'])
    expect(fixture.transaction.salesOrderLine.findMany).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('rejects a source order that is no longer confirmed', async () => {
    const fixture = setup({ orderStatus: 'CANCELLED' })

    await expect(fixture.service.advanceWhenFullyCovered(
      fixture.transactionClient,
      input(),
    )).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_STATE_CHANGED',
      status: 409,
    })

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('returns a pre-sea order to pending when cancellation removes full coverage', async () => {
    const fixture = setup({
      fulfillmentStatus: 'WAREHOUSE_ARRIVED',
      purchasedRows: [{
        sourceSalesOrderLineId: SALES_LINE_A_ID,
        _sum: { quantity: 2 },
      }],
    })

    await fixture.service.recalculateAfterPurchaseCancellation(
      fixture.transactionClient,
      input(),
    )

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'PENDING', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'WAREHOUSE_ARRIVED',
        toStatus: 'PENDING',
        reason: '取消采购订单后重新计算销售产品采购覆盖',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(JSON.stringify(fixture.audit.record.mock.calls[0]?.[1]))
      .toContain('"trigger":"PURCHASE_CANCELLATION"')
    expect(JSON.stringify(fixture.audit.record.mock.calls[0]?.[1]))
      .toContain('"fromStatus":"WAREHOUSE_ARRIVED"')
    expect(JSON.stringify(fixture.audit.record.mock.calls[0]?.[1]))
      .toContain('"toStatus":"PENDING"')
  })

  it('keeps full coverage and only advances pending to preparing', async () => {
    const alreadyPreparing = setup({ fulfillmentStatus: 'PREPARING' })
    await alreadyPreparing.service.recalculateAfterPurchaseCancellation(
      alreadyPreparing.transactionClient,
      input(),
    )
    expect(alreadyPreparing.transaction.salesOrder.update).not.toHaveBeenCalled()

    const pending = setup({ fulfillmentStatus: 'PENDING' })
    await pending.service.recalculateAfterPurchaseCancellation(
      pending.transactionClient,
      input(),
    )
    expect(pending.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'PREPARING', version: { increment: 1 } },
    })
  })

  it.each([
    ['SEA_TRANSIT', 'CONFIRMED'],
    ['SIGNED', 'CONFIRMED'],
    ['PREPARING', 'PENDING_RECONCILIATION'],
    ['PREPARING', 'COMPLETED'],
    ['PREPARING', 'CANCELLED'],
  ] as const)(
    'does not regress fulfillment=%s or order=%s after cancellation',
    async (fulfillmentStatus, orderStatus) => {
      const fixture = setup({
        fulfillmentStatus,
        orderStatus,
        purchasedRows: [],
      })

      await fixture.service.recalculateAfterPurchaseCancellation(
        fixture.transactionClient,
        input(),
      )

      expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
      expect(fixture.audit.record).not.toHaveBeenCalled()
    },
  )

  it('advances PREPARING to LAND_TRANSIT only after coverage and all purchases ship', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })

    await expect(fixture.service.advanceWhenAllPurchasesShipped(
      fixture.transactionClient,
      {
        actorUserId: ACTOR_ID,
        changedPurchaseOrderCount: 1,
        requestId: 'factory-shipment-test',
        salesOrderId: SALES_ORDER_ID,
      },
    )).resolves.toEqual({
      advancedToLandTransit: true,
      fulfillmentStatus: 'LAND_TRANSIT',
    })

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'LAND_TRANSIT', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'PREPARING',
        toStatus: 'LAND_TRANSIT',
        reason: '全部有效关联采购订单已发货',
        changedByUserId: ACTOR_ID,
      },
    })
  })

  it('keeps PREPARING when one active purchase is not shipped', async () => {
    const fixture = setup({
      fulfillmentStatus: 'PREPARING',
      shipmentStatuses: ['SHIPPED', 'PREPARING'],
    })

    await expect(fixture.service.advanceWhenAllPurchasesShipped(
      fixture.transactionClient,
      {
        actorUserId: ACTOR_ID,
        changedPurchaseOrderCount: 1,
        requestId: 'factory-shipment-test',
        salesOrderId: SALES_ORDER_ID,
      },
    )).resolves.toEqual({
      advancedToLandTransit: false,
      fulfillmentStatus: 'PREPARING',
    })
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })
})
