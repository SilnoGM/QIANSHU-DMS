import { withDatabaseBusinessClock } from './fixtures/database-business-clock.fixture'
import { createPaymentRecipientFixture, createPaymentVoucherFixture } from './fixtures/payment-recipient.fixture'
import { destinationWarehouses, TEST_DESTINATION_WAREHOUSE } from './purchase-destination-warehouse.fixture'
import { prepareImageReview } from './purchase-shipping-mark-atomicity.fixture'
import { createHistoricalCustomPurchase, reviewHistoricalPurchase, shipHistoricalPurchase } from './purchase-order-historical-review.fixture'
import { randomUUID } from 'node:crypto'

import { Prisma } from '../src/generated/prisma/client'
import { AuditService, AuditWriteFailedError } from '../src/modules/audit/audit.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentService } from '../src/modules/purchase-orders/factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderWarehouseReceiptService } from '../src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

function receiptService(fixture: AtomicityFixture, audit = fixture.audit) {
  return new PurchaseOrderWarehouseReceiptService(fixture.prisma, audit, new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma), createPaymentRecipientFixture(fixture.prisma)))
}

async function prepare(fixture: AtomicityFixture, count = 3) {
  const input = await customInput(fixture)
  const id = await createCommands(fixture).create(fixture.context(), {
    ...input, lines: [{ ...input.lines[0], quantity: count }],
    parts: Array.from({ length: count }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
    purchaseTotalAmount: String(count * 10), balanceDueAmount: String(count * 10),
  })
  await createReviewMutations(fixture).review(fixture.context(), id, await prepareImageReview(fixture, id))
  return fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: { orderBy: { partNumber: 'asc' } } } })
}

async function ship(fixture: AtomicityFixture, id: string, partIds: string[]) {
  const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })
  await withDatabaseBusinessClock(fixture.prisma, async () => new PurchaseOrderFactoryShipmentService(fixture.prisma, fixture.audit, fixture.salesProgress, new DictionaryLookupService(fixture.prisma)).shipPurchaseOrder(fixture.context(), id, { expectedVersion: order.version, partIds, destinationWarehouses: destinationWarehouses(partIds) }))
  return fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })
}

async function facts(fixture: AtomicityFixture, id: string) {
  return {
    order: await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } }),
    parts: await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: id }, orderBy: { id: 'asc' } }),
    history: await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: id } }),
    audit: await fixture.prisma.auditEvent.count({ where: { targetId: id } }),
  }
}

