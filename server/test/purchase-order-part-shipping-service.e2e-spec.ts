import { destinationWarehouses } from './purchase-destination-warehouse.fixture'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'
import { randomUUID } from 'node:crypto'

import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

async function createThreeParts(fixture: AtomicityFixture) {
  const original = await customInput(fixture)
  const id = await createCommands(fixture).create(fixture.context(), {
    ...original,
    lines: [{ ...original.lines[0], quantity: 3 }],
    parts: [1, 2, 3].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
    purchaseTotalAmount: '30', balanceDueAmount: '30',
  })
  await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
  return fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
}

describe('purchase part shipment service with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  it('ships three parts in three calls, retains partial-to-partial history and final replay does not duplicate facts', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createThreeParts(fixture)
      const service = new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma))
      for (let index = 0; index < 3; index += 1) {
        const current = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
        const result = await service.shipPurchaseOrder(fixture.context(), order.id, {
          expectedVersion: current.version, partIds: [order.parts[index].id], destinationWarehouses: destinationWarehouses([order.parts[index].id]), reason: `第${index + 1}次发货`,
        })
        expect(result.purchaseOrders[0]).toMatchObject({ changed: true, fulfillmentStatus: index === 2 ? 'SHIPPED' : 'PARTIALLY_SHIPPED' })
        expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: order.id, shippedAt: { not: null } } })).toBe(index + 1)
      }
      const histories = await fixture.prisma.purchaseOrderStatusHistory.findMany({ where: { purchaseOrderId: order.id, dimension: 'FULFILLMENT', toStatus: { in: ['PARTIALLY_SHIPPED', 'SHIPPED'] } }, orderBy: { changedAt: 'asc' } })
      expect(histories.map(item => [item.fromStatus, item.toStatus])).toEqual([
        ['PREPARING', 'PARTIALLY_SHIPPED'], ['PARTIALLY_SHIPPED', 'PARTIALLY_SHIPPED'], ['PARTIALLY_SHIPPED', 'SHIPPED'],
      ])
      expect(histories.map(item => item.reason)).toEqual(['本次发货：货件-01；第1次发货', '本次发货：货件-02；第2次发货', '本次发货：货件-03；第3次发货'])
      const facts = await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: order.id }, orderBy: { partNumber: 'asc' } })
      expect(facts.every(part => part.shippedAt !== null && part.shippedById === fixture.actor.id && part.shipmentRecordedAt !== null)).toBe(true)
      const replay = await service.shipPurchaseOrder(fixture.context(), order.id, { expectedVersion: order.version, partIds: [order.parts[2].id], destinationWarehouses: destinationWarehouses([order.parts[2].id]), reason: '重试不得覆盖' })
      expect(replay.changedPurchaseOrderCount).toBe(0)
      expect(await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: order.id }, orderBy: { partNumber: 'asc' } })).toEqual(facts)
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id, toStatus: { in: ['PARTIALLY_SHIPPED', 'SHIPPED'] } } })).toBe(3)
    }
    finally { await fixture.dispose() }
  })

  it('serializes concurrent same-part requests, rejects stale retries and completes remaining two parts together', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createThreeParts(fixture)
      const service = new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma))
      const request = { expectedVersion: order.version, partIds: [order.parts[0].id], destinationWarehouses: destinationWarehouses([order.parts[0].id]), reason: '首件', trackingNumbers: [{ partId: order.parts[0].id, trackingNo: 'SF-FIRST' }] }
      const results = await Promise.allSettled([
        service.shipPurchaseOrder(fixture.context(), order.id, request),
        service.shipPurchaseOrder(fixture.context(), order.id, request),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'FACTORY_SHIPMENT_STATE_CHANGED' } })
      expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: order.id, shippedAt: { not: null } } })).toBe(1)
      expect(await fixture.prisma.purchaseOrderPart.findUniqueOrThrow({ where: { id: order.parts[0].id } })).toMatchObject({ trackingNo: 'SF-FIRST' })
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id, toStatus: 'PARTIALLY_SHIPPED' } })).toBe(1)
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, request)).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
      const current = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })
      const result = await service.shipPurchaseOrder(fixture.context(), order.id, { expectedVersion: current.version, partIds: order.parts.slice(1).map(part => part.id), destinationWarehouses: destinationWarehouses(order.parts.slice(1).map(part => part.id)), reason: '剩余两件' })
      expect(result.purchaseOrders[0]).toMatchObject({ changed: true, fulfillmentStatus: 'SHIPPED' })
      expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: order.id, shippedAt: { not: null } } })).toBe(3)
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id, toStatus: { in: ['PARTIALLY_SHIPPED', 'SHIPPED'] } } })).toBe(2)
    }
    finally { await fixture.dispose() }
  })

  it('stores optional tracking numbers per part and freezes them together with shipment facts', async () => {
    const fixture = await createAtomicityFixture()
    try {
      const order = await createThreeParts(fixture)
      const service = new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma))
      const trackingNumbers = [
        { partId: order.parts[0].id, trackingNo: '  ＳＦ-123  ' },
        { partId: order.parts[1].id, trackingNo: 'YT-456' },
        { partId: order.parts[2].id, trackingNo: null },
      ]
      // 未发货不得单独预填；物流单号必须与同一次发货事实一起冻结。
      await expect(fixture.prisma.purchaseOrderPart.update({
        where: { id: order.parts[0].id }, data: { trackingNo: 'EARLY' },
      })).rejects.toThrow()
      await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
        expectedVersion: order.version, partIds: order.parts.map(part => part.id), destinationWarehouses: destinationWarehouses(order.parts.map(part => part.id)), trackingNumbers,
      })).resolves.toMatchObject({ changedPurchaseOrderCount: 1, purchaseOrders: [{ fulfillmentStatus: 'SHIPPED' }] })

      const readParts = () => fixture.prisma.purchaseOrderPart.findMany({
        where: { purchaseOrderId: order.id }, orderBy: { partNumber: 'asc' },
      })
      const facts = await readParts()
      expect(facts.map(part => part.trackingNo)).toEqual(['ＳＦ-123', 'YT-456', null])
      expect(facts.every(part => part.shippedAt !== null && part.shippedById === fixture.actor.id)).toBe(true)
      expect(new Set(facts.map(part => part.shippedAt!.toISOString())).size).toBe(1)
      for (const replayTracking of [trackingNumbers, undefined]) {
        await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
          expectedVersion: order.version, partIds: order.parts.map(part => part.id), destinationWarehouses: destinationWarehouses(order.parts.map(part => part.id)), trackingNumbers: replayTracking,
        })).resolves.toMatchObject({ changedPurchaseOrderCount: 0 })
      }
      for (const part of facts) {
        await expect(service.shipPurchaseOrder(fixture.context(), order.id, {
          expectedVersion: order.version, partIds: [part.id], destinationWarehouses: destinationWarehouses([part.id]),
          trackingNumbers: [{ partId: part.id, trackingNo: 'REPLACEMENT' }],
        })).rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_STATE_CHANGED' })
        await expect(fixture.prisma.purchaseOrderPart.update({
          where: { id: part.id }, data: { trackingNo: 'REPLACEMENT' },
        })).rejects.toThrow()
      }
      expect(await readParts()).toEqual(facts)
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: order.id, toStatus: 'SHIPPED' } })).toBe(1)
    }
    finally { await fixture.dispose() }
  })
})
