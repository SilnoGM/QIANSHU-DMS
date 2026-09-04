import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { SalesOrderPurchaseCoverageService } from '../sales-order-purchase-coverage.service'
import { PurchaseOrderFactoryShipmentService } from './purchase-order-factory-shipment.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PURCHASE_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECOND_PURCHASE_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SALES_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function purchaseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: PURCHASE_ORDER_ID,
    orderNo: 'PO/20260904-00001',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    purchaseType: 'SALES_LINKED',
    salesOrderId: SALES_ORDER_ID,
    version: 3,
    ...overrides,
  }
}

function setup(overrides: Record<string, unknown> = {}) {
  const first = purchaseOrder(overrides)
  const orders = [first]
  const transaction = {
    $executeRaw: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ id: PURCHASE_ORDER_ID }]),
    purchaseOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(first),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue(orders),
      update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    purchaseOrderStatusHistory: {
      create: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
    },
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
      }),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{ id: SALES_LINE_ID }]),
    },
  }
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(tx: typeof transaction) => Promise<unknown>]>()
      .mockImplementation(callback => callback(transaction)),
  }
  const audit = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }
  const coverage = {
    advanceWhenAllPurchasesShipped:
      jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({
        advancedToLandTransit: false,
        fulfillmentStatus: 'PREPARING',
      }),
  }
  const service = new PurchaseOrderFactoryShipmentService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    coverage as unknown as SalesOrderPurchaseCoverageService,
  )
  return { audit, coverage, first, orders, prisma, service, transaction }
}

const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

describe('PurchaseOrderFactoryShipmentService', () => {
  it('advances ORDERED through PREPARING to SHIPPED in one transaction', async () => {
    const fixture = setup({ purchaseType: 'STOCK', salesOrderId: null })

    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3,
      reason: '工厂已交货',
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 1,
      alreadySatisfiedCount: 0,
      remainingPendingShipmentCount: 0,
      salesOrder: null,
      purchaseOrders: [{
        id: PURCHASE_ORDER_ID,
        fulfillmentStatus: 'SHIPPED',
        changed: true,
      }],
    })

    expect(fixture.transaction.purchaseOrder.update.mock.calls).toEqual([
      [{
        where: { id: PURCHASE_ORDER_ID },
        data: { fulfillmentStatus: 'PREPARING', version: { increment: 1 } },
      }],
      [{
        where: { id: PURCHASE_ORDER_ID },
        data: { fulfillmentStatus: 'SHIPPED', version: { increment: 1 } },
      }],
    ])
    expect(JSON.stringify(
      fixture.transaction.purchaseOrderStatusHistory.create.mock.calls,
    )).toContain(
      '"fromStatus":"ORDERED","toStatus":"PREPARING",'
      + '"reason":"确认发货时系统自动完成备货状态"',
    )
    expect(JSON.stringify(
      fixture.transaction.purchaseOrderStatusHistory.create.mock.calls,
    )).toContain(
      '"fromStatus":"PREPARING","toStatus":"SHIPPED",'
      + '"reason":"工厂已交货"',
    )
    expect(fixture.coverage.advanceWhenAllPurchasesShipped).not.toHaveBeenCalled()
  })

  it('rejects a stale pending purchase order before writing', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING', version: 4 })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('treats SHIPPED as an idempotent satisfied target', async () => {
    const fixture = setup({ fulfillmentStatus: 'SHIPPED', version: 9 })
    await expect(fixture.service.shipPurchaseOrder(context, PURCHASE_ORDER_ID, {
      expectedVersion: 3,
    })).resolves.toMatchObject({
      changedPurchaseOrderCount: 0,
      alreadySatisfiedCount: 1,
    })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid sales target without partially updating valid orders', async () => {
    const fixture = setup({ fulfillmentStatus: 'PREPARING' })
    fixture.transaction.purchaseOrder.findMany.mockResolvedValue([
      fixture.first,
      purchaseOrder({
        id: SECOND_PURCHASE_ORDER_ID,
        orderNo: 'PO/20260904-00002',
        fulfillmentStatus: 'PREPARING',
        version: 2,
      }),
    ])

    await expect(fixture.service.shipSalesOrder(context, SALES_ORDER_ID, {
      mode: 'SELECTED',
      targets: [
        { purchaseOrderId: PURCHASE_ORDER_ID, expectedVersion: 3 },
        {
          purchaseOrderId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          expectedVersion: 1,
        },
      ],
    })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_TARGET_INVALID' })
    expect(fixture.transaction.purchaseOrder.update).not.toHaveBeenCalled()
  })
})
