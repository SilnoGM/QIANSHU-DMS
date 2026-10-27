import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import {
  advanceSalesOrdersWhenAllShipmentsLoaded,
  lockSalesOrderChains,
  retreatSalesOrdersWhenShipmentsUnloaded,
  salesOrderIdsOfShipments,
} from './sales-order-container-load-progress'

type Part = {
  status: string
  warehouseReceivedAt: Date | null
  loadedAt: Date | null
  items: Array<{ quantity: number, line: { sourceSalesOrderLineId: string | null } }>
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    status: 'ACTIVE', warehouseReceivedAt: new Date('2026-09-14T00:00:00Z'), loadedAt: new Date('2026-09-15T00:00:00Z'),
    items: [{ quantity: 1, line: { sourceSalesOrderLineId: 'line-1' } }], ...overrides,
  }
}

function fixture() {
  const salesOrder = { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) }
  const salesOrderLine = { findMany: jest.fn().mockResolvedValue([{ id: 'line-1', quantity: 1 }]) }
  const purchaseOrder = { findMany: jest.fn().mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part()] }]) }
  const salesOrderStatusHistory = { create: jest.fn().mockResolvedValue({}) }
  const purchaseOrderPart = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
  const salesOrderDocument = { count: jest.fn().mockResolvedValue(0) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const invoked: unknown[] = []
  const transaction = {
    salesOrder, salesOrderLine, purchaseOrder, salesOrderStatusHistory, purchaseOrderPart, salesOrderDocument,
    $queryRaw: jest.fn((sql: unknown) => { invoked.push(sql); return Promise.resolve([]) }),
  }
  const run = (salesOrderIds: readonly string[] = ['so-1']) => advanceSalesOrdersWhenAllShipmentsLoaded(
    transaction as unknown as PrismaService,
    audit,
    { actorUserId: 'actor-1', containerBatchId: 'batch-1', requestId: 'request-1', salesOrderIds },
  )
  const retreat = (salesOrderIds: readonly string[] = ['so-1']) => retreatSalesOrdersWhenShipmentsUnloaded(
    transaction as unknown as PrismaService,
    audit,
    { actorUserId: 'actor-1', containerBatchId: 'batch-1', requestId: 'request-1', shipmentId: 'part-1', salesOrderIds },
  )
  return { salesOrder, salesOrderLine, purchaseOrder, salesOrderStatusHistory, purchaseOrderPart, salesOrderDocument, audit, transaction, invoked, run, retreat }
}

describe('advanceSalesOrdersWhenAllShipmentsLoaded', () => {
  it('advances every fully loaded order with history and container-load audit', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' })
    f.salesOrderLine.findMany.mockResolvedValue([{ id: 'line-1', quantity: 2 }])
    f.purchaseOrder.findMany.mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part(), part()] }])
    await f.run()
    expect(f.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'so-1' },
      data: { fulfillmentStatus: 'SEA_TRANSIT', version: { increment: 1 } },
    })
    expect(f.salesOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      salesOrderId: 'so-1', dimension: 'FULFILLMENT', fromStatus: 'WAREHOUSE_ARRIVED', toStatus: 'SEA_TRANSIT', changedByUserId: 'actor-1',
    }) as unknown })
    expect(f.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', targetType: 'SALES_ORDER', targetId: 'so-1',
      metadata: expect.objectContaining({ automatic: true, fromStatus: 'WAREHOUSE_ARRIVED', toStatus: 'SEA_TRANSIT', trigger: 'CONTAINER_LOAD', containerBatchId: 'batch-1' }) as unknown,
    }))
  })

  it.each([
    ['非候选订单状态', { orderStatus: 'COMPLETED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' }],
    ['订单尚未到仓', { orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' }],
    ['订单已经推进过', { orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' }],
  ])('skips %s', async (_label, state) => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue(state)
    await f.run()
    expect(f.salesOrder.update).not.toHaveBeenCalled()
    expect(f.purchaseOrder.findMany).not.toHaveBeenCalled()
    expect(f.audit.record).not.toHaveBeenCalled()
  })

  const blockingCases: ReadonlyArray<readonly [string, { purchases: Array<{ orderStatus: string, parts: Part[] }>, salesLines?: Array<{ id: string, quantity: number }> }]> = [
    ['没有有效关联采购单', { purchases: [] }],
    ['采购单尚未生效', { purchases: [{ orderStatus: 'PENDING_REVIEW', parts: [part()] }] }],
    ['存在待审核货件', { purchases: [{ orderStatus: 'CONFIRMED', parts: [part(), part({ status: 'PENDING_REVIEW' })] }] }],
    ['没有有效货件', { purchases: [{ orderStatus: 'CONFIRMED', parts: [part({ status: 'CANCELLED' })] }] }],
    ['货件尚未到仓', { purchases: [{ orderStatus: 'CONFIRMED', parts: [part({ warehouseReceivedAt: null })] }] }],
    ['货件尚未装柜', { purchases: [{ orderStatus: 'CONFIRMED', parts: [part({ loadedAt: null })] }] }],
    ['入仓数量未覆盖销售明细', { purchases: [{ orderStatus: 'CONFIRMED', parts: [part()] }], salesLines: [{ id: 'line-1', quantity: 2 }] }],
  ]
  it.each(blockingCases)('keeps the order unchanged when %s', async (_label, setup) => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' })
    f.purchaseOrder.findMany.mockResolvedValue(setup.purchases)
    f.salesOrderLine.findMany.mockResolvedValue(setup.salesLines ?? [{ id: 'line-1', quantity: 1 }])
    await f.run()
    expect(f.salesOrder.update).not.toHaveBeenCalled()
    expect(f.salesOrderStatusHistory.create).not.toHaveBeenCalled()
    expect(f.audit.record).not.toHaveBeenCalled()
  })

  it('excludes cancelled purchases from the query and cancelled shipments from the judgement', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' })
    f.purchaseOrder.findMany.mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part({ status: 'CANCELLED', loadedAt: null, warehouseReceivedAt: null }), part()] }])
    await f.run()
    expect(f.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purchaseType: 'SALES_LINKED', orderStatus: { not: 'CANCELLED' } }) as unknown,
    }))
    expect(f.salesOrder.update).toHaveBeenCalledTimes(1)
  })

  it('advances only the orders whose shipments are all loaded', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
      where.id === 'so-2' ? { orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' } : { orderStatus: 'CONFIRMED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' },
    ))
    await f.run(['so-2', 'so-1'])
    expect(f.salesOrder.update).toHaveBeenCalledTimes(1)
    expect(f.salesOrder.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'so-1' } }))
  })
})

