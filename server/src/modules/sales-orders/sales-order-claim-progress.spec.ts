import type { Prisma } from '../../generated/prisma/client'
import { advanceSalesOrderAfterClaim } from './sales-order-claim-progress'

const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_LINE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const STORAGE_RECORD_ID = '99999999-9999-4999-8999-999999999999'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SHIPPED_AT = new Date('2026-10-20T00:00:00Z')
const RECEIVED_AT = new Date('2026-10-21T00:00:00Z')
const LOADED_AT = new Date('2026-10-22T00:00:00Z')

interface Part {
  readonly id: string
  readonly status: string
  readonly shippedAt: Date | null
  readonly warehouseReceivedAt: Date | null
  readonly loadedAt: Date | null
  readonly items: Array<{ quantity: number, line: { sourceSalesOrderLineId: string | null } }>
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: SHIPMENT_ID,
    items: [],
    loadedAt: null,
    shippedAt: SHIPPED_AT,
    status: 'ACTIVE',
    warehouseReceivedAt: RECEIVED_AT,
    ...overrides,
  }
}

function setup(overrides: {
  readonly fulfillmentStatus?: 'PENDING' | 'PREPARING' | 'LAND_TRANSIT' | 'WAREHOUSE_ARRIVED' | 'SEA_TRANSIT' | 'SIGNED'
  readonly orderStatus?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  readonly parts?: Part[]
  readonly claimedRows?: Array<{ salesOrderLineId: string, quantity: number }>
  readonly salesLines?: Array<{ id: string, quantity: number }>
} = {}) {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{
      fulfillmentStatus: overrides.fulfillmentStatus ?? 'PENDING',
      orderStatus: overrides.orderStatus ?? 'CONFIRMED',
    }]),
    salesOrder: { update: jest.fn().mockResolvedValue({}) },
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue(overrides.salesLines ?? [{
        id: SALES_LINE_ID,
        quantity: 1,
      }]),
    },
    purchaseOrderPart: {
      findMany: jest.fn().mockResolvedValue(overrides.parts ?? [part()]),
    },
    shipmentClaimLine: {
      findMany: jest.fn().mockResolvedValue(overrides.claimedRows ?? [{
        salesOrderLineId: SALES_LINE_ID,
        quantity: 1,
      }]),
    },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient
  const audit = { record: jest.fn().mockResolvedValue({}) }
  return {
    audit,
    run: () => advanceSalesOrderAfterClaim(transaction, audit, {
      actorUserId: ACTOR_ID,
      requestId: 'claim-progress-test',
      salesOrderId: SALES_ORDER_ID,
      shipmentId: SHIPMENT_ID,
      storageRecordId: STORAGE_RECORD_ID,
    }),
    transaction,
  }
}

describe('advanceSalesOrderAfterClaim', () => {
  it('advances a loaded claimed shipment through every hop to sea transit', async () => {
    const f = setup({ parts: [part({ loadedAt: LOADED_AT })] })

    await expect(f.run()).resolves.toBe('ADVANCED')

    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'SEA_TRANSIT', version: { increment: 1 } },
    })
    const historyCreate = f.transaction.salesOrderStatusHistory.create as unknown as jest.Mock
    const hops = historyCreate.mock.calls
      .map(([input]) => input as { data: { fromStatus: string, toStatus: string } })
      .map(({ data }) => `${data.fromStatus}->${data.toStatus}`)
    expect(hops).toEqual([
      'PENDING->PREPARING',
      'PREPARING->LAND_TRANSIT',
      'LAND_TRANSIT->WAREHOUSE_ARRIVED',
      'WAREHOUSE_ARRIVED->SEA_TRANSIT',
    ])
    expect(f.audit.record).toHaveBeenCalledWith(
      f.transaction,
      expect.objectContaining({
        metadata: expect.objectContaining({
          fromStatus: 'PENDING',
          steps: 4,
          storageRecordId: STORAGE_RECORD_ID,
          toStatus: 'SEA_TRANSIT',
          trigger: 'SHIPMENT_CLAIM',
        }) as unknown,
      }),
    )
  })

  it('stops at warehouse arrived when the claimed shipment is not loaded', async () => {
    const f = setup()

    await expect(f.run()).resolves.toBe('ADVANCED')

    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    expect(f.transaction.salesOrderStatusHistory.create).toHaveBeenCalledTimes(3)
  })

  it('stops at land transit when another owned shipment has not arrived', async () => {
    const f = setup({
      parts: [
        part({ loadedAt: LOADED_AT }),
        part({ id: 'part-2', warehouseReceivedAt: null }),
      ],
    })

    await expect(f.run()).resolves.toBe('ADVANCED')

    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'LAND_TRANSIT', version: { increment: 1 } },
    })
  })

  it('only advances to preparing when an owned shipment has not shipped', async () => {
    const f = setup({
      parts: [part({ loadedAt: LOADED_AT }), part({ id: 'part-2', shippedAt: null })],
    })

    await expect(f.run()).resolves.toBe('ADVANCED')

    expect(f.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'PREPARING', version: { increment: 1 } },
    })
    expect(f.transaction.salesOrderStatusHistory.create).toHaveBeenCalledTimes(1)
  })

  it('does not advance when the claimed quantities leave a line uncovered', async () => {
    const f = setup({ claimedRows: [] })

    await expect(f.run()).resolves.toBe('NOT_COVERED')

    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(f.audit.record).not.toHaveBeenCalled()
  })

  it('never regresses an order already past the fact-implied stage', async () => {
    const f = setup({
      fulfillmentStatus: 'SEA_TRANSIT',
      parts: [part({ loadedAt: LOADED_AT })],
    })

    await expect(f.run()).resolves.toBe('ALREADY_AHEAD')

    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('reports a state change without writing when the order is no longer confirmed', async () => {
    const f = setup({ orderStatus: 'COMPLETED' })

    await expect(f.run()).resolves.toBe('ORDER_STATE_CHANGED')

    expect(f.transaction.purchaseOrderPart.findMany).not.toHaveBeenCalled()
    expect(f.transaction.salesOrder.update).not.toHaveBeenCalled()
  })
})
