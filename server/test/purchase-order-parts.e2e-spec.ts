import { randomUUID } from 'node:crypto'

import type { Prisma } from '../src/generated/prisma/client'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { normalizePurchaseOrderCreateCommand } from '../src/modules/purchase-orders/purchase-order-command.normalizer'
import { calculatePurchaseOrderCreateFingerprint, hashPurchaseOrderIdempotencyKey, PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION } from '../src/modules/purchase-orders/purchase-order-create-fingerprint'
import { PurchaseOrderQueryService } from '../src/modules/purchase-orders/purchase-order-query.service'
import { atomicFacts, createAtomicityFixture, createCommands, customInput, type AtomicityFixture } from './purchase-shipping-mark-atomicity.fixture'

async function withFixture(action: (fixture: AtomicityFixture) => Promise<void>, legacy = false) {
  const fixture = await createAtomicityFixture(legacy)
  try { await action(fixture) }
  finally { jest.restoreAllMocks(); await fixture.dispose() }
}

describe('purchase parts with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  it('persists split and merged parts, their own marks, search and the exact quantities', async () => {
    await withFixture(async fixture => {
      const original = await customInput(fixture)
      const input = { ...original,
        lines: [{ ...original.lines[0], quantity: 5 }, { ...original.lines[0], name: 'Second item', quantity: 2 }],
        parts: [
          { key: randomUUID(), items: [{ lineNumber: 1, quantity: 2 }] },
          { key: randomUUID(), items: [{ lineNumber: 1, quantity: 3 }, { lineNumber: 2, quantity: 2 }] },
        ], purchaseTotalAmount: '70', balanceDueAmount: '70',
      }
      const context = fixture.context()
      const commands = createCommands(fixture)
      const id = await commands.create(context, input)
      expect(await fixture.prisma.purchaseOrder.findUnique({ where: { id }, select: { partConfigurationSealed: true, version: true, orderStatus: true } }))
        .toEqual({ partConfigurationSealed: true, version: 1, orderStatus: 'PENDING_REVIEW' })
      await expect(fixture.prisma.purchaseOrder.update({ where: { id }, data: { partConfigurationSealed: false } })).rejects.toThrow()
      const query = new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
      const detail = await query.getById(id)
      expect(detail.shippingMarkText).toBeNull()
      expect(detail.shippingMarks).toHaveLength(2)
      expect(new Set(detail.shippingMarks).size).toBe(2)
      expect(detail.parts.map(part => part.partNumber)).toEqual([1, 2])
      expect(detail.parts.map(part => part.items.map(({ lineNumber, quantity }) => ({ lineNumber, quantity })))).toEqual(input.parts.map(part => part.items))
      expect(await query.list({ view: 'all', keyword: detail.shippingMarks[1] })).toMatchObject({ total: 1, items: [{ id }] })
      await expect(commands.create(context, input)).resolves.toBe(id)
      await expect(commands.create(context, { ...input, parts: [...input.parts].reverse() })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT' })
      const facts = await atomicFacts(fixture.prisma)
      expect(facts.ledger).toHaveLength(2)
      expect(facts.audits[0].metadata).toMatchObject({ partCount: 2, shippingMarkIssuanceIds: expect.arrayContaining(facts.ledger.map(row => row.id)) as unknown })
      const firstPart = await fixture.prisma.purchaseOrderPart.findFirstOrThrow({ where: { purchaseOrderId: id }, include: { items: true } })
      await expect(fixture.prisma.purchaseOrderPart.update({ where: { id: firstPart.id }, data: { shippingMarkText: 'forged' } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPart.delete({ where: { id: firstPart.id } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPartItem.update({ where: { id: firstPart.items[0].id }, data: { quantity: 99 } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderLine.update({ where: { id: firstPart.items[0].purchaseOrderLineId }, data: { quantity: 99 } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPart.create({ data: {
        purchaseOrderId: id, key: randomUUID(), partNumber: 3,
        shippingMarkText: firstPart.shippingMarkText, shippingMarkIssuanceId: firstPart.shippingMarkIssuanceId,
        shippingMarkKeyHash: firstPart.shippingMarkKeyHash,
      } })).rejects.toThrow()
      await expect(fixture.prisma.purchaseOrderPartItem.create({ data: {
        purchaseOrderId: id, purchaseOrderPartId: firstPart.id,
        purchaseOrderLineId: firstPart.items[0].purchaseOrderLineId, quantity: 1,
      } })).rejects.toThrow()
    })
  })

  it('rolls back earlier marks when generation of the second part fails', async () => {
    await withFixture(async fixture => {
      const original = await customInput(fixture)
      const input = { ...original, lines: [{ ...original.lines[0], quantity: 2 }], purchaseTotalAmount: '20', balanceDueAmount: '20',
        parts: [1, 2].map(() => ({ key: randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] })),
      }
      const generate = fixture.numbering.generateScopedInTransaction.bind(fixture.numbering)
      let calls = 0
      jest.spyOn(fixture.numbering, 'generateScopedInTransaction').mockImplementation(async (transaction, request) => {
        const result = await generate(transaction, request)
        if (++calls === 2) throw new Error('Injected second part failure')
        return result
      })
      const before = await atomicFacts(fixture.prisma)
      await expect(createCommands(fixture).create(fixture.context(), input)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(calls).toBe(2)
      expect(await atomicFacts(fixture.prisma)).toEqual(before)
      expect(await fixture.prisma.purchaseOrderPart.count()).toBe(0)
      expect(await fixture.prisma.purchaseOrderPartItem.count()).toBe(0)
    })
  })

  it('enforces quantity coverage in PostgreSQL even when an internal writer omits an item', async () => {
    await withFixture(async fixture => {
      const input = await customInput(fixture)
      const commands = createCommands(fixture, transaction => new Proxy(transaction, {
        get(target, property): unknown {
          if (property !== 'purchaseOrderPartItem') return Reflect.get(target, property)
          return { ...transaction.purchaseOrderPartItem,
            createMany: () => Promise.resolve({ count: 0 }),
          }
        },
      }))
      await expect(commands.create(fixture.context(), input)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(await fixture.prisma.purchaseOrder.count()).toBe(0)
      expect(await fixture.prisma.purchaseOrderPart.count()).toBe(0)
      expect(await fixture.prisma.numberingIssuance.count({ where: { consumerCode: 'PURCHASE_ORDER.PART_SHIPPING_MARK' } })).toBe(0)
    })
  })

  it('rejects an extra allocation after a writer explicitly flushes deferred coverage', async () => {
    await withFixture(async fixture => {
      const original = await customInput(fixture)
      const input = { ...original, lines: [original.lines[0], { ...original.lines[0], name: 'Second item' }],
        purchaseTotalAmount: '20', balanceDueAmount: '20',
        parts: [1, 2].map(lineNumber => ({ key: randomUUID(), items: [{ lineNumber, quantity: 1 }] })),
      }
      const commands = createCommands(fixture, transaction => new Proxy(transaction, {
        get(target, property): unknown {
          if (property !== 'purchaseOrderPartItem') return Reflect.get(target, property)
          return { ...transaction.purchaseOrderPartItem,
            createMany: async (args: Prisma.PurchaseOrderPartItemCreateManyArgs) => {
              const result = await transaction.purchaseOrderPartItem.createMany(args)
              const { partConfigurationSealed, ...before } = await transaction.purchaseOrder.findFirstOrThrow()
              expect(partConfigurationSealed).toBe(false)
              await transaction.$executeRawUnsafe('SET CONSTRAINTS purchase_orders_part_coverage_trigger IMMEDIATE')
              expect(await transaction.purchaseOrder.findFirstOrThrow()).toEqual({ ...before, partConfigurationSealed: true })
              const [first, second] = await transaction.purchaseOrderPartItem.findMany({ orderBy: { purchaseOrderLineId: 'asc' } })
              await transaction.purchaseOrderPartItem.create({ data: {
                purchaseOrderId: first.purchaseOrderId, purchaseOrderPartId: first.purchaseOrderPartId,
                purchaseOrderLineId: second.purchaseOrderLineId, quantity: 1,
              } })
              return result
            },
          }
        },
      }))
      await expect(commands.create(fixture.context(), input)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(await fixture.prisma.purchaseOrder.count()).toBe(0)
      expect(await fixture.prisma.purchaseOrderPart.count()).toBe(0)
    })
  })

  it.each([[100, 1], [1000, 1], [1000, 10]])('atomically creates and replays %i parts with %i items each within the purchase transaction budget', async (count, lineCount) => {
    await withFixture(async fixture => {
      const original = await customInput(fixture)
      const input = { ...original, lines: Array.from({ length: lineCount }, (_, index) => ({ ...original.lines[0], name: `Item ${index}`, quantity: count })),
        purchaseTotalAmount: String(count * lineCount * 10), balanceDueAmount: String(count * lineCount * 10),
        parts: Array.from({ length: count }, () => ({ key: randomUUID(), items: Array.from({ length: lineCount }, (_, index) => ({ lineNumber: index + 1, quantity: 1 })) })),
      }
      const context = fixture.context()
      const command = createCommands(fixture)
      const id = await command.create(context, input)
      expect(await fixture.prisma.purchaseOrderPart.count({ where: { purchaseOrderId: id } })).toBe(count)
      expect(await fixture.prisma.purchaseOrderPartItem.aggregate({ where: { purchaseOrderId: id }, _sum: { quantity: true } })).toMatchObject({ _sum: { quantity: count * lineCount } })
      await expect(command.create(context, input)).resolves.toBe(id)
    })
  })

  it('migrates historical v3 orders without backfill and restores their old submitted snapshot', async () => {
    await withFixture(async fixture => {
      const { parts: _parts, ...input } = await customInput(fixture)
      void _parts
      const context = fixture.context()
      const command = normalizePurchaseOrderCreateCommand(input, '2026-09-07', true)
      const fingerprint = calculatePurchaseOrderCreateFingerprint(context.actorUserId, command, PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION)
      const hash = hashPurchaseOrderIdempotencyKey(context.idempotencyKey)
      const id = await fixture.prisma.$transaction(async transaction => {
        const mark = await fixture.numbering.generateScopedInTransaction(transaction, {
          ruleCode: 'CUSTOM_MARK', consumerCode: 'PURCHASE_ORDER.SHIPPING_MARK', idempotencyKey: context.idempotencyKey, requestFingerprint: fingerprint,
        })
        // 使用迁移前真实列集合，避免新 Prisma Client 自动写入新版本默认字段。
        const id = randomUUID()
        await transaction.$executeRaw`INSERT INTO purchase_orders (
          id, order_no, create_idempotency_key_hash, create_request_fingerprint_hash,
          purchase_type, product_mode, custom_supplier_name, order_date, currency_code,
          shipping_mark_text, shipping_mark_issuance_id, line_subtotal_amount, purchase_total_amount,
          deposit_due_amount, balance_due_amount, created_by_user_id
        ) VALUES (${id}::uuid, 'LEGACY-001', ${hash}, ${Buffer.from(fingerprint, 'hex')},
          'STOCK', 'CUSTOM', ${input.customSupplierName}, ${new Date(input.orderDate)}, 'CNY',
          ${mark.number}, ${mark.issuanceId}::uuid, 10, 10, 0, 10, ${fixture.actor.id}::uuid)`
        await transaction.purchaseOrderLine.create({ data: {
          purchaseOrderId: id, lineNumber: 1, lineType: 'CUSTOM', productNameSnapshot: 'Custom item',
          productAttributesSnapshot: [], referencePurchaseUnitPriceAmount: '10', actualPurchaseUnitPriceAmount: '10', quantity: 1, lineTotalAmount: '10',
        } })
        return id
      })
      const before = await fixture.prisma.numberingIssuance.findMany()
      await fixture.migrateParts()
      expect(await fixture.prisma.numberingIssuance.findMany()).toEqual(before)
      expect(await fixture.prisma.purchaseOrderPart.count()).toBe(0)
      expect(await fixture.prisma.purchaseOrder.findUnique({ where: { id }, select: { createRequestFingerprintVersion: true } }))
        .toEqual({ createRequestFingerprintVersion: PURCHASE_ORDER_LEGACY_FINGERPRINT_VERSION })
      await expect(fixture.prisma.purchaseOrder.update({ where: { id }, data: { partConfigurationSealed: true } })).rejects.toThrow()
      jest.spyOn(fixture.resolver, 'resolve').mockRejectedValue(new Error('Legacy replay must not resolve current configuration'))
      await expect(createCommands(fixture).create(context, input)).resolves.toBe(id)
      await expect(createCommands(fixture).create(context, { ...input, remark: 'changed' })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_CREATE_IDEMPOTENCY_CONFLICT' })
      await expect(createCommands(fixture).create(fixture.context(), input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      const query = new PurchaseOrderQueryService(fixture.prisma, new DictionaryLookupService(fixture.prisma))
      const detail = await query.getById(id)
      expect(detail.parts).toEqual([])
      expect(detail.shippingMarks).toEqual([])
      expect(detail.shippingMarkText).toBe(before[0].generatedNumber)
      expect(await query.list({ view: 'all', keyword: detail.shippingMarkText! })).toMatchObject({ total: 1 })
    }, true)
  })
})
