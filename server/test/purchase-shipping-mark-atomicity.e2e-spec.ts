import type { Prisma } from '../src/generated/prisma/client'
import { ApiException } from '../src/infrastructure/http/api.exception'
import { applyTransactionTimeouts } from '../src/infrastructure/database/transaction-timeouts'
import { createTestShippingMarkRule } from './purchase-shipping-mark-e2e-database'
import {
  atomicFacts, createAtomicityFixture, createCommands, customInput, MARK_CONSUMER,
  prepareCatalog, prepareSalesSource, type AtomicityFixture,
} from './purchase-shipping-mark-atomicity.fixture'

type FaultPoint = 'mark' | 'order' | 'lines' | 'audit'

async function withFixture(action: (fixture: AtomicityFixture) => Promise<void>): Promise<void> {
  const fixture = await createAtomicityFixture()
  try { await action(fixture) }
  finally { jest.restoreAllMocks(); await fixture.dispose() }
}

/** 只在真实事务方法成功写入后注入异常；不禁用数据库守卫、不增加生产测试钩子。 */
function wrapAfterInsert(
  transaction: Prisma.TransactionClient,
  point: Exclude<FaultPoint, 'mark'>,
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

  it.each<FaultPoint>(['mark', 'order', 'lines', 'audit'])('rolls back every purchase fact after the %s write', async (point) => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const before = await atomicFacts(fixture.prisma)
      let observed = false
      const observe = async (transaction: Prisma.TransactionClient) => {
        const inside = await atomicFacts(transaction)
        expect(inside.ledger).toHaveLength(1)
        expect(inside.periods).toHaveLength(1)
        expect(inside.periods[0].usedCount).toBe(1n)
        expect(inside.orders).toHaveLength(point === 'mark' ? 0 : 1)
        expect(inside.lines).toHaveLength(point === 'lines' || point === 'audit' ? 1 : 0)
        expect(inside.audits).toHaveLength(point === 'audit' ? 1 : 0)
        observed = true
      }
      if (point === 'mark') {
        const generate = fixture.numbering.generateScopedInTransaction.bind(fixture.numbering)
        jest.spyOn(fixture.numbering, 'generateScopedInTransaction').mockImplementation(async (transaction, input) => {
          await generate(transaction, input)
          await observe(transaction)
          throw new Error('Injected after mark generation')
        })
      }
      const command = createCommands(fixture, point === 'mark' ? undefined : transaction => wrapAfterInsert(transaction, point, observe))
      await expect(command.create(fixture.context(), request)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(observed).toBe(true)
      await assertNoNewPurchase(fixture, before)
      // 采购单号仍按原独立事务永久派发；只回滚未提交的唛头与采购事实。
      expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: 'PURCHASE_ORDER.CREATE' } })).toBe(1)
    })
  })

  it('rolls back actual sales coverage changes after their audit has been inserted', async () => {
    await withFixture(async (fixture) => {
      const { source, input } = await prepareSalesSource(fixture)
      const before = await atomicFacts(fixture.prisma)
      const advance = fixture.salesProgress.advanceWhenFullyCovered.bind(fixture.salesProgress)
      let reached = false
      jest.spyOn(fixture.salesProgress, 'advanceWhenFullyCovered').mockImplementation(async (transaction, context) => {
        await advance(transaction, context)
        expect(await transaction.salesOrder.findUnique({ where: { id: source.id }, select: { fulfillmentStatus: true } }))
          .toEqual({ fulfillmentStatus: 'PREPARING' })
        expect(await transaction.salesOrderStatusHistory.count({ where: { salesOrderId: source.id } })).toBe(1)
        expect((await atomicFacts(transaction)).audits).toHaveLength(1)
        reached = true
        throw new Error('Injected after sales coverage')
      })
      await expect(createCommands(fixture).create(fixture.context(), input)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(reached).toBe(true)
      await assertNoNewPurchase(fixture, before)
      expect(await fixture.prisma.salesOrder.findUnique({ where: { id: source.id }, select: { fulfillmentStatus: true, version: true } }))
        .toEqual({ fulfillmentStatus: 'PENDING', version: 1 })
      expect(await fixture.prisma.salesOrderStatusHistory.count({ where: { salesOrderId: source.id } })).toBe(0)
    })
  })

  it('uses CUSTOM_MARK and replays a committed order after that rule is disabled', async () => {
    await withFixture(async (fixture) => {
      const request = await customInput(fixture)
      const context = fixture.context()
      const command = createCommands(fixture)
      const id = await command.create(context, request)
      const order = await fixture.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { shippingMarkIssuance: { include: { rule: true } } } })
      expect(order.shippingMarkIssuance?.rule.ruleCode).toBe('CUSTOM_MARK')
      expect(order.shippingMarkText).toBe(order.shippingMarkIssuance?.generatedNumber)
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
      expect(facts.ledger).toHaveLength(1)
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
      expect(facts.ledger).toHaveLength(1)
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
      expect(facts.ledger).toHaveLength(expected)
      expect(facts.orders).toHaveLength(expected)
      expect(facts.lines).toHaveLength(expected)
      expect(facts.audits).toHaveLength(expected)
      expect(new Set(facts.ledger.map(row => row.generatedNumber)).size).toBe(expected)
      expect(facts.ledger.map(row => row.sequenceValue).sort()).toEqual(expected === 1 ? [1n] : [1n, 2n, 3n])
      expect(facts.periods[0].usedCount).toBe(BigInt(expected))
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
        await expect(createCommands(fixture).create(fixture.context(), request))
          .rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
      }
      finally { release(); await blocker }
      await assertNoNewPurchase(fixture, before)
    })
  })

  it('returns capacity exhaustion without creating a purchase or consuming a second mark', async () => {
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
      await command.create(fixture.context(), request)
      const before = await atomicFacts(fixture.prisma)
      await expect(command.create(fixture.context(), request)).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE' })
      await assertNoNewPurchase(fixture, before)
      expect(before.ledger.filter(row => row.consumerCode === MARK_CONSUMER)).toHaveLength(1)
    })
  })
})
