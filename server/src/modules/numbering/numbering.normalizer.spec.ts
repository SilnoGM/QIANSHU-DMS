import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeNumberingKeyword,
  normalizeNumberingRuleCode,
  normalizeNumberingRuleDescription,
  normalizeNumberingRuleName,
  normalizeOptionalNumberingRuleDescription,
} from './numbering.normalizer'

function expectValidationFailure(
  action: () => unknown,
  field: string,
): void {
  let thrown: unknown

  try {
    action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).code).toBe('VALIDATION_FAILED')
  expect((thrown as ApiException).fieldErrors).toHaveProperty(field)
}

describe('numbering management normalizer', () => {
  it('normalizes rule code with NFC, collapsed whitespace and uppercase', () => {
    expect(normalizeNumberingRuleCode('  sales_order  ')).toBe('SALES_ORDER')

    for (const value of [
      '',
      'sales\torder',
      '1_ORDER',
      '订单',
      'ß_RULE',
      'ı_RULE',
      'A-B',
      'A'.repeat(65),
      123,
    ]) {
      expectValidationFailure(() => normalizeNumberingRuleCode(value), 'ruleCode')
    }
  })

  it('normalizes names by Unicode NFC, whitespace folding and code points', () => {
    expect(normalizeNumberingRuleName('  Re\u0301al　订单\t编号  '))
      .toBe('Réal 订单 编号')
    expect([...normalizeNumberingRuleName('😀'.repeat(128))]).toHaveLength(128)

    expectValidationFailure(() => normalizeNumberingRuleName('　\t '), 'name')
    expectValidationFailure(
      () => normalizeNumberingRuleName('😀'.repeat(129)),
      'name',
    )
  })

  it('distinguishes omitted description from explicit clearing', () => {
    expect(normalizeNumberingRuleDescription(undefined)).toBeNull()
    expect(normalizeNumberingRuleDescription(null)).toBeNull()
    expect(normalizeNumberingRuleDescription('　\t ')).toBeNull()
    expect(normalizeNumberingRuleDescription('  一段   说明  ')).toBe('一段 说明')
    expect(normalizeOptionalNumberingRuleDescription(undefined)).toBeUndefined()
    expect(normalizeOptionalNumberingRuleDescription(null)).toBeNull()

    expectValidationFailure(
      () => normalizeNumberingRuleDescription('D'.repeat(501)),
      'description',
    )
  })

  it('normalizes optional list keyword without adding hidden case semantics', () => {
    expect(normalizeNumberingKeyword(undefined)).toBeUndefined()
    expect(normalizeNumberingKeyword('  Re\u0301al　Order  ')).toBe('Réal Order')

    expectValidationFailure(() => normalizeNumberingKeyword('　 '), 'keyword')
    expectValidationFailure(
      () => normalizeNumberingKeyword('K'.repeat(129)),
      'keyword',
    )
  })
})
