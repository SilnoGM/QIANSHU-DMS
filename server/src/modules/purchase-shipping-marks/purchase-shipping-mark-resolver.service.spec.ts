import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { Prisma } from '../../generated/prisma/client'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { DictionaryValueUnavailableError, type DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { NumberingRuleConfigResponseDto } from '../numbering/dto/numbering-response.dto'
import { NUMBERING_VERSION_READ_SELECT, type NumberingVersionReadRow } from '../numbering/numbering-query.persistence'
import { PurchaseOrderShippingMarkResolutionQueryDto } from './purchase-shipping-mark-resolution.dto'
import { PurchaseShippingMarkResolverService } from './purchase-shipping-mark-resolver.service'

const ruleId = '10000000-0000-4000-8000-000000000001'
type StoredSegment = NumberingVersionReadRow['segments'][number]
function storedSegment(position: number, type: StoredSegment['type'], fields: Partial<StoredSegment>): StoredSegment {
  return {
    id: `segment-${position}`, position, type,
    fixedValue: null, dateFormat: null, separatorValue: null,
    sequenceWidth: null, sequenceStartValue: null, sequenceStep: null,
    randomLetterLength: null, randomDigitLength: null, randomMode: null,
    ...fields,
  }
}
const activeVersion: NumberingVersionReadRow = {
  id: '20000000-0000-4000-8000-000000000001', revision: 3, status: 'ACTIVE',
  resetPolicy: 'DAILY', timezone: 'Asia/Shanghai',
  createdAt: new Date('2026-09-07T00:00:00Z'), publishedAt: new Date('2026-09-07T00:00:00Z'),
  segments: [
    storedSegment(1, 'FIXED', { fixedValue: 'SM' }),
    storedSegment(2, 'DATE', { dateFormat: 'YYYYMMDD' }),
    storedSegment(3, 'SEPARATOR', { separatorValue: '-' }),
    storedSegment(4, 'SEQUENCE', { sequenceWidth: 16, sequenceStartValue: 9007199254740993n, sequenceStep: 7n }),
    storedSegment(5, 'RANDOM', { randomLetterLength: 2, randomDigitLength: 1, randomMode: 'SHUFFLED' }),
  ],
}
const activeConfig: NumberingRuleConfigResponseDto = {
  resetPolicy: 'DAILY', timezone: 'Asia/Shanghai', maxOutputLength: 30,
  segments: [
    { type: 'FIXED', value: 'SM' }, { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 16, startValue: '9007199254740993', step: '7' },
    { type: 'RANDOM', letterLength: 2, digitLength: 1, mode: 'SHUFFLED' },
  ],
}
const validRule = { id: ruleId, ruleCode: 'SUPPLIER_MARK', name: '供应商唛头', purpose: 'SHIPPING_MARK', status: 'ENABLED', versions: [activeVersion] }

function harness() {
  const events: string[] = []
  const transaction = {
    $queryRaw: jest.fn().mockImplementation((query: { text: string }) => {
      if (query.text.includes('supplier_shipping_mark_rule_bindings')) {
        events.push('binding-lock')
        return Promise.resolve([{ ruleId, version: 2 }])
      }
      if (query.text.includes('numbering_rules')) events.push('rule-lock')
      return Promise.resolve([])
    }),
    supplierShippingMarkRuleBinding: { findUnique: jest.fn().mockResolvedValue({ ruleId, version: 2 }) },
    numberingRule: { findUnique: jest.fn().mockImplementation(() => {
      events.push('rule-read')
      return Promise.resolve(validRule)
    }) },
  }
  const prisma = { $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(transaction)) }
  const lookup = {
    requireEffectiveValue: jest.fn().mockImplementation(() => {
      events.push('dictionary-lock')
      return Promise.resolve({ value: 'SUPPLIER_A', label: '供应商甲' })
    }),
    resolveStoredValueInTransaction: jest.fn().mockResolvedValue({ known: true, value: 'SUPPLIER_A', effectiveEnabled: true }),
  }
  const service = new PurchaseShippingMarkResolverService(prisma as unknown as PrismaService, lookup as unknown as DictionaryLookupService)
  return { service, transaction, tx: transaction as unknown as Prisma.TransactionClient, prisma, lookup, events }
}

