import {
  normalizeFundAmount,
  normalizeFundShareRate,
  normalizePositiveFundAmount,
  splitFundAmountByShare,
} from './fund-decimal'

describe('fund decimal calculation boundary', () => {
  it.each([
    ['0', '0.0000'],
    ['1', '1.0000'],
    ['-1.2', '-1.2000'],
    ['1.2345', '1.2345'],
    [
      '99999999999999999999999999.9999',
      '99999999999999999999999999.9999',
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
    '1.00000',
    '1e2',
    '-0',
    '-0.0000',
    '100000000000000000000000000',
    1,
    1n,
    null,
    undefined,
  ])('rejects a non-canonical or unsafe amount %p', (input) => {
    expect(() => normalizeFundAmount(input)).toThrow('资金金额格式无效')
  })

  it('accepts only non-zero positive values at the positive boundary', () => {
    expect(normalizePositiveFundAmount('0.0001')).toBe('0.0001')
    expect(() => normalizePositiveFundAmount('0')).toThrow('资金金额必须大于零')
    expect(() => normalizePositiveFundAmount('-1')).toThrow('资金金额必须大于零')
  })

  it.each([
    ['0', '0.0000'],
    ['30', '30.0000'],
    ['33.3333', '33.3333'],
    ['100', '100.0000'],
  ])('normalizes the share rate %s', (input, expected) => {
    expect(normalizeFundShareRate(input)).toBe(expected)
  })

  it.each([
    '-0.0001',
    '100.0001',
    '101',
    '1.00000',
    '01',
    30,
  ])('rejects the invalid share rate %p', (input) => {
    expect(() => normalizeFundShareRate(input)).toThrow('资金分成比例无效')
  })

  it('splits by ROUND_HALF_UP and gives the remainder to the company', () => {
    expect(splitFundAmountByShare('100', '30')).toEqual({
      userAmount: '30.0000',
      companyAmount: '70.0000',
    })
    expect(splitFundAmountByShare('0.0001', '50')).toEqual({
      userAmount: '0.0001',
      companyAmount: '0.0000',
    })
    expect(splitFundAmountByShare('0.0001', '49.9999')).toEqual({
      userAmount: '0.0000',
      companyAmount: '0.0001',
    })
  })

  it('preserves exact values beyond the JavaScript safe integer range', () => {
    expect(
      splitFundAmountByShare(
        '99999999999999999999999999.9999',
        '33.3333',
      ),
    ).toEqual({
      userAmount: '33333300000000000000000000.0000',
      companyAmount: '66666699999999999999999999.9999',
    })
  })
})
