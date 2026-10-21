import { randomUUID } from 'node:crypto'

import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { DataScopeService } from '../src/modules/access-control/data-scope.service'
import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseShipmentDeliveryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-delivery.service'
import { PurchaseShipmentQueryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { SalesOrderAutomaticStateService } from '../src/modules/sales-orders/sales-order-automatic-state.service'
import { createPaymentRecipientFixture } from './fixtures/payment-recipient.fixture'
import { destinationWarehouses } from './purchase-destination-warehouse.fixture'
import { prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'
import { createAtomicityFixture, createCommands, createReviewMutations, prepareSalesSource, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

function services(fixture: AtomicityFixture) {
  const lookup = new DictionaryLookupService(fixture.prisma)
  const automaticState = new SalesOrderAutomaticStateService(fixture.audit)
  const query = new PurchaseShipmentQueryService(fixture.prisma, lookup, new DataScopeService(fixture.prisma))
  return {
    automaticState,
    query,
    deliveries: new PurchaseShipmentDeliveryService(
      fixture.prisma,
      fixture.audit,
      query,
      automaticState,
      new DataScopeService(fixture.prisma),
    ),
  }
}

async function prepareLoadedShipment(fixture: AtomicityFixture) {
  const source = await prepareSalesSource(fixture)
  const purchaseOrderId = await createCommands(fixture).create(fixture.context(), source.input)
  await createReviewMutations(fixture).review(fixture.context(), purchaseOrderId, await prepareImageReview(fixture, purchaseOrderId))
  let purchase = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { parts: true } })
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
  purchase = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { parts: true } })
  await withDatabaseBusinessClock(fixture.prisma, () => new PurchaseOrderWarehouseReceiptService(
    fixture.prisma,
    fixture.audit,
    new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma), createPaymentRecipientFixture(fixture.prisma)),
  ).receive(fixture.context(), purchaseOrderId, {
    expectedVersion: purchase.version,
    partIds: purchase.parts.map(part => part.id),
    remark: null,
  }))

  const now = new Date()
  await fixture.prisma.purchaseOrderPart.updateMany({
    where: { purchaseOrderId },
    data: { loadedAt: now, loadedById: fixture.actor.id, loadedRecordedAt: now },
  })
  await fixture.prisma.salesOrder.update({
    where: { id: source.source.id },
    data: { fulfillmentStatus: 'SEA_TRANSIT', version: { increment: 1 } },
  })
  return {
    salesOrderId: source.source.id,
    purchaseOrderId,
    partId: (await fixture.prisma.purchaseOrderPart.findFirstOrThrow({ where: { purchaseOrderId } })).id,
  }
}

async function attachReceipt(fixture: AtomicityFixture, salesOrderId: string) {
  await fixture.prisma.$transaction(async (transaction) => {
    const asset = await transaction.mediaAsset.create({ data: {
      mediaType: 'DOCUMENT',
      status: 'READY',
      originalFilename: 'delivery-receipt.pdf',
      objectKey: `assets/test/${randomUUID()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 3n,
      checksumSha256: 'a'.repeat(64),
      createdByUserId: fixture.actor.id,
    } })
    await transaction.salesOrderDocument.create({ data: {
      salesOrderId,
      mediaAssetId: asset.id,
      documentType: 'DELIVERY_RECEIPT',
      createdByUserId: fixture.actor.id,
    } })
  })
}

describe('purchase shipment delivery with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  beforeAll(async () => { fixture = await createAtomicityFixture() })
  afterAll(async () => { await fixture?.dispose() })

  it('keeps the order in transit without a receipt, rejects unsigned order signing, and signs after the receipt arrives', async () => {
    const prepared = await prepareLoadedShipment(fixture)
    const { deliveries } = services(fixture)

    // 数据层不变量：没有货件签收事实时，销售订单不能被直接写成已签收。
    await expect(fixture.prisma.salesOrder.update({
      where: { id: prepared.salesOrderId },
      data: { fulfillmentStatus: 'SIGNED' },
    })).rejects.toThrow(/Sales order signed but shipment .* is not delivered/u)

    const first = await deliveries.deliver(
      { actorUserId: fixture.actor.id, requestId: randomUUID() },
      prepared.partId,
      { remark: '客户已收' },
    )
    expect(first.salesOrderSigned).toBe(false)
    expect(first.salesOrderReceiptRequired).toBe(true)
    expect(first.remainingShipmentCount).toBe(0)
    expect(first.shipment).toMatchObject({
      viewStatus: 'DELIVERED',
      deliveredAt: expect.any(String) as unknown,
      deliveredBy: { id: fixture.actor.id, displayName: fixture.actor.displayName },
      deliveryRemark: '客户已收',
    })
    expect((await fixture.prisma.salesOrder.findUniqueOrThrow({ where: { id: prepared.salesOrderId } })).fulfillmentStatus).toBe('SEA_TRANSIT')

    await attachReceipt(fixture, prepared.salesOrderId)
    const retried = await deliveries.deliver(
      { actorUserId: fixture.actor.id, requestId: randomUUID() },
      prepared.partId,
      {},
    )
    expect(retried).toMatchObject({ salesOrderSigned: true, salesOrderReceiptRequired: false, remainingShipmentCount: 0 })

    const order = await fixture.prisma.salesOrder.findUniqueOrThrow({ where: { id: prepared.salesOrderId } })
    expect(order.fulfillmentStatus).toBe('SIGNED')
    const part = await fixture.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: prepared.partId } })
    expect(part).toMatchObject({
      deliveredById: fixture.actor.id,
      deliveryRemark: '客户已收',
    })
    expect(part.deliveredAt).not.toBeNull()
    expect(part.deliveredRecordedAt).not.toBeNull()
    expect(await fixture.prisma.salesOrderStatusHistory.count({
      where: { salesOrderId: prepared.salesOrderId, dimension: 'FULFILLMENT', toStatus: 'SIGNED' },
    })).toBe(1)
    expect(await fixture.prisma.auditEvent.count({
      where: { eventType: 'PURCHASE_SHIPMENT_DELIVERED', targetId: prepared.partId },
    })).toBe(1)
    expect(await fixture.prisma.auditEvent.count({
      where: {
        eventType: 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
        targetId: prepared.salesOrderId,
        AND: [
          { metadata: { path: ['automatic'], equals: true } },
          { metadata: { path: ['toStatus'], equals: 'SIGNED' } },
        ],
      },
    })).toBe(1)
  })
})
