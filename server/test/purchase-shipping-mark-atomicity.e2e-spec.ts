import type { Prisma } from '../src/generated/prisma/client'
import { ApiException } from '../src/infrastructure/http/api.exception'
import { applyTransactionTimeouts } from '../src/infrastructure/database/transaction-timeouts'
import { readPersistenceErrorFacts } from '../src/infrastructure/database/persistence-error-facts'
import { createTestShippingMarkRule } from './purchase-shipping-mark-e2e-database'
import {
  atomicFacts, createAtomicityFixture, createCommands, createReviewMutations, customInput, MARK_CONSUMER,
  prepareCatalog, prepareImageReview, prepareSalesSource, type AtomicityFixture,
} from './purchase-shipping-mark-atomicity.fixture'

type FaultPoint = 'order' | 'lines' | 'audit'

async function withFixture(action: (fixture: AtomicityFixture) => Promise<void>): Promise<void> {
  const fixture = await createAtomicityFixture()
  try { await action(fixture) }
  finally { jest.restoreAllMocks(); await fixture.dispose() }
}

/** 只在真实事务方法成功写入后注入异常；不禁用数据库守卫、不增加生产测试钩子。 */
function wrapAfterInsert(
  transaction: Prisma.TransactionClient,
  point: FaultPoint,
  observe: (transaction: Prisma.TransactionClient) => Promise<void>,
): Prisma.TransactionClient {
  const fail = async () => { await observe(transaction); throw new Error('Injected after persisted write') }
  const delegate = point === 'order' ? {
    ...transaction.purchaseOrder,
    create: async (args: Prisma.PurchaseOrderCreateArgs) => { await transaction.purchaseOrder.create(args); return fail() },
  } : point === 'lines' ? {
    ...transaction.purchaseOrderLine,
    createMany: async (args: Prisma.PurchaseOrderLineCreateManyArgs) => { await transaction.purchaseOrderLine.createMany(args); return fail() },
  } : {
    ...transaction.auditEvent,
    create: async (args: Prisma.AuditEventCreateArgs) => { await transaction.auditEvent.create(args); return fail() },
  }
  const model = point === 'order' ? 'purchaseOrder' : point === 'lines' ? 'purchaseOrderLine' : 'auditEvent'
  return new Proxy(transaction, {
    get(target, property): unknown { return property === model ? delegate : Reflect.get(target, property) },
  })
}

async function assertNoNewPurchase(fixture: AtomicityFixture, before: Awaited<ReturnType<typeof atomicFacts>>) {
  expect(await atomicFacts(fixture.prisma)).toEqual(before)
}

