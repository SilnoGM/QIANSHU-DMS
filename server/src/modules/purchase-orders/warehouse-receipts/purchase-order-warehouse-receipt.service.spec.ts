import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { PurchaseOrderQueryService } from '../purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from './purchase-order-warehouse-receipt.service'

const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', partId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const context = { actorUserId: actor, requestId: 'warehouse-request' }
const now = new Date('2026-09-15T02:00:00.000Z')
const salesOrderId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

interface Part { id: string, status: string, partNumber: number, shippedAt: Date | null, warehouseReceivedAt: Date | null, warehouseReceivedById: string | null, warehouseRecordedAt: Date | null, warehouseRemark: string | null }

function setup() {
  const part: Part = { id: partId, status: 'ACTIVE', partNumber: 1, shippedAt: new Date('2026-09-15T01:00:00.000Z'), warehouseReceivedAt: null, warehouseReceivedById: null, warehouseRecordedAt: null, warehouseRemark: null }
  const order = { id: orderId, orderNo: 'PO-1', version: 3, purchaseType: 'STOCK', salesOrderId: null, orderStatus: 'CONFIRMED', fulfillmentStatus: 'SHIPPED', paymentStatus: 'UNPAID', parts: [part] }
  const tx = {
    $queryRaw: jest.fn().mockImplementation((query: { text: string }) => Promise.resolve(query.text.includes('clock_timestamp') ? [{ now }] : [{ id: orderId }])),
    purchaseOrder: { findUnique: jest.fn().mockResolvedValue(order), findFirst: jest.fn().mockResolvedValue(order), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    salesOrder: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    salesOrderLine: { findMany: jest.fn() },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    purchaseOrderPart: { count: jest.fn().mockImplementation((input: { where: { shippedAt: { gt: Date } } }) => Promise.resolve(order.parts.filter(item => item.shippedAt !== null && item.shippedAt > input.where.shippedAt.gt).length)), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(null) },
  }
  const prisma = { $transaction: jest.fn().mockImplementation((run: (transaction: typeof tx) => Promise<unknown>) => run(tx)) }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const query = { getById: jest.fn().mockResolvedValue({ id: orderId }) }
  return { tx, prisma, audit, query, order, part, service: new PurchaseOrderWarehouseReceiptService(prisma as unknown as PrismaService, audit, query as unknown as PurchaseOrderQueryService) }
}

function setupSalesLinked() {
  const fixture = setup()
  Object.assign(fixture.order, { purchaseType: 'SALES_LINKED', salesOrderId })
  const salesOrder = { id: salesOrderId, orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' }
  const receivedPart = {
    status: 'ACTIVE', shippedAt: fixture.part.shippedAt, warehouseReceivedAt: now as Date | null,
    items: [{ quantity: 1, line: { sourceSalesOrderLineId: 'sales-line-1' } }],
  }
  const purchases = [{ orderStatus: 'CONFIRMED', parts: [receivedPart] }]
  fixture.tx.salesOrder.findUnique.mockResolvedValue(salesOrder)
  fixture.tx.salesOrderLine.findMany.mockResolvedValue([{ id: 'sales-line-1', quantity: 1 }])
  fixture.tx.purchaseOrder.findMany.mockResolvedValue(purchases)
  return { ...fixture, salesOrder, receivedPart, purchases }
}

describe('PurchaseOrderWarehouseReceiptService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('advances the linked sales order with history and audit in the receipt transaction after all quantities arrive', async () => {
    const fixture = setupSalesLinked()
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).toHaveBeenCalledWith({ where: { id: salesOrderId }, data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } } })
    expect(fixture.tx.salesOrderStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ salesOrderId, dimension: 'FULFILLMENT', fromStatus: 'LAND_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED', changedByUserId: actor }) as unknown })
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.tx, expect.objectContaining({ eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED', targetId: salesOrderId, metadata: expect.objectContaining({ automatic: true, trigger: 'PURCHASE_WAREHOUSE_RECEIPT' }) as unknown }))
    const locks = fixture.tx.$queryRaw.mock.calls.map(([query]: [{ text: string }]) => query.text)
    const salesLock = locks.findIndex(sql => /FROM sales_orders .*FOR UPDATE/u.test(sql))
    const partsLock = locks.findIndex(sql => /FROM purchase_order_parts .*FOR UPDATE/u.test(sql))
    expect(salesLock).toBeGreaterThanOrEqual(0)
    expect(salesLock).toBeLessThan(partsLock)
  })

  it('waits for every active part across all purchases, including when a different purchase has not arrived', async () => {
    const fixture = setupSalesLinked()
    fixture.purchases.push({ orderStatus: 'CONFIRMED', parts: [{ ...fixture.receivedPart, warehouseReceivedAt: null }] })
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.tx.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salesOrderId, purchaseType: 'SALES_LINKED', orderStatus: { not: 'CANCELLED' } } }))
  })

  it('does not advance with another unapproved purchase', async () => {
    const fixture = setupSalesLinked()
    fixture.purchases.push({ orderStatus: 'PENDING_REVIEW', parts: [fixture.receivedPart] })
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it('does not advance when arrived quantities fail to cover a sales line', async () => {
    const fixture = setupSalesLinked()
    fixture.tx.salesOrderLine.findMany.mockResolvedValue([{ id: 'sales-line-1', quantity: 2 }])
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it('does not let surplus received quantities on one sales line cover another line', async () => {
    const fixture = setupSalesLinked()
    fixture.receivedPart.items[0].quantity = 2
    fixture.tx.salesOrderLine.findMany.mockResolvedValue([{ id: 'sales-line-1', quantity: 1 }, { id: 'sales-line-2', quantity: 1 }])
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it.each(['PENDING_REVIEW', 'CANCELLED'])('does not treat an order without active received parts as complete: %s', async status => {
    const fixture = setupSalesLinked()
    fixture.receivedPart.status = status
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it('requires at least one remaining sales line', async () => {
    const fixture = setupSalesLinked()
    fixture.tx.salesOrderLine.findMany.mockResolvedValue([])
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it('ignores cancelled parts and removed sales lines when all remaining quantities are received', async () => {
    const fixture = setupSalesLinked()
    fixture.purchases[0].orderStatus = 'COMPLETED'
    fixture.purchases[0].parts.push({ ...fixture.receivedPart, status: 'CANCELLED', warehouseReceivedAt: null })
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).toHaveBeenCalledTimes(1)
    expect(fixture.tx.salesOrderLine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salesOrderId, removedAt: null } }))
  })

  it.each(['PENDING', 'PREPARING', 'WAREHOUSE_ARRIVED', 'SEA_TRANSIT', 'SIGNED'])('never skips or regresses sales fulfillment: %s', async fulfillmentStatus => {
    const fixture = setupSalesLinked()
    fixture.salesOrder.fulfillmentStatus = fulfillmentStatus
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it.each(['CANCELLED', 'COMPLETED'])('does not change a terminal sales order: %s', async orderStatus => {
    const fixture = setupSalesLinked()
    fixture.salesOrder.orderStatus = orderStatus
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.salesOrder.update).not.toHaveBeenCalled()
  })

  it('also synchronizes sales when receiving through legacy whole-order signing', async () => {
    const fixture = setupSalesLinked()
    await fixture.service.receiveAll(context, orderId, null)
    expect(fixture.tx.salesOrder.update).toHaveBeenCalledTimes(1)
  })

  it('records actual current warehouse receipt and advances the whole order only once', async () => {
    const fixture = setup()
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId], remark: '已核对' })
    expect(fixture.tx.purchaseOrderPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { warehouseReceivedAt: now, warehouseReceivedById: actor, warehouseRecordedAt: now, warehouseRemark: '已核对' } }))
    expect(fixture.tx.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: orderId }, data: { fulfillmentStatus: 'SIGNED', orderStatus: 'CONFIRMED', version: { increment: 1 } } })
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.tx, expect.objectContaining({ eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED', metadata: expect.objectContaining({ partIds: [partId] }) as unknown }))
    expect(fixture.tx.salesOrder.findUnique).not.toHaveBeenCalled()
  })

  it('keeps partial shipment status when an already shipped part arrives before the remaining parts ship', async () => {
    const fixture = setup()
    fixture.order.fulfillmentStatus = 'PARTIALLY_SHIPPED'
    fixture.order.parts.push({ ...fixture.part, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', shippedAt: null })
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: orderId }, data: { fulfillmentStatus: 'PARTIALLY_SHIPPED', orderStatus: 'CONFIRMED', version: { increment: 1 } } })
    expect(fixture.tx.purchaseOrderStatusHistory.create).not.toHaveBeenCalled()
  })

  it('automatically completes an already paid order when every valid part has arrived', async () => {
    const fixture = setup(); fixture.order.paymentStatus = 'PAID'
    await fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId] })
    expect(fixture.tx.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'COMPLETED', fulfillmentStatus: 'SIGNED' }) as unknown }))
  })

  it.each(['2026-09-15T00:59:59Z', '2026-09-15T02:00:01Z'])('rejects receipt time outside the shipment/current-time bounds: %s', async receivedAt => {
    const fixture = setup()
    await expect(fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: [partId], receivedAt })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID' })
    expect(fixture.tx.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('rejects stale versions and a mixture of old and new receipt facts without overwriting anything', async () => {
    const fixture = setup()
    await expect(fixture.service.receive(context, orderId, { expectedVersion: 2, partIds: [partId] })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' })
    fixture.order.parts.push({ ...fixture.part, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', warehouseReceivedAt: now })
    await expect(fixture.service.receive(context, orderId, { expectedVersion: 3, partIds: fixture.order.parts.map(part => part.id) })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' })
    expect(fixture.tx.purchaseOrderPart.updateMany).not.toHaveBeenCalled()
  })

  it('only accepts an original replay while all stored receipt facts still match its trusted audit', async () => {
    const fixture = setup()
    Object.assign(fixture.part, { warehouseReceivedAt: now, warehouseRecordedAt: now, warehouseReceivedById: actor, warehouseRemark: 'checked' })
    fixture.order.version = 4
    fixture.order.fulfillmentStatus = 'SIGNED'
    fixture.tx.auditEvent.findFirst.mockResolvedValue({ metadata: {
      expectedVersion: 3, source: 'SHIPMENT_SELECTION', partIds: [partId], receivedAt: now.toISOString(), recordedAt: now.toISOString(), remark: 'checked',
    } })
    const input = { expectedVersion: 3, partIds: [partId], remark: 'checked' }
    await fixture.service.receive(context, orderId, input)
    expect(fixture.tx.purchaseOrder.update).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
    expect(fixture.tx.auditEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED', actorType: 'USER', actorUserId: actor, targetType: 'PURCHASE_ORDER', targetId: orderId, outcome: 'SUCCESS' }) as unknown }))
    fixture.part.warehouseRemark = 'changed'
    await expect(fixture.service.receive(context, orderId, input)).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' })
  })

  it('routes legacy whole-order signing through receipt facts and rejects any unshipped part', async () => {
    const fixture = setup()
    fixture.part.shippedAt = null
    await expect(fixture.service.receiveAll(context, orderId, null)).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED' })
    expect(fixture.tx.purchaseOrder.update).not.toHaveBeenCalled()
  })
})
