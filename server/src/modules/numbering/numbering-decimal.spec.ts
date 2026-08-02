import {
  isCanonicalNonNegativeDecimalString,
  toDecimalString,
  toNullableDecimalString,
} from './numbering-decimal'

describe('numbering decimal-string boundary', () => {
  it('keeps arbitrary precision values outside JavaScript number', () => {
    expect(toDecimalString(9_007_199_254_740_993n))
      .toBe('9007199254740993')
    expect(toDecimalString('999999999999999999999999999999999999'))
      .toBe('999999999999999999999999999999999999')
  })

  it('accepts only canonical non-negative decimal strings or bigint values', () => {
    for (const value of ['0', '1', '999999999999999999']) {
      expect(isCanonicalNonNegativeDecimalString(value)).toBe(true)
      expect(toDecimalString(value)).toBe(value)
    }

    for (const value of ['', '00', '01', '-1', '+1', '1.0', 1, -1n, null]) {
      expect(isCanonicalNonNegativeDecimalString(value)).toBe(false)
      expect(() => toDecimalString(value)).toThrow('规范的非负十进制值')
    }
  })

  it('preserves null only through the explicit nullable boundary', () => {
    expect(toNullableDecimalString(null)).toBeNull()
    expect(toNullableDecimalString(42n)).toBe('42')
    expect(() => toNullableDecimalString(undefined)).toThrow()
  })
})
