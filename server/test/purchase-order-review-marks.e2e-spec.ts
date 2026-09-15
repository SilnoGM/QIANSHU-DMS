import { randomUUID } from 'node:crypto'

import type { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { hashPurchaseOrderIdempotencyKey } from '../src/modules/purchase-orders/purchase-order-create-fingerprint'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { PurchaseOrderReviewContextService } from '../src/modules/purchase-orders/purchase-order-review-context.service'
import {
  atomicFacts, createAtomicityFixture, createCommands, createReviewMutations, customInput,
  MARK_CONSUMER, prepareCatalog, prepareImageReview, type AtomicityFixture,
} from './purchase-shipping-mark-atomicity.fixture'

async function withFixture(action: (fixture: AtomicityFixture) => Promise<void>) {
  const fixture = await createAtomicityFixture()
  try { await action(fixture) }
  finally { jest.restoreAllMocks(); await fixture.dispose() }
}

async function reviewFacts(fixture: AtomicityFixture) {
  return {
    ...await atomicFacts(fixture.prisma),
    parts: await fixture.prisma.purchaseOrderPart.findMany({ orderBy: { id: 'asc' } }),
    history: await fixture.prisma.purchaseOrderStatusHistory.findMany({ orderBy: { id: 'asc' } }),
    reviewAudits: await fixture.prisma.auditEvent.findMany({ where: { eventType: { in: ['PURCHASE_ORDER_ORDER_STATUS_CHANGED', 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED', 'PURCHASE_ORDER_REVIEW_MARKS_PREPARED'] } }, orderBy: { id: 'asc' } }),
  }
}

describe('purchase review mark issuance with isolated PostgreSQL', () => {
  jest.setTimeout(60_000)

  it('issues one base from the current binding and preserves the original submission replay', async () => {
    await withFixture(async fixture => {
      const catalog = await prepareCatalog(fixture)
      const context = fixture.context()
      const commands = createCommands(fixture)
      const id = await commands.create(context, catalog.input)
      await fixture.bindings.save(fixture.configContext, catalog.supplierValue, { ruleId: fixture.customRule.id, expectedVersion: 1 })
      const precheck = new PurchaseOrderReviewContextService(fixture.prisma, fixture.resolver)
      const beforePrecheck = await reviewFacts(fixture)
      expect(await precheck.read(id)).toEqual({ available: true, message: null })
      expect(await reviewFacts(fixture)).toEqual(beforePrecheck)
      const prepared = await prepareImageReview(fixture, id)
      const detail = await createReviewMutations(fixture).review(fixture.context(), id, { ...prepared, reason: '核对货件与采购价格无误' })
      expect(detail.reviewSummary).toMatchObject({
        reviewedBy: { id: fixture.actor.id, displayName: fixture.actor.displayName },
        reviewedAt: expect.any(String) as unknown,
        reason: '核对货件与采购价格无误',
      })
      const query = new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
      const page = await query.list({ view: 'all', orderStatus: 'CONFIRMED' })
      expect(page.items.find(item => item.id === id)?.reviewSummary).toEqual(detail.reviewSummary)
      expect(await precheck.read(id)).toMatchObject({ available: false, message: expect.stringContaining('已审核通过') as unknown })
      const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })
      const ledger = await fixture.prisma.numberingIssuance.findMany({ where: { rule: { purpose: 'SHIPPING_MARK' } } })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ consumerCode: MARK_CONSUMER, ruleId: fixture.customRule.id, generatedNumber: detail.shippingMarkText })
      expect(Buffer.from(ledger[0].idempotencyKeyHash)).toEqual(hashPurchaseOrderIdempotencyKey(id))
      expect(Buffer.from(ledger[0].requestFingerprintHash)).toEqual(Buffer.from(order.createRequestFingerprintHash))
      expect(order.shippingMarkIssuanceId).toBe(ledger[0].id)
      expect(detail.parts.map(part => part.shippingMarkText)).toEqual([detail.shippingMarkText])
      const before = await reviewFacts(fixture)
      await expect(commands.create(context, catalog.input)).resolves.toBe(id)
      await expect(commands.create(context, { ...catalog.input, parts: [{ ...catalog.input.parts[0], key: fixture.context().idempotencyKey }] }))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT' })
      expect(await reviewFacts(fixture)).toEqual(before)
    })
  })

  it('resolves the current active revision at image preparation instead of the creation preview', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      const draft = await fixture.numberingCommands.update(fixture.configContext, fixture.customRule.id, {
        expectedVersion: fixture.customRule.version,
        segments: [{ type: 'FIXED', value: 'REVIEW' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
      })
      await fixture.numberingCommands.publish(fixture.configContext, fixture.customRule.id, { expectedVersion: draft.version, draftRevision: 2 })
      const detail = await createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })
      expect(detail).toMatchObject({ shippingMarkText: 'REVIEW00000001', orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED', version: 2 })
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: id } })).toBe(0)
      expect(detail.parts[0].shippingMarkText).toBe(detail.shippingMarkText)
      expect((await atomicFacts(fixture.prisma)).ledger).toHaveLength(1)
    })
  })

  it('rejects mark preparation after rule disable without changing allocations, statuses or ledgers', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      await fixture.numberingCommands.disable(fixture.configContext, fixture.customRule.id, { expectedVersion: fixture.customRule.version })
      const before = await reviewFacts(fixture)
      const precheck = new PurchaseOrderReviewContextService(fixture.prisma, fixture.resolver)
      expect(await precheck.read(id)).toMatchObject({ available: false, message: expect.any(String) as unknown })
      expect(await reviewFacts(fixture)).toEqual(before)
      await expect(createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 }))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE' })
      expect(await reviewFacts(fixture)).toEqual(before)
    })
  })

  it('concurrent image preparations allocate exactly one base and stale preparation cannot issue again', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      const mutations = createReviewMutations(fixture)
      const results = await Promise.allSettled(Array.from({ length: 3 }, () => mutations.prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })))
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
      }
      const before = await reviewFacts(fixture)
      expect(before.ledger).toHaveLength(1)
      expect(before.periods.map(period => period.usedCount)).toEqual([1n])
      expect(before.history).toHaveLength(0)
      expect(before.orders[0]).toMatchObject({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED', version: 2 })
      expect(before.parts.every(part => part.status === 'PENDING_REVIEW')).toBe(true)
      expect(before.reviewAudits).toHaveLength(1)
      await expect(mutations.prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
      expect(await reviewFacts(fixture)).toEqual(before)
    })
  })

  it('cancels an unreviewed order without ever allocating a shipping mark', async () => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      await createReviewMutations(fixture).updateOrderStatus(fixture.context(), id, { toStatus: 'CANCELLED', reason: 'Cancel pending purchase' })
      const facts = await reviewFacts(fixture)
      expect(facts.orders[0]).toMatchObject({ orderStatus: 'CANCELLED', shippingMarkText: null, shippingMarkIssuanceId: null })
      expect(facts.parts[0]).toMatchObject({ shippingMarkText: null, shippingMarkIssuanceId: null })
      expect(facts.ledger).toEqual([])
      expect(facts.periods).toEqual([])
    })
  })

  it.each(['order', 'parts', 'audit'] as const)('rolls back base issuance and derived marks after the persisted %s write', async point => {
    await withFixture(async fixture => {
      const id = await createCommands(fixture).create(fixture.context(), await customInput(fixture))
      const before = await reviewFacts(fixture)
      let observed = false
      const fail = async (transaction: Prisma.TransactionClient) => {
        expect(await transaction.numberingIssuance.count({ where: { consumerCode: MARK_CONSUMER } })).toBe(1)
        expect(await transaction.purchaseOrder.findUniqueOrThrow({ where: { id } })).toMatchObject({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED', shippingMarkText: expect.any(String) as unknown })
        if (point !== 'order') expect(await transaction.purchaseOrderPart.count({ where: { purchaseOrderId: id, shippingMarkText: { not: null } } })).toBe(1)
        observed = true
        throw new Error('Injected image mark preparation persisted write failure')
      }
      const mutations = createReviewMutations(fixture, transaction => new Proxy(transaction, {
        get(target, property): unknown {
          if (point === 'order' && property === 'purchaseOrder') return { ...transaction.purchaseOrder,
            update: async (args: Prisma.PurchaseOrderUpdateArgs) => { await transaction.purchaseOrder.update(args); return fail(transaction) },
          }
          if (point === 'audit' && property === 'auditEvent') return { ...transaction.auditEvent,
            create: async (args: Prisma.AuditEventCreateArgs) => { await transaction.auditEvent.create(args); return fail(transaction) },
          }
          if (point === 'parts' && property === '$executeRaw') return async (...args: Parameters<Prisma.TransactionClient['$executeRaw']>) => {
            const result = await transaction.$executeRaw(...args)
            if (await transaction.purchaseOrderPart.count({ where: { purchaseOrderId: id, shippingMarkText: { not: null } } })) return fail(transaction)
            return result
          }
          return Reflect.get(target, property)
        },
      }))
      await expect(mutations.prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })).rejects.toThrow()
      expect(observed).toBe(true)
      expect(await reviewFacts(fixture)).toEqual(before)
      const prepared = await createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })
      expect(prepared.shippingMarkText).toBe('MARK00000001')
    })
  })

  it.each(['missing part', 'wrong derived mark', 'independent part ledger', 'early constraint flush'] as const)('database guards reject %s and roll back the complete mark preparation', async point => {
    await withFixture(async fixture => {
      const original = await customInput(fixture)
      const input = { ...original, lines: [{ ...original.lines[0], quantity: 2 }], purchaseTotalAmount: '20', balanceDueAmount: '20',
        parts: [1, 2].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
      }
      const id = await createCommands(fixture).create(fixture.context(), input)
      const before = await reviewFacts(fixture)
      let reached = false
      const mutations = createReviewMutations(fixture, transaction => new Proxy(transaction, {
        get(target, property): unknown {
          if (point === 'early constraint flush' && property === 'purchaseOrder') return { ...transaction.purchaseOrder,
            update: async (args: Prisma.PurchaseOrderUpdateArgs) => {
              await transaction.$executeRawUnsafe('SET CONSTRAINTS purchase_orders_review_part_marks_trigger IMMEDIATE')
              reached = true
              return transaction.purchaseOrder.update(args)
            },
          }
          if (point !== 'early constraint flush' && property === '$executeRaw') return async (...args: Parameters<Prisma.TransactionClient['$executeRaw']>) => {
            const order = await transaction.purchaseOrder.findUniqueOrThrow({ where: { id } })
            if (order.shippingMarkText === null) return transaction.$executeRaw(...args)
            reached = true
            if (point === 'independent part ledger') return transaction.$executeRaw`UPDATE purchase_order_parts
              SET shipping_mark_issuance_id = ${order.shippingMarkIssuanceId}::uuid,
                  shipping_mark_key_hash = ${hashPurchaseOrderIdempotencyKey(id)}
              WHERE purchase_order_id = ${id}::uuid AND part_number = 1`
            const mark = point === 'wrong derived mark' ? `${order.shippingMarkText}/WRONG` : `${order.shippingMarkText}/货件-01`
            return transaction.$executeRaw`UPDATE purchase_order_parts SET shipping_mark_text = ${mark}
              WHERE purchase_order_id = ${id}::uuid AND part_number = 1`
          }
          return Reflect.get(target, property)
        },
      }))
      await expect(mutations.prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })).rejects.toThrow()
      expect(reached).toBe(true)
      expect(await reviewFacts(fixture)).toEqual(before)
    })
  })

  it.each([1, 2, 1000])('persists a 64 character base and exact derived suffixes for %i parts', async count => {
    await withFixture(async fixture => {
      const draft = await fixture.numberingCommands.update(fixture.configContext, fixture.customRule.id, {
        expectedVersion: fixture.customRule.version,
        segments: [{ type: 'FIXED', value: 'M'.repeat(56) }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
      })
      await fixture.numberingCommands.publish(fixture.configContext, fixture.customRule.id, { expectedVersion: draft.version, draftRevision: 2 })
      const original = await customInput(fixture)
      const input = { ...original, lines: [{ ...original.lines[0], quantity: count }], purchaseTotalAmount: String(count * 10), balanceDueAmount: String(count * 10),
        parts: Array.from({ length: count }, () => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
      }
      const id = await createCommands(fixture).create(fixture.context(), input)
      const detail = await createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })
      expect(detail.shippingMarkText).toBe(`${'M'.repeat(56)}00000001`)
      expect(detail.parts.map(part => part.shippingMarkText)).toEqual(Array.from({ length: count }, (_, index) => count === 1
        ? detail.shippingMarkText : `${detail.shippingMarkText}/货件-${String(index + 1).padStart(2, '0')}`))
      expect(detail.parts.at(-1)?.shippingMarkText?.length).toBe(count === 1 ? 64 : count === 1000 ? 72 : 70)
      expect((await atomicFacts(fixture.prisma)).ledger).toHaveLength(1)
      const first = await fixture.prisma.purchaseOrderPart.findFirstOrThrow({ where: { purchaseOrderId: id } })
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: first.id }, data: { shippingMarkText: 'CHANGED' } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: first.id }, data: { partNumber: count + 1 } })).rejects.toThrow()
    })
  })
})
