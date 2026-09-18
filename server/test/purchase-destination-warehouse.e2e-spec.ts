import { randomUUID } from 'node:crypto'

import { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseShipmentQueryService } from '../src/modules/purchase-orders/shipments/purchase-shipment-query.service'
import { destinationWarehouses, OTHER_DESTINATION_WAREHOUSE, TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'
import { createHistoricalCustomPurchase, reviewHistoricalPurchase, shipHistoricalPurchase } from './purchase-order-historical-review.fixture'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, prepareImageReview, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

async function createReviewedParts(fixture: AtomicityFixture) {
  const original = await customInput(fixture)
  const id = await createCommands(fixture).create(fixture.context(), {
    ...original,
    lines: [{ ...original.lines[0], quantity: 2 }],
    parts: [1, 2].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
    purchaseTotalAmount: '20', balanceDueAmount: '20',
  })
  await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
  return fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
}

function shipmentService(fixture: AtomicityFixture) {
  return new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma))
}

async function shipmentFacts(fixture: AtomicityFixture, purchaseOrderId: string) {
  return {
    order: await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } }),
    parts: await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId }, orderBy: { partNumber: 'asc' } }),
    history: await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId } }),
    audit: await fixture.prisma.auditEvent.count({ where: { targetId: purchaseOrderId } }),
  }
}

