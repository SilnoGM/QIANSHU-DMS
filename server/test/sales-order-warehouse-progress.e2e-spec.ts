import { randomUUID } from 'node:crypto'

import { AuditService, AuditWriteFailedError } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { SalesOrderWarehouseReceiptQueryService } from '../src/modules/purchase-orders/warehouse-receipts/sales-order-warehouse-receipt-query.service'
import { SalesOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/sales-order-warehouse-receipt.service'
import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { destinationWarehouses } from './purchase-destination-warehouse.fixture'
import {
  createAtomicityFixture, createCommands, createReviewMutations, prepareImageReview, prepareSalesSource,
  type AtomicityFixture,
} from './purchase-shipping-mark-atomicity.fixture'

describe('sales fulfillment after warehouse receipt with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  beforeEach(async () => { fixture = await createAtomicityFixture() })
  afterEach(async () => { await fixture?.dispose() })

  function receipts(audit = fixture.audit) {
    return new PurchaseOrderWarehouseReceiptService(fixture.prisma, audit,
      new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma), createPaymentRecipientFixture(fixture.prisma)))
  }

  function salesReceipts(audit = fixture.audit) {
    return new SalesOrderWarehouseReceiptService(fixture.prisma, audit, receipts(audit))
  }

  function salesContext() {
    return new SalesOrderWarehouseReceiptQueryService(
      fixture.prisma,
      new DictionaryLookupService(fixture.prisma),
    )
  }

  async function prepare(quantities: number[]) {
    const { source, input } = await prepareSalesSource(fixture)
    const total = quantities.reduce((sum, count) => sum + count, 0)
    await fixture.prisma.salesOrder.update({ where: { id: source.id }, data: {
      lineSubtotalAmount: String(total * 10), agreedTotalAmount: String(total * 10), balanceDueAmount: String(total * 10),
      lines: { update: { where: { id: source.lines[0].id }, data: { quantity: total, lineTotalAmount: String(total * 10) } } },
    } })
    const orders = []
    for (const quantity of quantities) {
      const id = await createCommands(fixture).create(fixture.context(), {
        ...input, lines: [{ ...input.lines[0], quantity }],
        parts: Array.from({ length: quantity }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
        purchaseTotalAmount: String(quantity * 10), balanceDueAmount: String(quantity * 10),
      })
      await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
      const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: true } })
      const partIds = order.parts.map(part => part.id)
      await withDatabaseBusinessClock(fixture.prisma, () => new PurchaseOrderFactoryShipmentService(
        fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma),
      ).shipPurchaseOrder(fixture.context(), id, { expectedVersion: order.version, partIds, destinationWarehouses: destinationWarehouses(partIds) }))
      orders.push(await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: true } }))
    }
    const salesOrder = await fixture.prisma.salesOrder.findUniqueOrThrow({ where: { id: source.id } })
    expect(salesOrder.fulfillmentStatus).toBe('LAND_TRANSIT')
    return { salesOrder, orders }
  }

  async function progress(salesOrderId: string) {
    return {
      order: await fixture.prisma.salesOrder.findUniqueOrThrow({ where: { id: salesOrderId } }),
      history: await fixture.prisma.salesOrderStatusHistory.findMany({ where: { salesOrderId, toStatus: 'WAREHOUSE_ARRIVED' } }),
      audit: await fixture.prisma.auditEvent.findMany({ where: {
        targetId: salesOrderId, eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
        metadata: { path: ['trigger'], equals: 'PURCHASE_WAREHOUSE_RECEIPT' },
      } }),
    }
  }

  async function batchTargets(salesOrderId: string) {
    const context = await salesContext().getContext(salesOrderId)
    return {
      context,
      targets: context.purchaseOrders.map(order => ({
        purchaseOrderId: order.id,
        expectedVersion: order.version,
        partIds: order.parts.map(part => part.id),
      })),
    }
  }

  it('waits for the last part, then synchronizes exactly once even when original requests replay', async () => {
    const { salesOrder, orders: [order] } = await prepare([2])
    const service = receipts(), context = fixture.context()
    const firstInput = { expectedVersion: order.version, partIds: [order.parts[0].id] }
    const partial = await service.receive(context, order.id, firstInput)
    expect((await progress(salesOrder.id)).order).toMatchObject({ fulfillmentStatus: 'LAND_TRANSIT', version: salesOrder.version })
    const lastInput = { expectedVersion: partial.version, partIds: [order.parts[1].id] }
    await service.receive(context, order.id, lastInput)
    const after = await progress(salesOrder.id)
    expect(after.order).toMatchObject({ fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: salesOrder.version + 1 })
    expect(after.history).toHaveLength(1)
    expect(after.audit).toHaveLength(1)
    await service.receive(context, order.id, firstInput)
    await service.receive(context, order.id, lastInput)
    expect(await progress(salesOrder.id)).toEqual(after)
  })

  it('waits for all linked purchases and serializes concurrent receipts into a single sales transition', async () => {
    const { salesOrder, orders } = await prepare([1, 1, 1])
    const service = receipts()
    await service.receive(fixture.context(), orders[0].id, { expectedVersion: orders[0].version, partIds: orders[0].parts.map(part => part.id) })
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('LAND_TRANSIT')
    await Promise.all(orders.slice(1).map(order => service.receive(fixture.context(), order.id, {
      expectedVersion: order.version, partIds: order.parts.map(part => part.id),
    })))
    const after = await progress(salesOrder.id)
    expect(after.order).toMatchObject({ fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: salesOrder.version + 1 })
    expect(after.history).toHaveLength(1)
    expect(after.audit).toHaveLength(1)
  })

  it('rolls sales, purchase, receipt facts and histories back together if the sales audit fails', async () => {
    const { salesOrder, orders: [order] } = await prepare([1])
    const before = await progress(salesOrder.id)
    const audit = new AuditService(), realRecord = audit.record.bind(audit)
    jest.spyOn(audit, 'record').mockImplementation((transaction, input) => {
      if (input.eventType === 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED') throw new AuditWriteFailedError()
      return realRecord(transaction, input)
    })
    const input = { expectedVersion: order.version, partIds: order.parts.map(part => part.id) }
    const purchaseHistoryBefore = await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id } })
    await expect(receipts(audit).receive(fixture.context(), order.id, input)).rejects.toBeInstanceOf(AuditWriteFailedError)
    expect(await progress(salesOrder.id)).toEqual(before)
    expect(await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: { parts: true } })).toEqual(order)
    expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id } })).toBe(purchaseHistoryBefore)
    expect(await fixture.prisma.auditEvent.count({ where: { targetId: order.id, eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED' } })).toBe(0)
    await receipts().receive(fixture.context(), order.id, input)
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('WAREHOUSE_ARRIVED')
  })

  it('receives every selected purchase order in one transaction and replays without a second transition', async () => {
    const { salesOrder, orders } = await prepare([1, 1])
    const { context, targets } = await batchTargets(salesOrder.id)
    expect(context.purchaseOrders).toHaveLength(2)
    expect(context.pendingReceiptPartCount).toBe(2)
    const service = salesReceipts()
    const request = { targets }
    const result = await withDatabaseBusinessClock(
      fixture.prisma,
      () => service.receive(fixture.context(), salesOrder.id, request),
    )
    expect(result).toMatchObject({
      receivedPartCount: 2,
      changedPurchaseOrderCount: 2,
      remainingPendingReceiptCount: 0,
      salesOrder: {
        id: salesOrder.id,
        fulfillmentStatus: 'WAREHOUSE_ARRIVED',
        advancedToWarehouseArrived: true,
      },
    })
    expect(result.purchaseOrders).toHaveLength(2)
    const after = await progress(salesOrder.id)
    expect(after.order).toMatchObject({ fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: salesOrder.version + 1 })
    expect(after.history).toHaveLength(1)
    expect(after.audit).toHaveLength(1)
    for (const order of orders) {
      expect(await fixture.prisma.purchaseOrderPart.count({
        where: { purchaseOrderId: order.id, warehouseReceivedAt: null },
      })).toBe(0)
    }
    await expect(salesContext().getContext(salesOrder.id)).rejects.toMatchObject({
      code: 'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED',
    })

    const replay = await withDatabaseBusinessClock(
      fixture.prisma,
      () => service.receive(fixture.context(), salesOrder.id, request),
    )
    expect(replay).toMatchObject({
      receivedPartCount: 0,
      changedPurchaseOrderCount: 0,
      remainingPendingReceiptCount: 0,
      salesOrder: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', advancedToWarehouseArrived: false },
    })
    expect(await progress(salesOrder.id)).toEqual(after)
  })

  it('keeps the sales order in transit after a partial range and advances on the remaining range', async () => {
    const { salesOrder, orders } = await prepare([1, 1])
    const { targets } = await batchTargets(salesOrder.id)
    const service = salesReceipts()
    const partial = await withDatabaseBusinessClock(
      fixture.prisma,
      () => service.receive(fixture.context(), salesOrder.id, { targets: [targets[0]] }),
    )
    expect(partial).toMatchObject({
      receivedPartCount: 1,
      changedPurchaseOrderCount: 1,
      remainingPendingReceiptCount: 1,
      salesOrder: { fulfillmentStatus: 'LAND_TRANSIT', advancedToWarehouseArrived: false },
    })
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('LAND_TRANSIT')
    const remainingContext = await salesContext().getContext(salesOrder.id)
    expect(remainingContext.purchaseOrders).toHaveLength(1)
    expect(remainingContext.purchaseOrders[0].id).not.toBe(targets[0].purchaseOrderId)

    const final = await withDatabaseBusinessClock(
      fixture.prisma,
      () => service.receive(fixture.context(), salesOrder.id, { targets: [targets[1]] }),
    )
    expect(final).toMatchObject({
      receivedPartCount: 1,
      changedPurchaseOrderCount: 1,
      remainingPendingReceiptCount: 0,
      salesOrder: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', advancedToWarehouseArrived: true },
    })
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('WAREHOUSE_ARRIVED')
    expect(orders).toHaveLength(2)
  })

  it('rejects stale versions, foreign parts and times before shipment without persisting any target', async () => {
    const { salesOrder, orders } = await prepare([1, 1])
    const { targets } = await batchTargets(salesOrder.id)
    const service = salesReceipts()
    await expect(service.receive(fixture.context(), salesOrder.id, {
      targets: [{ ...targets[0], expectedVersion: targets[0].expectedVersion + 1 }],
    })).rejects.toMatchObject({ code: 'SALES_WAREHOUSE_RECEIPT_STATE_CHANGED' })
    await expect(service.receive(fixture.context(), salesOrder.id, {
      targets: [{ purchaseOrderId: orders[0].id, expectedVersion: orders[0].version, partIds: [orders[1].parts[0].id] }],
    })).rejects.toMatchObject({ code: 'SALES_WAREHOUSE_RECEIPT_TARGET_INVALID' })
    const earliestShippedAt = Math.min(...orders.flatMap(order => order.parts.map(part => new Date(part.shippedAt!).getTime())))
    await expect(service.receive(fixture.context(), salesOrder.id, {
      targets,
      receivedAt: new Date(earliestShippedAt - 60_000).toISOString(),
    })).rejects.toMatchObject({ code: 'SALES_WAREHOUSE_RECEIPT_TIME_BEFORE_SHIPMENT' })
    expect(await fixture.prisma.purchaseOrderPart.count({
      where: { purchaseOrderId: { in: orders.map(order => order.id) }, warehouseReceivedAt: { not: null } },
    })).toBe(0)
    expect(await fixture.prisma.auditEvent.count({
      where: {
        targetId: { in: orders.map(order => order.id) },
        eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED',
      },
    })).toBe(0)
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('LAND_TRANSIT')
  })

  it('rolls every purchase order back when the single sales transition audit fails', async () => {
    const { salesOrder, orders } = await prepare([1, 1])
    const { targets } = await batchTargets(salesOrder.id)
    const audit = new AuditService(), realRecord = audit.record.bind(audit)
    jest.spyOn(audit, 'record').mockImplementation((transaction, input) => {
      if (input.eventType === 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED') throw new AuditWriteFailedError()
      return realRecord(transaction, input)
    })
    await expect(withDatabaseBusinessClock(
      fixture.prisma,
      () => salesReceipts(audit).receive(fixture.context(), salesOrder.id, { targets }),
    )).rejects.toBeInstanceOf(AuditWriteFailedError)
    expect(await fixture.prisma.purchaseOrderPart.count({
      where: { purchaseOrderId: { in: orders.map(order => order.id) }, warehouseReceivedAt: { not: null } },
    })).toBe(0)
    expect(await fixture.prisma.auditEvent.count({
      where: {
        targetId: { in: orders.map(order => order.id) },
        eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED',
      },
    })).toBe(0)
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('LAND_TRANSIT')
    await withDatabaseBusinessClock(
      fixture.prisma,
      () => salesReceipts().receive(fixture.context(), salesOrder.id, { targets }),
    )
    expect((await progress(salesOrder.id)).order.fulfillmentStatus).toBe('WAREHOUSE_ARRIVED')
  })
})