describe('purchase shipping mark atomicity with real PostgreSQL', () => {
  jest.setTimeout(60_000)

  it('classifies a real serializable audit insertion conflict without leaking persistence details', async () => {
    await withFixture(async fixture => {
      let readers = 0
      let bothRead!: () => void
      let firstCommitted!: () => void
      const readBarrier = new Promise<void>(resolve => { bothRead = resolve })
      const commitBarrier = new Promise<void>(resolve => { firstCommitted = resolve })
      const before = await fixture.prisma.auditEvent.count()
      let insertionError: unknown
      const input = { eventType: 'PURCHASE_ORDER_CREATED', actorType: 'USER', actorUserId: fixture.actor.id, outcome: 'SUCCESS', targetType: 'PURCHASE_ORDER' } as const
      const read = async (transaction: Prisma.TransactionClient) => {
        await transaction.auditEvent.count()
        if (++readers === 2) bothRead()
        await readBarrier
      }
      // 两边先建立同一表的读依赖，第一笔提交后再放行第二笔写入；由真实 SSI
      // 决定冲突，不伪造 Prisma 错误、不替换数据库或放宽业务重试断言。
      const first = fixture.prisma.$transaction(async transaction => {
        await read(transaction)
        await fixture.audit.record(transaction, input)
      }, { isolationLevel: 'Serializable' })
      const second = fixture.prisma.$transaction(async transaction => {
        await read(transaction)
        await commitBarrier
        await fixture.audit.record(new Proxy(transaction, {
          get(target, property): unknown {
            if (property !== 'auditEvent') return Reflect.get(target, property)
            return { ...transaction.auditEvent, create: async (args: Prisma.AuditEventCreateArgs) => {
              try { return await transaction.auditEvent.create(args) }
              catch (error) { insertionError = error; throw error }
            } }
          },
        }), input)
      }, { isolationLevel: 'Serializable' }).then(() => undefined, (error: unknown) => error)
      try { await first }
      finally { firstCommitted() }
      const outerError = await second
      const insertionFacts = readPersistenceErrorFacts(insertionError)
      expect(insertionFacts.codes.has('40001')).toBe(true)
      expect(outerError).toMatchObject({ code: 'AUDIT_WRITE_FAILED', message: 'Audit event write failed', transactionConflict: true })
      expect(outerError).not.toHaveProperty('cause')
      expect(outerError).not.toHaveProperty('meta')
      expect(await fixture.prisma.auditEvent.count()).toBe(before + 1)
    })
  })

  it.each<FaultPoint>(['order', 'lines', 'audit'])('rolls back pending purchase facts without consuming a mark after the %s write', async (point) => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const before = await atomicFacts(fixture.prisma)
      let observed = false
      const observe = async (transaction: Prisma.TransactionClient) => {
        const inside = await atomicFacts(transaction)
        expect(inside.ledger).toHaveLength(0)
        expect(inside.periods).toHaveLength(0)
        expect(inside.orders).toHaveLength(1)
        expect(inside.lines).toHaveLength(point === 'lines' || point === 'audit' ? 1 : 0)
        expect(inside.audits).toHaveLength(point === 'audit' ? 1 : 0)
        observed = true
      }
      const command = createCommands(fixture, transaction => wrapAfterInsert(transaction, point, observe))
      await expect(command.create(fixture.context(), request)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(observed).toBe(true)
      await assertNoNewPurchase(fixture, before)
      // 采购单号仍按原独立事务永久派发；提交阶段从未申请唛头。
      expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: 'PURCHASE_ORDER.CREATE' } })).toBe(1)
    })
  })

  it('rolls back review and sales coverage while retaining the previously prepared mark and image', async () => {
    await withFixture(async (fixture) => {
      const { source, input } = await prepareSalesSource(fixture)
      const orderId = await createCommands(fixture).create(fixture.context(), input)
      const prepared = await prepareImageReview(fixture, orderId)
      const imageBefore = await fixture.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: prepared.imageDraftId } })
      const before = await atomicFacts(fixture.prisma)
      expect(before.orders[0]).toMatchObject({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED' })
      const advance = fixture.salesProgress.advanceWhenFullyCovered.bind(fixture.salesProgress)
      let reached = false
      jest.spyOn(fixture.salesProgress, 'advanceWhenFullyCovered').mockImplementation(async (transaction, context) => {
        await advance(transaction, context)
        expect(await transaction.salesOrder.findUnique({ where: { id: source.id }, select: { fulfillmentStatus: true } }))
          .toEqual({ fulfillmentStatus: 'PREPARING' })
        expect(await transaction.salesOrderStatusHistory.count({ where: { salesOrderId: source.id } })).toBe(1)
        expect((await atomicFacts(transaction)).audits).toHaveLength(2)
        expect((await atomicFacts(transaction)).ledger).toHaveLength(1)
        reached = true
        throw new Error('Injected after sales coverage')
      })
      await expect(createReviewMutations(fixture).review(fixture.context(), orderId, prepared))
        .rejects.toThrow('Injected after sales coverage')
      expect(reached).toBe(true)
      await assertNoNewPurchase(fixture, before)
      expect(await fixture.prisma.purchaseOrderImageDraft.findUniqueOrThrow({ where: { id: prepared.imageDraftId } })).toEqual(imageBefore)
      expect(await fixture.prisma.purchaseOrderDocument.count({ where: { purchaseOrderId: orderId } })).toBe(0)
      expect(await fixture.prisma.purchaseOrderStatusHistory.count({ where: { purchaseOrderId: orderId } })).toBe(0)
      expect(await fixture.prisma.salesOrder.findUnique({ where: { id: source.id }, select: { fulfillmentStatus: true, version: true } }))
        .toEqual({ fulfillmentStatus: 'PENDING', version: 1 })
      expect(await fixture.prisma.salesOrderStatusHistory.count({ where: { salesOrderId: source.id } })).toBe(0)
    })
  })

  it('uses CUSTOM_MARK once during image preparation and replays the original submission after disabling the rule', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const context = fixture.context()
      const command = createCommands(fixture)
      const id = await command.create(context, request)
      await createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 })
      const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { parts: true, shippingMarkIssuance: { include: { rule: true } } } })
      expect(order.shippingMarkIssuance?.rule.ruleCode).toBe('CUSTOM_MARK')
      expect(order.parts[0].shippingMarkText).toBe(order.shippingMarkIssuance?.generatedNumber)
      expect(order.shippingMarkText).toBe(order.parts[0].shippingMarkText)
      expect(order.parts[0].shippingMarkIssuanceId).toBeNull()
      await fixture.numberingCommands.disable(fixture.configContext, fixture.customRule.id, { expectedVersion: fixture.customRule.version })
      const before = await atomicFacts(fixture.prisma)
      jest.spyOn(fixture.resolver, 'resolve').mockRejectedValue(new Error('Replay must not resolve current rules'))
      await expect(command.create(context, request)).resolves.toBe(id)
      expect(fixture.resolver.resolve).not.toHaveBeenCalled()
      expect(await atomicFacts(fixture.prisma)).toEqual(before)
    })
  })

  it('recovers an actual committed purchase when its transaction acknowledgement is lost', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      let acknowledgementLost = false
      const command = createCommands(fixture, undefined, () => {
        acknowledgementLost = true
        throw new Error('Injected lost commit acknowledgement')
      })
      const id = await command.create(fixture.context(), request)
      expect(acknowledgementLost).toBe(true)
      const facts = await atomicFacts(fixture.prisma)
      expect(facts.orders.map(order => order.id)).toEqual([id])
      expect(facts.ledger).toHaveLength(0)
      expect(facts.lines).toHaveLength(1)
      expect(facts.audits).toHaveLength(1)
    })
  })

  it('recovers a competing committed purchase when the outer preflight later fails', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const context = fixture.context()
      const command = createCommands(fixture)
      let competingId: string | undefined
      jest.spyOn(fixture.dependencies, 'requireDependencies').mockImplementationOnce(async () => {
        competingId = await command.create(context, request)
        throw new ApiException(409, 'PURCHASE_ORDER_SOURCE_QUANTITY_EXCEEDED', 'Source quantity is already used')
      })
      const id = await command.create(context, request)
      expect(id).toBe(competingId)
      const facts = await atomicFacts(fixture.prisma)
      expect(facts.orders).toHaveLength(1)
      expect(facts.ledger).toHaveLength(0)
    })
  })

  it('replays a committed catalog order after its supplier binding changes', async () => {
    await withFixture(async (fixture) => {
      const catalog = await prepareCatalog(fixture)
      const context = fixture.context()
      const command = createCommands(fixture)
      const id = await command.create(context, catalog.input)
      await fixture.bindings.save(fixture.configContext, catalog.supplierValue, { ruleId: fixture.customRule.id, expectedVersion: 1 })
      const before = await atomicFacts(fixture.prisma)
      jest.spyOn(fixture.resolver, 'resolve').mockRejectedValue(new Error('Replay must not resolve changed bindings'))
      await expect(command.create(context, catalog.input)).resolves.toBe(id)
      expect(fixture.resolver.resolve).not.toHaveBeenCalled()
      expect(await atomicFacts(fixture.prisma)).toEqual(before)
    })
  })

  it.each(['same key', 'different keys'])('handles concurrent %s on a shared sequence safely', async (mode) => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const command = createCommands(fixture)
      const first = fixture.context()
      const contexts = [first, mode === 'same key' ? first : fixture.context(), mode === 'same key' ? first : fixture.context()]
      const settled = await Promise.allSettled(contexts.map(context => command.create(context, request)))
      const ids: string[] = []
      for (const [index, result] of settled.entries()) {
        if (result.status === 'fulfilled') ids.push(result.value)
        else {
          expect(result.reason).toBeInstanceOf(ApiException)
          expect(result.reason).toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
          // PostgreSQL Serializable 可拒绝竞争者；在所有首轮退出后，以同一键及快照重试。
          ids.push(await command.create(contexts[index], request))
        }
      }
      const expected = mode === 'same key' ? 1 : 3
      expect(new Set(ids).size).toBe(expected)
      const facts = await atomicFacts(fixture.prisma)
      expect(facts.ledger).toHaveLength(0)
      expect(facts.orders).toHaveLength(expected)
      expect(facts.lines).toHaveLength(expected)
      expect(facts.audits).toHaveLength(expected)
      expect(facts.periods).toEqual([])
    })
  })

  it('rejects a changed binding before consuming either sequence', async () => {
    await withFixture(async (fixture) => {
      const catalog = await prepareCatalog(fixture)
      await fixture.bindings.save(fixture.configContext, catalog.supplierValue, { ruleId: fixture.customRule.id, expectedVersion: 1 })
      const before = await atomicFacts(fixture.prisma)
      await expect(createCommands(fixture).create(fixture.context(), catalog.input))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED' })
      await assertNoNewPurchase(fixture, before)
      expect(await fixture.prisma.numberingIssuance.count()).toBe(0)
    })
  })

  it('rejects a binding change between preflight and the purchase transaction without consuming a mark', async () => {
    await withFixture(async (fixture) => {
      const catalog = await prepareCatalog(fixture)
      const generate = fixture.numbering.generateScoped.bind(fixture.numbering)
      jest.spyOn(fixture.numbering, 'generateScoped').mockImplementation(async (input) => {
        const result = await generate(input)
        await fixture.bindings.save(fixture.configContext, catalog.supplierValue, { ruleId: fixture.customRule.id, expectedVersion: 1 })
        return result
      })
      const before = await atomicFacts(fixture.prisma)
      await expect(createCommands(fixture).create(fixture.context(), catalog.input))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED' })
      await assertNoNewPurchase(fixture, before)
      expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: 'PURCHASE_ORDER.CREATE' } })).toBe(1)
    })
  })

  it('rejects a changed active revision without consuming either sequence', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const draft = await fixture.numberingCommands.update(fixture.configContext, fixture.customRule.id, {
        expectedVersion: fixture.customRule.version,
        segments: [{ type: 'FIXED', value: 'NEW' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' }],
      })
      await fixture.numberingCommands.publish(fixture.configContext, fixture.customRule.id, { expectedVersion: draft.version, draftRevision: 2 })
      const before = await atomicFacts(fixture.prisma)
      await expect(createCommands(fixture).create(fixture.context(), request))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED' })
      await assertNoNewPurchase(fixture, before)
      expect(await fixture.prisma.numberingIssuance.count()).toBe(0)
    })
  })

  it('keeps rollback boundaries when the rule row cannot be locked', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const id = await createCommands(fixture).create(fixture.context(), request)
      let release!: () => void
      let acquired!: () => void
      const acquiredPromise = new Promise<void>(resolve => { acquired = resolve })
      const releasePromise = new Promise<void>(resolve => { release = resolve })
      const blocker = fixture.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        await transaction.$queryRaw`SELECT id FROM numbering_rules WHERE rule_code = 'CUSTOM_MARK' FOR UPDATE`
        acquired()
        await releasePromise
      }, { timeout: 10_000 })
      await acquiredPromise
      const before = await atomicFacts(fixture.prisma)
      try {
        await expect(createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), id, { expectedVersion: 1 }))
          .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
      }
      finally { release(); await blocker }
      await assertNoNewPurchase(fixture, before)
    })
  })

  it('returns image mark capacity exhaustion without changing the pending order or consuming a second mark', async () => {
    await withFixture(async (fixture) => {
      const limited = await createTestShippingMarkRule(fixture.prisma, fixture.actor.id, 'LIMITED_MARK')
      const draft = await fixture.numberingCommands.update(fixture.configContext, limited.id, {
        expectedVersion: limited.version, segments: [{ type: 'SEQUENCE', width: 1, startValue: '9', step: '1' }],
      })
      await fixture.numberingCommands.publish(fixture.configContext, limited.id, { expectedVersion: draft.version, draftRevision: 2 })
      const catalog = await prepareCatalog(fixture)
      await fixture.bindings.save(fixture.configContext, catalog.supplierValue, { ruleId: limited.id, expectedVersion: 1 })
      const resolution = await fixture.resolver.read({ productMode: 'CATALOG', supplierValue: catalog.supplierValue })
      const request = { ...catalog.input, expectedShippingMarkResolution: resolution.resolutionToken }
      const command = createCommands(fixture)
      const first = await command.create(fixture.context(), request)
      const second = await command.create(fixture.context(), request)
      await createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), first, { expectedVersion: 1 })
      const before = await atomicFacts(fixture.prisma)
      await expect(createReviewMutations(fixture).prepareReviewShippingMarks(fixture.context(), second, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE' })
      await assertNoNewPurchase(fixture, before)
      expect(before.ledger.filter(row => row.consumerCode === MARK_CONSUMER)).toHaveLength(1)
    })
  })
})
