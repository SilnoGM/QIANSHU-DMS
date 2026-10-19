import { ApiException } from '../../infrastructure/http/api.exception'
import { normalizeForeignUnitsPerCny } from './exchange-rate.normalizer'

function expectValidationFailure(value: unknown): void {
  let thrown: unknown

  try {
    normalizeForeignUnitsPerCny(value)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect((thrown as ApiException).code).toBe('VALIDATION_FAILED')
  expect((thrown as ApiException).fieldErrors)
    .toHaveProperty('foreignUnitsPerCny')
}

describe('exchange rate normalizer', () => {
  it('returns canonical positive decimal strings without using number', () => {
    expect(normalizeForeignUnitsPerCny('4.8')).toBe('4.8')
    expect(normalizeForeignUnitsPerCny('4.8000')).toBe('4.8')
    expect(normalizeForeignUnitsPerCny('0.0001'))
      .toBe('0.0001')
    expect(normalizeForeignUnitsPerCny('999999999999999999.1234'))
      .toBe('999999999999999999.1234')
  })

  it('rejects zero, number, scientific notation and non-canonical syntax', () => {
    for (const value of [
      '0',
      '0.000',
      4.8,
      '-4.8',
      '+4.8',
      '.8',
      '4.',
      '04.8',
      '4,8',
      '4e-1',
      ' 4.8 ',
      '',
    ]) {
      expectValidationFailure(value)
    }
  })

  it('rejects more than 18 integer or 4 fractional digits', () => {
    expectValidationFailure('1000000000000000000')
    expectValidationFailure('1.12345')
  })
})
