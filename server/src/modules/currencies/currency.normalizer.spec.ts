import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeCurrencyCode,
  normalizeCurrencyName,
  normalizeNullableCurrencyText,
  normalizeOptionalCurrencyText,
  normalizeOptionalCurrencySymbol,
} from './currency.normalizer'

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

describe('currency normalizer', () => {
  it('normalizes three-letter codes without accepting surrounding whitespace', () => {
    expect(normalizeCurrencyCode('twd')).toBe('TWD')
    expect(normalizeCurrencyCode('USD')).toBe('USD')

    for (const value of [' TW', 'TWD ', 'CN', 'USDT', '台币', 123]) {
      expectValidationFailure(() => normalizeCurrencyCode(value), 'code')
    }
  })

  it('normalizes display names with NFC and collapsed Unicode whitespace', () => {
    expect(normalizeCurrencyName('  新　台\t币  ')).toBe('新 台 币')
    expect(normalizeCurrencyName('Re\u0301al')).toBe('Réal')
    expect([...normalizeCurrencyName('😀'.repeat(128))]).toHaveLength(128)

    expectValidationFailure(() => normalizeCurrencyName('　\t '), 'name')
    expectValidationFailure(
      () => normalizeCurrencyName('😀'.repeat(129)),
      'name',
    )
  })

  it('normalizes nullable and optional text without confusing omission and clear', () => {
    expect(normalizeNullableCurrencyText(undefined, 'englishName', 128))
      .toBeNull()
    expect(normalizeNullableCurrencyText('  ', 'englishName', 128))
      .toBeNull()
    expect(normalizeOptionalCurrencyText(undefined, 'englishName', 128))
      .toBeUndefined()
    expect(normalizeOptionalCurrencyText(null, 'englishName', 128))
      .toBeNull()
    expect(normalizeOptionalCurrencyText(' US   Dollar ', 'englishName', 128))
      .toBe('US Dollar')
    expect(normalizeOptionalCurrencySymbol(' NT$ ')).toBe('NT$')
    expect(normalizeOptionalCurrencySymbol('  ')).toBeNull()

    expectValidationFailure(
      () => normalizeOptionalCurrencySymbol('S'.repeat(17)),
      'symbol',
    )
  })
})
