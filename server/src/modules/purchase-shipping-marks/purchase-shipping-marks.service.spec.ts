import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { DictionaryValueUnavailableError, type DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { ShippingMarkBindingQueryDto, SaveShippingMarkBindingDto } from './shipping-mark-binding.dto'
import { PurchaseShippingMarksService } from './purchase-shipping-marks.service'

const ruleId = '10000000-0000-4000-8000-000000000001'
const otherRuleId = '10000000-0000-4000-8000-000000000002'
const context = { actorUserId: '20000000-0000-4000-8000-000000000001', requestId: 'test-request' }
const validRule = { id: ruleId, ruleCode: 'WGJ_MARK', name: '微耕机唛头', purpose: 'SHIPPING_MARK', status: 'ENABLED', versions: [{ revision: 1 }] }

function harness(existing: { ruleId: string, version: number } | null = null) {
  const updatedAt = new Date('2026-09-06T00:00:00Z')
  const saved = { supplierValue: 'SUPPLIER-A', ruleId, version: (existing?.version ?? 0) + 1, updatedAt }
  const transaction = {
    $queryRaw: jest.fn().mockImplementation((query: { text: string }) => {
      if (query.text.includes('FOR UPDATE')) return Promise.resolve(existing ? [{ ...existing, updatedAt }] : [])
      if (query.text.includes('FOR SHARE')) return Promise.resolve([{ id: ruleId }])
      return Promise.resolve([])
    }),
    numberingRule: { findUnique: jest.fn().mockResolvedValue(validRule), findMany: jest.fn().mockResolvedValue([validRule]), count: jest.fn().mockResolvedValue(1) },
    supplierShippingMarkRuleBinding: {
      create: jest.fn().mockResolvedValue(saved),
      update: jest.fn().mockResolvedValue(saved),
    },
  }
  const prisma = { $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(transaction)) }
  const lookup = { requireEffectiveValue: jest.fn().mockResolvedValue({ value: 'SUPPLIER-A', label: '供应商甲' }) }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const service = new PurchaseShippingMarksService(prisma as unknown as PrismaService, lookup as unknown as DictionaryLookupService, audit)
  return { service, transaction, lookup, audit }
}

describe('shipping mark binding configuration', () => {
  it('requires explicit UUID and integer expectedVersion; rejects extra fields', async () => {
    expect(await validate(plainToInstance(SaveShippingMarkBindingDto, { ruleId, expectedVersion: 0 }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([])
    for (const input of [{ ruleId }, { ruleId, expectedVersion: -1 }, { ruleId, expectedVersion: '0' }, { ruleId, expectedVersion: 0, supplierId: ruleId }, { ruleId: 'CUSTOM_MARK', expectedVersion: 0 }]) {
      expect((await validate(plainToInstance(SaveShippingMarkBindingDto, input), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0)
    }
    expect((await validate(plainToInstance(ShippingMarkBindingQueryDto, { pageSize: 101, bindingStatus: 'INVALID' }))).length).toBe(2)
  })

  it('binds by stable supplier value and audits in the same transaction without issuing numbers', async () => {
    const { service, lookup, transaction, audit } = harness()
    const result = await service.save(context, 'supplier-a', { ruleId, expectedVersion: 0 })
    expect(result).toMatchObject({ supplierValue: 'SUPPLIER-A', version: 1, availability: 'AVAILABLE', rule: { ruleCode: 'WGJ_MARK' } })
    expect(lookup.requireEffectiveValue).toHaveBeenCalledWith(transaction, { dictionaryCode: 'service_provider.supplier', value: 'supplier-a' })
    expect(transaction.supplierShippingMarkRuleBinding.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ supplierValue: 'SUPPLIER-A', ruleId, createdByUserId: context.actorUserId }) as unknown }))
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({ metadata: expect.objectContaining({ previousRuleId: null, ruleId, version: 1 }) as unknown }))
  })

  it.each([
    { ...validRule, purpose: 'BUSINESS' },
    { ...validRule, status: 'DISABLED' },
    { ...validRule, versions: [] },
    null,
  ])('rejects unavailable rules without writes', async (rule) => {
    const { service, transaction, audit } = harness()
    transaction.numberingRule.findUnique.mockResolvedValue(rule)
    await expect(service.save(context, 'supplier-a', { ruleId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'SHIPPING_MARK_RULE_UNAVAILABLE' })
    expect(transaction.supplierShippingMarkRuleBinding.create).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rejects disabled suppliers and stale versions', async () => {
    const disabled = harness()
    disabled.lookup.requireEffectiveValue.mockRejectedValue(new DictionaryValueUnavailableError('DICTIONARY_ITEM_DISABLED'))
    await expect(disabled.service.save(context, 'supplier-a', { ruleId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'SHIPPING_MARK_SUPPLIER_UNAVAILABLE' })
    const stale = harness({ ruleId: otherRuleId, version: 2 })
    await expect(stale.service.save(context, 'supplier-a', { ruleId, expectedVersion: 1 })).rejects.toMatchObject({ code: 'SHIPPING_MARK_BINDING_CHANGED' })
    expect(stale.transaction.supplierShippingMarkRuleBinding.update).not.toHaveBeenCalled()
  })

  it('increments version only for a real change and preserves the previous rule in audit', async () => {
    const { service, transaction, audit } = harness({ ruleId: otherRuleId, version: 2 })
    await service.save(context, 'supplier-a', { ruleId, expectedVersion: 2 })
    expect(transaction.supplierShippingMarkRuleBinding.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) as unknown }))
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({ metadata: expect.objectContaining({ previousRuleId: otherRuleId, version: 3 }) as unknown }))
  })

  it('options allow shared rules and require shipping purpose, enabled state and active revision', async () => {
    const { service, transaction } = harness()
    const options = await service.options({ page: 1, pageSize: 20 })
    expect(options.items).toHaveLength(1)
    expect(transaction.numberingRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { purpose: 'SHIPPING_MARK', status: 'ENABLED', versions: { some: { status: 'ACTIVE' } } } }))
  })

  it('returns an unchanged binding without incrementing version or adding a duplicate audit event', async () => {
    const { service, transaction, audit } = harness({ ruleId, version: 2 })
    expect(await service.save(context, 'supplier-a', { ruleId, expectedVersion: 2 })).toMatchObject({ version: 2 })
    expect(transaction.supplierShippingMarkRuleBinding.update).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('classifies a first-write race as conflict and hides unknown persistence diagnostics', async () => {
    const { service, transaction } = harness()
    transaction.supplierShippingMarkRuleBinding.create.mockRejectedValueOnce({ code: 'P2002' })
    await expect(service.save(context, 'supplier-a', { ruleId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'SHIPPING_MARK_BINDING_CHANGED' })
    transaction.supplierShippingMarkRuleBinding.create.mockRejectedValueOnce(new Error('private-driver-diagnostic'))
    await expect(service.save(context, 'supplier-a', { ruleId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: '服务器内部错误' })
  })
})
