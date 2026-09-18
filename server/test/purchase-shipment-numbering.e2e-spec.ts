import { createHistoricalCustomPurchase, reviewHistoricalPurchase, shipHistoricalPurchase } from './purchase-order-historical-review.fixture'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { AuditService } from '../src/modules/audit/audit.service'
import { PurchaseShipmentNumberBackfillService } from '../src/modules/purchase-orders/shipments/purchase-shipment-number-backfill.service'
import { PurchaseShipmentNumberingService } from '../src/modules/purchase-orders/shipments/purchase-shipment-numbering.service'
import { createAtomicityFixture, createCommands, createReviewMutations, customInput, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

async function numberingFacts(fixture: AtomicityFixture) {
  return {
    ledger: await fixture.prisma.numberingIssuance.findMany({ where: { consumerCode: 'SHIPMENT_NO.CREATE' }, orderBy: { id: 'asc' } }),
    states: await fixture.prisma.numberingPeriodState.findMany({ where: { rule: { ruleCode: 'SHIPMENT_NO' } } }),
  }
}

describe('shipment numbers in real isolated PostgreSQL transactions', () => {
  jest.setTimeout(120_000)
  let fixture: AtomicityFixture
  beforeAll(async () => { fixture = await createAtomicityFixture() })
  afterAll(async () => { await fixture?.dispose() })
  afterEach(() => { jest.restoreAllMocks() })

  it('assigns one immutable BUSINESS number per shipment at creation and replays the original order without more issuance', async () => {
    const base = await customInput(fixture), context = fixture.context(), commands = createCommands(fixture)
    const input = { ...base, lines: [{ ...base.lines[0], quantity: 2 }], parts: [1, 2].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })), purchaseTotalAmount: '20', balanceDueAmount: '20' }
    const id = await commands.create(context, input)
    const parts = await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: id }, include: { numberingIssuance: { include: { rule: true } } } })
    expect(parts).toHaveLength(2)
    expect(new Set(parts.map(part => part.shipmentNo)).size).toBe(2)
    for (const part of parts) {
      expect(part).toMatchObject({ status: 'PENDING_REVIEW', shippingMarkText: null, shippingMarkIssuanceId: null, shipmentNo: expect.stringMatching(/^PKG\d{8}$/u) as unknown })
      expect(part.numberingIssuance).toMatchObject({ generatedNumber: part.shipmentNo, consumerCode: 'SHIPMENT_NO.CREATE', rule: { ruleCode: 'SHIPMENT_NO', purpose: 'BUSINESS' } })
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: part.id }, data: { shipmentNo: null, numberingIssuanceId: null } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: part.id }, data: { shipmentNo: 'FORGED' } })).rejects.toThrow()
    }
    const before = await numberingFacts(fixture)
    expect(await commands.create(context, input)).toBe(id)
    expect(await numberingFacts(fixture)).toEqual(before)
  })

  it.each(['rule', 'consumer', 'fingerprint', 'identity'] as const)('database rejects an issuance with mismatched %s and rolls back the entire shipment issuance', async mismatch => {
    const before = await numberingFacts(fixture)
    const generate = fixture.numbering.generateScopedBatchInTransaction.bind(fixture.numbering)
    jest.spyOn(fixture.numbering, 'generateScopedBatchInTransaction').mockImplementation((tx, requests) => generate(tx, requests.map(request => ({
      ...request,
      ...(mismatch === 'rule' ? { ruleCode: 'PURCHASE_ORDER' } : {}),
      ...(mismatch === 'consumer' ? { consumerCode: 'OTHER.CREATE' } : {}),
      ...(mismatch === 'fingerprint' ? { requestFingerprint: '0'.repeat(64) } : {}),
      ...(mismatch === 'identity' ? { idempotencyKey: randomUUID() } : {}),
    }))))
    await expect(createCommands(fixture).create(fixture.context(), await customInput(fixture))).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(await numberingFacts(fixture)).toEqual(before)
  })

  it('rolls back ledger and capacity after a post-issuance failure, then succeeds with the same original request', async () => {
    const context = fixture.context(), input = await customInput(fixture), before = await numberingFacts(fixture)
    const commands = createCommands(fixture, transaction => new Proxy(transaction, { get(target, property): unknown {
      if (property !== 'purchaseOrderPartItem') return Reflect.get(target, property)
      return { ...transaction.purchaseOrderPartItem, createMany: () => { throw new Error('Injected allocation write failure') } }
    } }))
    await expect(commands.create(context, input)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(await numberingFacts(fixture)).toEqual(before)
    const id = await createCommands(fixture).create(context, input)
    expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: id, shipmentNo: { not: null } } })).toBe(1)
    expect((await numberingFacts(fixture)).ledger).toHaveLength(before.ledger.length + 1)
  })

  async function maximumInput() {
    const base = await customInput(fixture)
    return { ...base,
      lines: Array.from({ length: 10 }, (_, index) => ({ ...base.lines[0], name: `Maximum item ${index}`, quantity: 1000 })),
      parts: Array.from({ length: 1000 }, () => ({ key: randomUUID(), items: Array.from({ length: 10 }, (_, index) => ({ lineNumber: index + 1, quantity: 1 })) })),
      purchaseTotalAmount: '100000', balanceDueAmount: '100000',
    }
  }

  it('creates the supported maximum of 1000 shipments and 10000 allocations within the fixed 30-second transaction', async () => {
    const input = await maximumInput(), start = performance.now()
    const id = await createCommands(fixture).create(fixture.context(), input)
    const elapsedMs = Math.round(performance.now() - start)
    console.info(JSON.stringify({ scenario: 'shipment-numbering-full-create-1000-10000', elapsedMs }))
    expect(elapsedMs).toBeLessThan(30_000)
    expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: id, shipmentNo: { not: null } } })).toBe(1000)
    expect(await fixture.prisma.purchaseOrderPartItem.count({ where: { purchaseOrderId: id } })).toBe(10000)
  })

  it('handles concurrent maximum orders and original-key recovery without duplicate business or numbering records', async () => {
    const inputs = await Promise.all([maximumInput(), maximumInput()]), contexts = [fixture.context(), fixture.context()]
    const start = performance.now(), commands = createCommands(fixture)
    const results = await Promise.allSettled(inputs.map((input, index) => commands.create(contexts[index], input)))
    const ids: string[] = []
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]
      if (result.status === 'fulfilled') ids.push(result.value)
      else {
        expect(result.reason as unknown).toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
        ids.push(await commands.create(contexts[index], inputs[index]))
      }
    }
    console.info(JSON.stringify({ scenario: 'shipment-numbering-concurrent-full-create-1000-10000', elapsedMs: Math.round(performance.now() - start), firstAttemptSuccesses: results.filter(result => result.status === 'fulfilled').length }))
    const parts = await fixture.prisma.purchaseOrderPart.findMany({ where: { purchaseOrderId: { in: ids } }, select: { shipmentNo: true, numberingIssuanceId: true } })
    expect(parts).toHaveLength(2000)
    expect(new Set(parts.map(part => part.shipmentNo)).size).toBe(2000)
    expect(new Set(parts.map(part => part.numberingIssuanceId)).size).toBe(2000)
    expect(await Promise.all(inputs.map((input, index) => commands.create(contexts[index], input)))).toEqual(ids)
  })
})

