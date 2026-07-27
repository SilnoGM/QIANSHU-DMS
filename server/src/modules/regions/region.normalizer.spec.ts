import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeNullableRegionText,
  normalizeOptionalRegionText,
  normalizeRegionCode,
  normalizeRegionName,
  normalizeRegionSearchText,
} from './region.normalizer'

function expectValidationFailure(
  action: () => unknown,
  field: string,
): void {
  let thrown: unknown

  try {
    action()
  }
  catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).getStatus()).toBe(422)
  expect((thrown as ApiException).code).toBe('VALIDATION_FAILED')
  expect((thrown as ApiException).fieldErrors).toHaveProperty(field)
}

describe('Region normalizer', () => {
  it('applies NFC, trims and folds all Unicode whitespace deterministically', () => {
    expect(normalizeRegionName(' \tCafe\u0301\u3000  上海 \n')).toEqual({
      name: 'Café 上海',
      normalizedName: 'café 上海',
    })
    expect(normalizeNullableRegionText(
      '\u00a0 Kuala\t  Lumpur \u3000',
      'englishName',
    )).toBe('Kuala Lumpur')
  })

  it('uses the fixed en-US lower-case key for composed and dotted Latin text', () => {
    expect(normalizeRegionName('É').normalizedName).toBe(
      normalizeRegionName('E\u0301').normalizedName,
    )
    expect(normalizeRegionName('İ').normalizedName).toBe('i\u0307')
    expect(normalizeRegionName('i\u0307').normalizedName).toBe('i\u0307')
    expect(normalizeRegionSearchText('  İSTANBUL  ')).toBe('i\u0307stanbul')
  })

  it('normalizes technical codes to uppercase before enforcing the final pattern', () => {
    expect(normalizeRegionCode(' tw-64000 ')).toBe('TW-64000')
    expect(normalizeRegionCode('my.14_01')).toBe('MY.14_01')

    for (const invalid of ['X', ' A/B ', 'TW 高雄', '']) {
      expectValidationFailure(() => normalizeRegionCode(invalid), 'code')
    }
  })

  it('uses Unicode code points and rechecks keys that expand during lowercase', () => {
    expect(normalizeRegionName('😀'.repeat(128)).name).toBe('😀'.repeat(128))
    expectValidationFailure(
      () => normalizeRegionName('😀'.repeat(129)),
      'name',
    )
    expectValidationFailure(
      () => normalizeRegionName('İ'.repeat(128)),
      'name',
    )
  })

  it('maps optional normalized-empty values to null while preserving PATCH omission', () => {
    expect(normalizeNullableRegionText(undefined, 'englishName')).toBeNull()
    expect(normalizeNullableRegionText(null, 'englishName')).toBeNull()
    expect(normalizeNullableRegionText(' \t\u3000', 'englishName')).toBeNull()
    expect(normalizeOptionalRegionText(undefined, 'englishName')).toBeUndefined()
    expect(normalizeOptionalRegionText(null, 'englishName')).toBeNull()
    expect(normalizeOptionalRegionText(' \n ', 'englishName')).toBeNull()
    expect(normalizeOptionalRegionText(' Penang ', 'englishName')).toBe(
      'Penang',
    )
  })

  it('rejects required values that normalize to empty without exposing input', () => {
    expectValidationFailure(() => normalizeRegionName(' \t\u3000'), 'name')
    expectValidationFailure(
      () => normalizeRegionSearchText('\n\u3000'),
      'query',
    )
  })
})