describe('purchase shipment warehouse receipt with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  beforeAll(async () => {
    fixture = await createAtomicityFixture()
    await fixture.prisma.dictionaryType.update({ where: { code: 'payment.method' }, data: { enabled: true } })
  })
  afterAll(async () => { await fixture?.dispose() })

  it('receives an early shipment, permits shipping the remaining parts, and signs only after all have arrived', async () => {
    const order = await prepare(fixture)
    const receipts = receiptService(fixture)
    let current = await ship(fixture, order.id, [order.parts[0].id])
    const firstRequest = { expectedVersion: current.version, partIds: [order.parts[0].id], remark: '首件入仓' }
    const first = await receipts.receive(fixture.context(), order.id, firstRequest)
    expect(first).toMatchObject({ fulfillmentStatus: 'PARTIALLY_SHIPPED', warehouseReceivedPartCount: 1, pendingWarehousePartCount: 0 })
    const firstFacts = (await facts(fixture, order.id)).parts.find(part => part.id === order.parts[0].id)
    current = await ship(fixture, order.id, order.parts.slice(1).map(part => part.id))
    await receipts.receive(fixture.context(), order.id, { expectedVersion: current.version, partIds: order.parts.slice(1).map(part => part.id), remark: '余货入仓' })
    const final = await facts(fixture, order.id)
    expect(final.order).toMatchObject({ fulfillmentStatus: 'SIGNED', orderStatus: 'CONFIRMED', version: current.version + 1 })
    expect(final.parts.find(part => part.id === order.parts[0].id)).toEqual(firstFacts)
    expect(final.parts.every(part => part.warehouseReceivedAt !== null && part.warehouseReceivedById === fixture.actor.id && part.warehouseRecordedAt !== null)).toBe(true)
    await receipts.receive(fixture.context(), order.id, firstRequest)
    expect(await facts(fixture, order.id)).toEqual(final)
    await createReviewMutations(fixture).recordPayment(fixture.context(), order.id, { paymentType: 'BALANCE', amount: '30', paidAt: new Date().toISOString(), paymentMethod: 'BANK_TRANSFER', ...await createPaymentVoucherFixture(fixture.prisma, order.id, fixture.actor.id, 'BALANCE') })
    expect((await facts(fixture, order.id)).order.orderStatus).toBe('COMPLETED')
  })

  it('serializes concurrent identical original requests without additional receipt audit or versions', async () => {
    const order = await prepare(fixture, 2)
    const current = await ship(fixture, order.id, order.parts.map(part => part.id))
    const receipts = receiptService(fixture)
    const request = { expectedVersion: current.version, partIds: [order.parts[0].id], remark: '重试原请求' }
    const results = await Promise.allSettled([receipts.receive(fixture.context(), order.id, request), receipts.receive(fixture.context(), order.id, request)])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    const after = await facts(fixture, order.id)
    expect(after.order.version).toBe(current.version + 1)
    expect(await fixture.prisma.auditEvent.count({ where: { targetId: order.id, eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED' } })).toBe(1)
    await expect(receipts.receive(fixture.context(), order.id, { ...request, expectedVersion: after.order.version })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' })
    await expect(receipts.receive(fixture.context(), order.id, { ...request, expectedVersion: after.order.version, partIds: order.parts.map(part => part.id) })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' })
    expect(await facts(fixture, order.id)).toEqual(after)
  })

  it('rejects different concurrent requests with the same stale version, then accepts a refreshed request', async () => {
    const order = await prepare(fixture, 2)
    const current = await ship(fixture, order.id, order.parts.map(part => part.id))
    const receipts = receiptService(fixture)
    const results = await Promise.allSettled(order.parts.map(part => receipts.receive(fixture.context(), order.id, { expectedVersion: current.version, partIds: [part.id] })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED' } })
    const after = await facts(fixture, order.id)
    const pending = after.parts.filter(part => part.warehouseReceivedAt === null)
    await receipts.receive(fixture.context(), order.id, { expectedVersion: after.order.version, partIds: pending.map(part => part.id) })
    expect((await facts(fixture, order.id)).order.fulfillmentStatus).toBe('SIGNED')
  })

  it('rejects unshipped, foreign, stale, past and future inputs without persisting any receipt', async () => {
    const order = await prepare(fixture, 2)
    const other = await prepare(fixture, 1)
    const current = await ship(fixture, order.id, [order.parts[0].id])
    const receipts = receiptService(fixture), before = await facts(fixture, order.id)
    const base = { expectedVersion: current.version, partIds: [order.parts[0].id] }
    const cases = [
      [{ ...base, partIds: [order.parts[1].id] }, 'PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED'],
      [{ ...base, partIds: [other.parts[0].id] }, 'PURCHASE_WAREHOUSE_RECEIPT_TARGET_INVALID'],
      [{ ...base, expectedVersion: current.version - 1 }, 'PURCHASE_WAREHOUSE_RECEIPT_STATE_CHANGED'],
      [{ ...base, receivedAt: '2000-01-01T00:00:00Z' }, 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID'],
      [{ ...base, receivedAt: '2999-01-01T00:00:00Z' }, 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID'],
    ] as const
    for (const [request, code] of cases) await expect(receipts.receive(fixture.context(), order.id, request)).rejects.toMatchObject({ code })
    await expect(createReviewMutations(fixture).updateFulfillmentStatus(fixture.context(), order.id, { toStatus: 'SIGNED' })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_NOT_ALLOWED' })
    expect(await facts(fixture, order.id)).toEqual(before)
  })

  it('rejects an explicit millisecond instant before an existing microsecond shipment fact with the public time error', async () => {
    const order = await prepare(fixture, 1)
    await fixture.prisma.$transaction(async transaction => {
      await transaction.$executeRaw(Prisma.sql`UPDATE purchase_order_parts SET shipped_at = '2000-01-01T00:00:00.000123Z'::timestamptz, shipped_by_id = ${fixture.actor.id}::uuid, shipment_recorded_at = clock_timestamp(), destination_warehouse_value = ${TEST_DESTINATION_WAREHOUSE} WHERE id = ${order.parts[0].id}::uuid`)
      await transaction.purchaseOrder.update({ where: { id: order.id }, data: { fulfillmentStatus: 'SHIPPED' } })
    })
    const before = await facts(fixture, order.id)
    await expect(receiptService(fixture).receive(fixture.context(), order.id, { expectedVersion: before.order.version, partIds: [order.parts[0].id], receivedAt: '2000-01-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'PURCHASE_WAREHOUSE_RECEIPT_TIME_INVALID' })
    expect(await facts(fixture, order.id)).toEqual(before)
  })

  it('rolls receipt facts, parent state and history back when the receipt audit fails', async () => {
    const order = await prepare(fixture, 1)
    const current = await ship(fixture, order.id, order.parts.map(part => part.id)), before = await facts(fixture, order.id)
    const audit = new AuditService(), realRecord = audit.record.bind(audit)
    jest.spyOn(audit, 'record').mockImplementation((transaction, input) => {
      if (input.eventType === 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED') throw new AuditWriteFailedError()
      return realRecord(transaction, input)
    })
    await expect(receiptService(fixture, audit).receive(fixture.context(), order.id, { expectedVersion: current.version, partIds: order.parts.map(part => part.id) })).rejects.toBeInstanceOf(AuditWriteFailedError)
    expect(await facts(fixture, order.id)).toEqual(before)
  })

  it('keeps the legacy SIGNED command on the shared receipt path and completes an already paid order', async () => {
    const order = await prepare(fixture, 1)
    await ship(fixture, order.id, order.parts.map(part => part.id))
    const mutation = createReviewMutations(fixture)
    await mutation.recordPayment(fixture.context(), order.id, { paymentType: 'BALANCE', amount: '10', paidAt: new Date().toISOString(), paymentMethod: 'BANK_TRANSFER', ...await createPaymentVoucherFixture(fixture.prisma, order.id, fixture.actor.id, 'BALANCE') })
    await mutation.updateFulfillmentStatus(fixture.context(), order.id, { toStatus: 'SIGNED', reason: '仓库签收' })
    const final = await facts(fixture, order.id)
    expect(final.order).toMatchObject({ orderStatus: 'COMPLETED', fulfillmentStatus: 'SIGNED' })
    expect(final.parts[0]).toMatchObject({ warehouseReceivedById: fixture.actor.id, warehouseRemark: '仓库签收' })
    await mutation.updateFulfillmentStatus(fixture.context(), order.id, { toStatus: 'SIGNED', reason: '仓库签收' })
    expect(await facts(fixture, order.id)).toEqual(final)
  })

  it('database rejects parent-only signing, partial facts, future times, missing aggregate updates and later receipt mutation', async () => {
    const order = await prepare(fixture, 1)
    const current = await ship(fixture, order.id, [order.parts[0].id])
    await expect(fixture.prisma.purchaseOrder.update({ where: { id: order.id }, data: { fulfillmentStatus: 'SIGNED' } })).rejects.toThrow()
    await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: order.parts[0].id }, data: { warehouseReceivedAt: new Date() } })).rejects.toThrow()
    await expect(fixture.prisma.$executeRaw(Prisma.sql`UPDATE purchase_order_parts SET warehouse_received_at = clock_timestamp(), warehouse_received_by_id = ${fixture.actor.id}::uuid, warehouse_recorded_at = clock_timestamp() + interval '1 day' WHERE id = ${order.parts[0].id}::uuid`)).rejects.toThrow()
    await expect(fixture.prisma.$executeRaw(Prisma.sql`UPDATE purchase_order_parts SET warehouse_received_at = clock_timestamp(), warehouse_received_by_id = ${fixture.actor.id}::uuid, warehouse_recorded_at = clock_timestamp() WHERE id = ${order.parts[0].id}::uuid`)).rejects.toThrow()
    const result = await receiptService(fixture).receive(fixture.context(), order.id, { expectedVersion: current.version, partIds: [order.parts[0].id] })
    expect(result.fulfillmentStatus).toBe('SIGNED')
    const final = await facts(fixture, order.id)
    await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: order.parts[0].id }, data: { warehouseRemark: '禁止覆盖' } })).rejects.toThrow()
    await expect(fixture.prisma.purchaseOrder.update({ where: { id: order.id }, data: { fulfillmentStatus: 'SHIPPED' } })).rejects.toThrow()
    expect(await facts(fixture, order.id)).toEqual(final)
  })

  it('blocks migration of historic SIGNED orders and preserves their real historical data', async () => {
    const legacy = await createAtomicityFixture(false, false, false, true)
    try {
      const id = await createHistoricalCustomPurchase(legacy)
      // 按旧 schema 原有审核、发货写入构造历史事实；新图片生成器不能运行在旧 schema。
      await reviewHistoricalPurchase(legacy, id)
      await shipHistoricalPurchase(legacy, id)
      // 历史 schema 尚未应用采购驳回迁移，默认返回全部列会引用 rejected_at。
      await legacy.prisma.purchaseOrder.update({
        where: { id },
        data: { fulfillmentStatus: 'SIGNED' },
        select: { id: true },
      })
      const snapshot = () => legacy.prisma.$queryRaw(Prisma.sql`SELECT to_jsonb(orders) AS data FROM purchase_orders orders WHERE id = ${id}::uuid`)
      const before = await snapshot()
      await expect(legacy.migrateWarehouseReceipt()).rejects.toMatchObject({ code: '23514', constraint: 'purchase_warehouse_historical_signed_check' })
      expect(await snapshot()).toEqual(before)
      const columns = await legacy.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'purchase_order_parts' AND column_name = 'warehouse_received_at'`)
      expect(columns[0].count).toBe(0n)
    }
    finally { await legacy.dispose() }
  })

  it('receives 1000 shipments with one receipt audit inside the normal transaction budget', async () => {
    const order = await prepare(fixture, 1000)
    const current = await ship(fixture, order.id, order.parts.map(part => part.id))
    const start = performance.now()
    await receiptService(fixture).receive(fixture.context(), order.id, { expectedVersion: current.version, partIds: order.parts.map(part => part.id) })
    const elapsed = performance.now() - start
    console.info(`Warehouse receipt 1000 parts: ${Math.round(elapsed)}ms`)
    expect(elapsed).toBeLessThan(30_000)
    expect(await fixture.prisma.auditEvent.count({ where: { targetId: order.id, eventType: 'PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED' } })).toBe(1)
    expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: order.id, warehouseReceivedAt: { not: null } } })).toBe(1000)
  })
})