describe('historical shipment numbering migration and backfill', () => {
  jest.setTimeout(120_000)
  it('preserves historical status, marks, allocation and shipment facts; dry-run and reruns do not issue numbers', async () => {
    const fixture = await createAtomicityFixture(false, false, true)
    try {
      // 按历史列和 v5 指纹创建；编号列迁移尚未执行，不虚构未持久化的派号结果。
      const ids: string[] = []
      for (let index = 0; index < 3; index += 1) ids.push(await createHistoricalCustomPurchase(fixture))
      await reviewHistoricalPurchase(fixture, ids[1])
      await shipHistoricalPurchase(fixture, ids[1])
      await fixture.migrateShipmentNumbers()
      const review = createReviewMutations(fixture)
      await review.updateOrderStatus(fixture.context(), ids[2], { toStatus: 'CANCELLED', reason: 'Preserved cancellation' })
      const partBefore = await fixture.prisma.purchaseOrderPart.findMany({ orderBy: { id: 'asc' }, include: { items: true } })
      const orderBefore = await fixture.prisma.purchaseOrder.findMany({ orderBy: { id: 'asc' } })
      const numbers = new PurchaseShipmentNumberingService(fixture.numbering)
      const service = new PurchaseShipmentNumberBackfillService(fixture.prisma, numbers, fixture.audit)
      const before = await numberingFacts(fixture)
      expect(await service.run({ actorUserId: fixture.actor.id })).toMatchObject({ mode: 'DRY_RUN', selected: 3, assigned: 0, remaining: 3 })
      expect(await numberingFacts(fixture)).toEqual(before)
      const failedAudit = new AuditService()
      jest.spyOn(failedAudit, 'record').mockRejectedValue(new Error('Injected backfill audit failure'))
      expect(await new PurchaseShipmentNumberBackfillService(fixture.prisma, numbers, failedAudit).run({ actorUserId: fixture.actor.id, apply: true })).toMatchObject({ assigned: 0, failed: 1, remaining: 3 })
      expect(await numberingFacts(fixture)).toEqual(before)
      const issuedAfter = new Date()
      expect(await service.run({ actorUserId: fixture.actor.id, apply: true })).toMatchObject({ assigned: 3, remaining: 0, failed: 0 })
      const after = await fixture.prisma.purchaseOrderPart.findMany({ orderBy: { id: 'asc' }, include: { items: true } })
      expect(after.map(part => ({ ...part, shipmentNo: null, numberingIssuanceId: null }))).toEqual(partBefore)
      expect(await fixture.prisma.purchaseOrder.findMany({ orderBy: { id: 'asc' } })).toEqual(orderBefore)
      const audit = await fixture.prisma.auditEvent.findMany({ where: { eventType: 'PURCHASE_SHIPMENT_NUMBER_ASSIGNED' } })
      expect(audit).toHaveLength(3)
      expect(audit.every(event => event.actorUserId === fixture.actor.id && event.reasonCode === 'BACKFILL')).toBe(true)
      const finalFacts = await numberingFacts(fixture)
      expect(finalFacts.ledger.every(issuance => issuance.issuedAt >= issuedAfter)).toBe(true)
      expect(await service.run({ actorUserId: fixture.actor.id, apply: true })).toMatchObject({ selected: 0, assigned: 0, remaining: 0 })
      expect(await numberingFacts(fixture)).toEqual(finalFacts)
      expect(await fixture.prisma.auditEvent.count({ where: { eventType: 'PURCHASE_SHIPMENT_NUMBER_ASSIGNED' } })).toBe(3)
      // 正式不可变守卫继续保护已补号货件，不能用新编号覆盖原值。
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: after[0].id }, data: { shipmentNo: 'REPLACE' } })).rejects.toThrow()
    }
    finally { jest.restoreAllMocks(); await fixture.dispose() }
  })
})
