import { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { destinationWarehouses } from './purchase-destination-warehouse.fixture'
import { prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'
import { createAtomicityFixture, createCommands, createReviewMutations, prepareSalesSource, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

const LOADED_AT = new Date('2026-10-20T08:44:38.000Z')
const SIGNED_AT = new Date('2026-10-20T08:55:21.000Z')

async function prepareSignedShipment(fixture: AtomicityFixture, options: { readonly loaded: boolean }) {
  const source = await prepareSalesSource(fixture)
  const purchaseOrderId = await createCommands(fixture).create(fixture.context(), source.input)
  await createReviewMutations(fixture).review(fixture.context(), purchaseOrderId, await prepareImageReview(fixture, purchaseOrderId))
  let purchase = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { version: true, parts: { select: { id: true } } } })
  await withDatabaseBusinessClock(fixture.prisma, () => new PurchaseOrderFactoryShipmentService(
    fixture.prisma,
    fixture.audit,
    fixture.salesProgress,
    new DictionaryLookupService(fixture.prisma),
  ).shipPurchaseOrder(fixture.context(), purchaseOrderId, {
    expectedVersion: purchase.version,
    partIds: purchase.parts.map(part => part.id),
    destinationWarehouses: destinationWarehouses(purchase.parts.map(part => part.id)),
  }))
  purchase = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { version: true, parts: { select: { id: true } } } })
  const query = new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma), createPaymentRecipientFixture(fixture.prisma))
  await withDatabaseBusinessClock(fixture.prisma, () => new PurchaseOrderWarehouseReceiptService(
    fixture.prisma,
    fixture.audit,
    query,
  ).receive(fixture.context(), purchaseOrderId, {
    expectedVersion: purchase.version,
    partIds: purchase.parts.map(part => part.id),
    remark: null,
  }))

  const partId = purchase.parts[0].id
  if (options.loaded) {
    await fixture.prisma.purchaseOrderPart.updateMany({
      where: { id: partId },
      data: { loadedAt: LOADED_AT, loadedById: fixture.actor.id, loadedRecordedAt: LOADED_AT },
    })
  }
  await fixture.prisma.salesOrderStatusHistory.create({ data: {
    salesOrderId: source.source.id,
    dimension: 'FULFILLMENT',
    fromStatus: 'SEA_TRANSIT',
    toStatus: 'SIGNED',
    reason: 'legacy sign before delivery migration',
    changedByUserId: fixture.actor.id,
    changedAt: SIGNED_AT,
  } })
  await fixture.prisma.salesOrder.update({
    where: { id: source.source.id },
    data: { fulfillmentStatus: 'SIGNED', version: { increment: 1 } },
  })
  return { salesOrderId: source.source.id, partId }
}

describe('purchase shipment delivery migration with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  it('backfills existing signed orders from the sign history and keeps the order signed', async () => {
    const fixture = await createAtomicityFixture(false, false, false, false, true)
    try {
      const prepared = await prepareSignedShipment(fixture, { loaded: true })
      await fixture.migrateShipmentDelivery()
      const part = await fixture.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: prepared.partId } })
      expect(part).toMatchObject({
        deliveredAt: SIGNED_AT,
        deliveredById: fixture.actor.id,
        deliveredRecordedAt: SIGNED_AT,
      })
      expect((await fixture.prisma.salesOrder.findUniqueOrThrow({ where: { id: prepared.salesOrderId } })).fulfillmentStatus).toBe('SIGNED')
      const triggers = await fixture.prisma.$queryRaw<Array<{ tgname: string }>>(Prisma.sql`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'sales_orders'::regclass AND NOT tgisinternal
      `)
      expect(triggers.map(trigger => trigger.tgname)).toContain('sales_orders_shipment_delivery_trigger')
    }
    finally { await fixture.dispose() }
  })

  it('fails closed when a signed order still has an unloaded active shipment', async () => {
    const fixture = await createAtomicityFixture(false, false, false, false, true)
    try {
      await prepareSignedShipment(fixture, { loaded: false })
      await expect(fixture.migrateShipmentDelivery()).rejects.toMatchObject({
        code: '23514',
        constraint: 'purchase_shipment_delivery_backfill_check',
      })
    }
    finally { await fixture.dispose() }
  })
})