describe('PurchaseShippingMarkResolverService', () => {
  it('resolves a canonical supplier value without locks or number issuance', async () => {
    const h = harness()
    const result = await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: ' supplier_a ' }, false)
    expect(result).toEqual({ productMode: 'CATALOG', matchSource: 'SUPPLIER_BINDING', ruleId, ruleCode: 'SUPPLIER_MARK', name: '供应商唛头', activeRevision: 3, activeConfig, availability: 'AVAILABLE', message: expect.any(String) as unknown, resolutionToken: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown })
    expect(h.transaction.numberingRule.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ versions: { where: { status: 'ACTIVE' }, select: NUMBERING_VERSION_READ_SELECT, take: 1 } }) as unknown,
    }))
    expect(h.lookup.resolveStoredValueInTransaction).toHaveBeenCalledWith(h.tx, { dictionaryCode: 'service_provider.supplier', value: 'SUPPLIER_A' })
    expect(h.transaction.supplierShippingMarkRuleBinding.findUnique).toHaveBeenCalledWith({ where: { supplierValue: 'SUPPLIER_A' }, select: { ruleId: true, version: true } })
    expect(h.transaction.$queryRaw).not.toHaveBeenCalled()
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
    expect(h.lookup.requireEffectiveValue).not.toHaveBeenCalled()
    // 新增展示配置不参与摘要，保留扩展响应前的稳定 token。
    expect(result.resolutionToken).toBe('cd686b4aad481bb4d5debdb3f476465c1143c4513160610c8c7068d530d83068')
  })

  it('keeps the resolution token stable for labels and equivalent supplier input, but changes it for binding version and active revision', async () => {
    const h = harness()
    const input = { productMode: 'CATALOG' as const, supplierValue: 'SUPPLIER_A' }
    const first = await h.service.resolve(h.tx, input, false)
    h.transaction.numberingRule.findUnique.mockResolvedValueOnce({ ...validRule, name: '新规则名称' })
    expect((await h.service.resolve(h.tx, input, false)).resolutionToken).toBe(first.resolutionToken)
    expect((await h.service.resolve(h.tx, { ...input, supplierValue: 'supplier_a' }, false)).resolutionToken).toBe(first.resolutionToken)
    h.transaction.supplierShippingMarkRuleBinding.findUnique.mockResolvedValueOnce({ ruleId, version: 3 })
    expect((await h.service.resolve(h.tx, input, false)).resolutionToken).not.toBe(first.resolutionToken)
    h.transaction.numberingRule.findUnique.mockResolvedValueOnce({ ...validRule, versions: [{ ...activeVersion, revision: 4 }] })
    expect((await h.service.resolve(h.tx, input, false)).resolutionToken).not.toBe(first.resolutionToken)
  })

  it('uses the fixed custom identity without querying suppliers or bindings', async () => {
    const h = harness()
    h.transaction.numberingRule.findUnique.mockImplementationOnce(() => {
      h.events.push('rule-read')
      return Promise.resolve({ ...validRule, ruleCode: 'CUSTOM_MARK' })
    })
    expect(await h.service.resolve(h.tx, { productMode: 'CUSTOM', supplierValue: null }, true)).toMatchObject({ productMode: 'CUSTOM', matchSource: 'CUSTOM_RULE', ruleCode: 'CUSTOM_MARK', availability: 'AVAILABLE', activeConfig })
    expect(h.transaction.numberingRule.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { ruleCode: 'CUSTOM_MARK' } }))
    expect(h.lookup.requireEffectiveValue).not.toHaveBeenCalled()
    expect(h.transaction.supplierShippingMarkRuleBinding.findUnique).not.toHaveBeenCalled()
    expect(h.events).toEqual(['rule-lock', 'rule-read'])
    expect(h.transaction.$queryRaw.mock.calls).toEqual([[expect.objectContaining({ values: ['CUSTOM_MARK'] })]])
  })

  it('holds dictionary, binding and rule locks in that order inside the caller transaction', async () => {
    const h = harness()
    const locked = await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, true)
    expect(h.events).toEqual(['dictionary-lock', 'binding-lock', 'rule-lock', 'rule-read'])
    expect(h.transaction.$queryRaw.mock.calls.map(([query]: [{ text: string }]) => query.text)).toEqual([
      expect.stringMatching(/supplier_shipping_mark_rule_bindings[\s\S]*FOR SHARE/u),
      expect.stringMatching(/numbering_rules[\s\S]*FOR SHARE/u),
    ])
    expect(h.transaction.supplierShippingMarkRuleBinding.findUnique).not.toHaveBeenCalled()
    expect((await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, false)).resolutionToken).toBe(locked.resolutionToken)
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['RULE_MISSING', null, null],
    ['WRONG_PURPOSE', { ...validRule, purpose: 'BUSINESS' }, null],
    ['RULE_DISABLED', { ...validRule, status: 'DISABLED' }, activeConfig],
    ['NO_ACTIVE_VERSION', { ...validRule, versions: [] }, null],
  ])('reports %s with only the current shipping mark config and no usable resolution token', async (availability, rule, expectedConfig) => {
    const h = harness()
    h.transaction.numberingRule.findUnique.mockResolvedValueOnce(rule)
    expect(await h.service.resolve(h.tx, { productMode: 'CUSTOM' }, false)).toMatchObject({ availability, activeConfig: expectedConfig, resolutionToken: null, message: expect.any(String) as unknown })
  })

  it('reports unbound suppliers without a rule lookup', async () => {
    const h = harness()
    h.transaction.supplierShippingMarkRuleBinding.findUnique.mockResolvedValueOnce(null)
    expect(await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, false)).toMatchObject({ availability: 'UNBOUND', ruleId: null, ruleCode: null, activeRevision: null, activeConfig: null, resolutionToken: null })
    expect(h.transaction.numberingRule.findUnique).not.toHaveBeenCalled()
  })

  it.each([{ known: false }, { known: true, effectiveEnabled: false }])('stops at unknown or disabled supplier state %j', async supplier => {
    const h = harness()
    h.lookup.resolveStoredValueInTransaction.mockResolvedValueOnce(supplier)
    expect(await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, false)).toMatchObject({ availability: 'SUPPLIER_UNAVAILABLE', activeConfig: null, resolutionToken: null })
    expect(h.transaction.supplierShippingMarkRuleBinding.findUnique).not.toHaveBeenCalled()
    expect(h.transaction.numberingRule.findUnique).not.toHaveBeenCalled()
  })

  it('reports a supplier disabled during locked resolution without swallowing other failures', async () => {
    const h = harness()
    h.lookup.requireEffectiveValue.mockRejectedValueOnce(new DictionaryValueUnavailableError('DICTIONARY_ITEM_DISABLED'))
    expect(await h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, true)).toMatchObject({ availability: 'SUPPLIER_UNAVAILABLE', resolutionToken: null })
    expect(h.transaction.$queryRaw).not.toHaveBeenCalled()
    const failure = new Error('transaction-aborted')
    h.lookup.requireEffectiveValue.mockRejectedValueOnce(failure)
    await expect(h.service.resolve(h.tx, { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' }, true)).rejects.toBe(failure)
  })

  it('reads one consistent snapshot with fixed timeouts and maps persistence failures safely', async () => {
    const h = harness()
    expect(await h.service.read({ productMode: 'CUSTOM' })).toMatchObject({ availability: 'AVAILABLE' })
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    expect(h.transaction.$queryRaw).toHaveBeenCalledTimes(1)
    expect(h.transaction.$queryRaw.mock.calls).toEqual([[expect.objectContaining({ text: expect.stringContaining('set_config') as unknown })]])
    h.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' })
    await expect(h.service.read({ productMode: 'CUSTOM' })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
    h.prisma.$transaction.mockRejectedValueOnce(new Error('private-driver-diagnostic'))
    await expect(h.service.read({ productMode: 'CUSTOM' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: '服务器内部错误' })
  })

  it('does not return malformed published configuration as a usable summary', async () => {
    const h = harness()
    h.transaction.numberingRule.findUnique.mockResolvedValueOnce({ ...validRule, versions: [{ ...activeVersion, timezone: 'UTC' }] })
    await expect(h.service.read({ productMode: 'CUSTOM' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: '服务器内部错误' })
  })
})

describe('PurchaseOrderShippingMarkResolutionQueryDto', () => {
  it.each([{ productMode: 'CATALOG', supplierValue: 'supplier_a' }, { productMode: 'CUSTOM' }])('accepts a complete scene %j', async input => {
    expect(await validate(plainToInstance(PurchaseOrderShippingMarkResolutionQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).toEqual([])
  })

  it.each([
    {}, { productMode: 'MIXED' }, { productMode: 'CATALOG' },
    { productMode: 'CATALOG', supplierValue: null },
    { productMode: 'CATALOG', supplierValue: '供应商标签' },
    { productMode: 'CUSTOM', supplierValue: 'SUPPLIER_A' },
    { productMode: 'CUSTOM', supplierValue: null },
    { productMode: 'CUSTOM', customSupplierName: '任意名称' },
    { productMode: 'CUSTOM', ruleCode: 'OTHER_RULE' },
    { productMode: 'CUSTOM', ruleId },
  ])('rejects incomplete or caller-selected rule input %j', async input => {
    expect(await validate(plainToInstance(PurchaseOrderShippingMarkResolutionQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0)
  })
})
