import {
  normalizeFundAmount,
  normalizeFundShareRate,
  normalizePositiveFundAmount,
  splitFundAmountByShare,
} from './fund-decimal'

describe('fund decimal calculation boundary', () => {
  it.each([
    ['0', '0.00'],
    ['1', '1.00'],
    ['-1.2', '-1.20'],
    ['1.23', '1.23'],
    [
      '99999999999999999999999999.99',
      '99999999999999999999999999.99',
    ],
  ])('normalizes the exact decimal string %s', (input, expected) => {
    expect(normalizeFundAmount(input)).toBe(expected)
  })

  it.each([
    '',
    ' ',
    '00',
    '01',
    '-01',
    '+1',
    '.1',
    '1.',
    '1.001',
    '1e2',
    '-0',
    '-0.00',
    '100000000000000000000000000',
    1,
    1n,
    null,
    undefined,
  ])('rejects a non-canonical or unsafe amount %p', (input) => {
    expect(() => normalizeFundAmount(input)).toThrow('资金金额格式无效')
  })

  it('accepts only non-zero positive values at the positive boundary', () => {
    expect(normalizePositiveFundAmount('0.01')).toBe('0.01')
    expect(() => normalizePositiveFundAmount('0')).toThrow('资金金额必须大于零')
    expect(() => normalizePositiveFundAmount('-1')).toThrow('资金金额必须大于零')
  })

  it.each([
    ['0', '0.00'],
    ['30', '30.00'],
    ['33.33', '33.33'],
    ['100', '100.00'],
  ])('normalizes the share rate %s', (input, expected) => {
    expect(normalizeFundShareRate(input)).toBe(expected)
  })

  it.each([
    '-0.01',
    '30.001',
    '100.01',
    '101',
    '1.001',
    '01',
    30,
  ])('rejects the invalid share rate %p', (input) => {
    expect(() => normalizeFundShareRate(input)).toThrow('资金分成比例无效')
  })

  it('splits by ROUND_HALF_UP and gives the remainder to the company', () => {
    expect(splitFundAmountByShare('100', '30')).toEqual({
      userAmount: '30.00',
      companyAmount: '70.00',
    })
    expect(splitFundAmountByShare('0.01', '50')).toEqual({
      userAmount: '0.01',
      companyAmount: '0.00',
    })
    expect(splitFundAmountByShare('0.01', '49.99')).toEqual({
      userAmount: '0.00',
      companyAmount: '0.01',
    })
  })

  it('preserves exact values beyond the JavaScript safe integer range', () => {
    expect(
      splitFundAmountByShare(
        '99999999999999999999999999.99',
        '33.33',
      ),
    ).toEqual({
      userAmount: '33330000000000000000000000.00',
      companyAmount: '66669999999999999999999999.99',
    })
  })
})
