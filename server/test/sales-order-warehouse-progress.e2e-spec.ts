import { randomUUID } from 'node:crypto'

import { AuditService, AuditWriteFailedError } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
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
})