describe('purchase shipment destination warehouse with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  it('rejects missing, empty, incomplete, duplicate, blank and unknown warehouse values without writing shipment facts', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createReviewedParts(fixture)
      const service = shipmentService(fixture)
      const partIds = order.parts.map(part => part.id)
      const base = { expectedVersion: order.version, partIds }
      const before = await shipmentFacts(fixture, order.id)
      const valid = destinationWarehouses(partIds)
      const invalid = [
        undefined, [], valid.slice(0, 1), [valid[0], valid[0]],
        [{ ...valid[0], warehouseValue: '' }, valid[1]],
        [valid[0], { ...valid[1], warehouseValue: 'UNKNOWN-WAREHOUSE' }],
        [valid[0], { ...valid[1], warehouseValue: 'warehouse with spaces' }],
      ]
      for (const warehouses of invalid) {
        await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
          ...base, ...(warehouses === undefined ? {} : { destinationWarehouses: warehouses }),
        })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
        expect(await shipmentFacts(fixture, order.id)).toEqual(before)
      }
      const type = await fixture.prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'mainland.warehouse' } })
      await fixture.prisma.dictionaryItem.update({
        where: { dictionaryTypeId_value: { dictionaryTypeId: type.id, value: OTHER_DESTINATION_WAREHOUSE } },
        data: { enabled: false },
      })
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
        ...base, destinationWarehouses: [valid[0], { ...valid[1], warehouseValue: OTHER_DESTINATION_WAREHOUSE }],
      })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(await shipmentFacts(fixture, order.id)).toEqual(before)
      await fixture.prisma.dictionaryType.update({ where: { id: type.id }, data: { enabled: false } })
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, { ...base, destinationWarehouses: valid }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(await shipmentFacts(fixture, order.id)).toEqual(before)
    }
    finally { await fixture.dispose() }
  })

  it('stores different warehouses per shipment, resolves disabled labels and preserves facts on replay or attempted replacement', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createReviewedParts(fixture)
      const service = shipmentService(fixture)
      const partIds = order.parts.map(part => part.id)
      const input = { expectedVersion: order.version, partIds, destinationWarehouses: [
        { partId: partIds[0], warehouseValue: TEST_DESTINATION_WAREHOUSE },
        { partId: partIds[1], warehouseValue: OTHER_DESTINATION_WAREHOUSE },
      ] }
      await service.shipPurchaseOrder(fixture.context(), order.id, input)
      const before = await shipmentFacts(fixture, order.id)
      expect(before.parts.map(part => part.destinationWarehouseValue)).toEqual([TEST_DESTINATION_WAREHOUSE, OTHER_DESTINATION_WAREHOUSE])
      const queries = new PurchaseShipmentQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
      expect(await queries.getById(partIds[0])).toMatchObject({
        destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE,
        destinationWarehouse: { value: TEST_DESTINATION_WAREHOUSE, label: '大陆测试仓库', known: true, effectiveEnabled: true },
      })
      const type = await fixture.prisma.dictionaryType.findUniqueOrThrow({ where: { code: 'mainland.warehouse' } })
      await fixture.prisma.dictionaryItem.update({
        where: { dictionaryTypeId_value: { dictionaryTypeId: type.id, value: OTHER_DESTINATION_WAREHOUSE } },
        data: { label: '已停用的第二仓库', enabled: false },
      })
      const disabled = { destinationWarehouseValue: OTHER_DESTINATION_WAREHOUSE,
        destinationWarehouse: { value: OTHER_DESTINATION_WAREHOUSE, label: '已停用的第二仓库', known: true, effectiveEnabled: false } }
      expect(await queries.getById(partIds[1])).toMatchObject(disabled)
      expect((await queries.list({ view: 'SHIPPED' })).items.find(part => part.id === partIds[1])).toMatchObject(disabled)
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, input)).resolves.toMatchObject({ changedPurchaseOrderCount: 0 })
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
        ...input, destinationWarehouses: destinationWarehouses(partIds),
      })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
      await expect(fixture.prisma.purchaseOrderPart.update({
        where: { id: partIds[1] }, data: { destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE },
      })).rejects.toThrow()
      expect(await shipmentFacts(fixture, order.id)).toEqual(before)
    }
    finally { await fixture.dispose() }
  })

  it('database rejects warehouse prefill and new shipment writes that omit the required warehouse', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createReviewedParts(fixture)
      const before = await shipmentFacts(fixture, order.id)
      await expect(fixture.prisma.purchaseOrderPart.update({
        where: { id: order.parts[0].id }, data: { destinationWarehouseValue: TEST_DESTINATION_WAREHOUSE },
      })).rejects.toThrow()
      await expect(fixture.prisma.$executeRaw(Prisma.sql`UPDATE purchase_order_parts
        SET shipped_at = clock_timestamp(), shipped_by_id = ${fixture.actor.id}::uuid,
          shipment_recorded_at = clock_timestamp()
        WHERE id = ${order.parts[0].id}::uuid`)).rejects.toThrow()
      expect(await shipmentFacts(fixture, order.id)).toEqual(before)
    }
    finally { await fixture.dispose() }
  })

  it('migrates real historical shipments without inventing a warehouse and rejects replay that would fill it', async () => {
    const fixture = await createAtomicityFixture(false, false, false, true)
    try {
      const id = await createHistoricalCustomPurchase(fixture)
      await reviewHistoricalPurchase(fixture, id)
      await shipHistoricalPurchase(fixture, id)
      const [oldPart] = await fixture.prisma.$queryRaw<{ id: string, shippedAt: Date }[]>(Prisma.sql`
        SELECT id, shipped_at AS "shippedAt" FROM purchase_order_parts WHERE purchase_order_id = ${id}::uuid`)
      await fixture.migrateWarehouseReceipt()
      const before = await shipmentFacts(fixture, id)
      expect(before.parts[0]).toMatchObject({ id: oldPart.id, shippedAt: oldPart.shippedAt, destinationWarehouseValue: null })
      const queries = new PurchaseShipmentQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
      expect(await queries.getById(oldPart.id)).toMatchObject({ destinationWarehouseValue: null, destinationWarehouse: null })
      expect((await queries.list({ view: 'SHIPPED' })).items[0]).toMatchObject({ destinationWarehouseValue: null, destinationWarehouse: null })
      await expect(shipmentService(fixture).shipPurchaseOrder(fixture.context(), id, {
        expectedVersion: before.order.version, partIds: [oldPart.id], destinationWarehouses: destinationWarehouses([oldPart.id]),
      })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
      expect(await shipmentFacts(fixture, id)).toEqual(before)
    }
    finally { await fixture.dispose() }
  })
})