describe('retreatSalesOrdersWhenShipmentsUnloaded', () => {
  it('retreats a sea-transit order that no longer has every shipment loaded', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    f.purchaseOrder.findMany.mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part({ loadedAt: null })] }])
    await f.retreat()
    expect(f.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'so-1' },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    expect(f.salesOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      salesOrderId: 'so-1', dimension: 'FULFILLMENT', fromStatus: 'SEA_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED', changedByUserId: 'actor-1',
    }) as unknown })
    expect(f.audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', targetType: 'SALES_ORDER', targetId: 'so-1',
      metadata: expect.objectContaining({ automatic: true, fromStatus: 'SEA_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED', trigger: 'CONTAINER_UNLOAD', containerBatchId: 'batch-1', shipmentId: 'part-1' }) as unknown,
    }))
  })

  it('keeps the order in sea transit while every shipment is still loaded', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    await f.retreat()
    expect(f.salesOrder.update).not.toHaveBeenCalled()
    expect(f.audit.record).not.toHaveBeenCalled()
  })

  it.each([
    ['订单已签收', { orderStatus: 'CONFIRMED', fulfillmentStatus: 'SIGNED' }],
    ['订单不是有效状态', { orderStatus: 'COMPLETED', fulfillmentStatus: 'SEA_TRANSIT' }],
    ['订单仍在陆运', { orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' }],
  ])('skips %s', async (_label, state) => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue(state)
    await f.retreat()
    expect(f.salesOrder.update).not.toHaveBeenCalled()
    expect(f.purchaseOrder.findMany).not.toHaveBeenCalled()
  })

  it('keeps the order when a shipment of the same order is already delivered', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    f.purchaseOrder.findMany.mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part({ loadedAt: null })] }])
    f.purchaseOrderPart.count.mockResolvedValueOnce(1)
    await f.retreat()
    expect(f.purchaseOrderPart.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'ACTIVE', deliveredAt: { not: null } }) as unknown,
    }))
    expect(f.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the order when an active delivery receipt exists', async () => {
    const f = fixture()
    f.salesOrder.findUnique.mockResolvedValue({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' })
    f.purchaseOrder.findMany.mockResolvedValue([{ orderStatus: 'CONFIRMED', parts: [part({ loadedAt: null })] }])
    f.salesOrderDocument.count.mockResolvedValueOnce(1)
    await f.retreat()
    expect(f.salesOrderDocument.count).toHaveBeenCalledWith({
      where: { salesOrderId: 'so-1', documentType: 'DELIVERY_RECEIPT', detachedAt: null },
    })
    expect(f.salesOrder.update).not.toHaveBeenCalled()
  })
})

describe('container loading sales order locks and resolution', () => {
  it('locks sales lines, related purchases and the order for every id in ascending order', async () => {
    const f = fixture()
    await lockSalesOrderChains(f.transaction as unknown as PrismaService, ['so-2', 'so-1', 'so-1'])
    expect(f.transaction.$queryRaw).toHaveBeenCalledTimes(6)
    expect(JSON.stringify(f.invoked)).toMatch(/sales_order_lines[\s\S]*purchase_orders[\s\S]*sales_orders[\s\S]*sales_order_lines[\s\S]*purchase_orders[\s\S]*sales_orders/u)
  })

  it('resolves deduplicated sales orders of the associated shipments', async () => {
    const f = fixture()
    f.purchaseOrderPart.findMany.mockResolvedValue([
      { purchaseOrder: { salesOrderId: 'so-2' } }, { purchaseOrder: { salesOrderId: 'so-1' } },
      { purchaseOrder: { salesOrderId: 'so-2' } }, { purchaseOrder: { salesOrderId: null } },
    ])
    expect(await salesOrderIdsOfShipments(f.transaction as unknown as PrismaService, ['part-2', 'part-1'])).toEqual(['so-1', 'so-2'])
    f.purchaseOrderPart.findMany.mockClear()
    expect(await salesOrderIdsOfShipments(f.transaction as unknown as PrismaService, [])).toEqual([])
    expect(f.purchaseOrderPart.findMany).not.toHaveBeenCalled()
  })
})
