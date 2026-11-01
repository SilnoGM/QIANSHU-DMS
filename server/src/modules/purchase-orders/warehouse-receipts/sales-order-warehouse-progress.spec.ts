import type { Prisma } from '../../../generated/prisma/client'
import { advanceSalesOrderWhenAllShipmentsReceived } from './sales-order-warehouse-progress'

const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Part = {
  id: string
  status: string
  shippedAt: Date | null
  warehouseReceivedAt: Date | null
  items: Array<{ quantity: number, line: { sourceSalesOrderLineId: string | null } }>
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: 'part-1',
    status: 'ACTIVE',
    shippedAt: new Date('2026-09-10T00:00:00Z'),
    warehouseReceivedAt: new Date('2026-09-14T00:00:00Z'),
    items: [{ quantity: 1, line: { sourceSalesOrderLineId: 'line-1' } }],
    ...overrides,
  }
}

function fixture(overrides: {
  readonly fulfillmentStatus?: 'PENDING' | 'PREPARING' | 'LAND_TRANSIT' | 'WAREHOUSE_ARRIVED'
  readonly parts?: Part[]
  readonly salesLines?: Array<{ id: string, quantity: number }>
  readonly claimedRows?: Array<{ salesOrderLineId: string, quantity: number }>
} = {}) {
  const transaction = {
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue({
        fulfillmentStatus: overrides.fulfillmentStatus ?? 'LAND_TRANSIT',
        orderStatus: 'CONFIRMED',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue(overrides.salesLines ?? [{ id: 'line-1', quantity: 1 }]),
    },
    purchaseOrderPart: {
      findMany: jest.fn().mockResolvedValue(overrides.parts ?? [part()]),
    },
    shipmentClaimLine: {
      findMany: jest.fn().mockResolvedValue(overrides.claimedRows ?? []),
    },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  return {
    audit,
    run: () => advanceSalesOrderWhenAllShipmentsReceived(transaction, audit, {
      actorUserId: ACTOR_ID,
      requestId: 'request-1',
      salesOrderId: SALES_ORDER_ID,
    }),
    transaction,
  }
}

describe('advanceSalesOrderWhenAllShipmentsReceived', () => {
  it('advances to warehouse arrived when every owned shipment is received and covered', async () => {
    const f = fixture()

    await f.run()

    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    expect(f.transaction.salesOrderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: 'LAND_TRANSIT',
        toStatus: 'WAREHOUSE_ARRIVED',
        changedByUserId: ACTOR_ID,
      }) as unknown,
    })
    expect(f.audit.record).toHaveBeenCalledTimes(1)
  })

  it('reads owned shipments by current ownership instead of purchase order source', async () => {
    const f = fixture()

    await f.run()

    expect(f.transaction.purchaseOrderPart.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownershipCurrent: {
          ownerType: 'SALES_ORDER',
          ownerSalesOrderId: SALES_ORDER_ID,
          state: 'ACTIVE',
        },
      },
    }))
  })

  it('advances a claim-only order when claim quantities cover every sales line', async () => {
    const f = fixture({
      claimedRows: [{ quantity: 1, salesOrderLineId: 'line-1' }],
      parts: [part({ items: [] })],
    })

    await f.run()

    expect(f.transaction.salesOrder.update).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['存在待审核货件', [part({ status: 'PENDING_REVIEW' })]],
    ['货件尚未发货', [part({ shippedAt: null })]],
    ['货件尚未到仓', [part({ warehouseReceivedAt: null })]],
  ] as const)('keeps the order unchanged when %s', async (_label, parts) => {
    const f = fixture({ parts: [...parts] })

    await f.run()

    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the order unchanged when received quantities do not cover every line', async () => {
    const f = fixture({ salesLines: [{ id: 'line-1', quantity: 2 }] })

    await f.run()

    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the order unchanged when the order no longer owns any shipment', async () => {
    const f = fixture({ parts: [] })

    await f.run()

    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('skips orders that already left the land transit stage', async () => {
    const f = fixture({ fulfillmentStatus: 'WAREHOUSE_ARRIVED' })

    await f.run()

    expect(f.transaction.purchaseOrderPart.findMany).not.toHaveBeenCalled()
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })
})
