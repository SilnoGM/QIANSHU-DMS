import { effectiveOceanCodAmount, prepareOceanCodSource, readOceanCodSource } from './ocean-freight-cod-source'

describe('ocean freight COD source meaning', () => {
  it('does not silently reuse positive historical COD on an adjustment', () => {
    const result = prepareOceanCodSource('ADJUSTMENT', '1000', undefined)
    expect(result.codAmountTwd).toBeNull()
    expect(readOceanCodSource(result.sourceData, result.codAmountTwd, 'ADJUSTMENT')).toEqual({ codSourceTreatment: 'UNRESOLVED', reportedCodAmountTwd: '1000.00' })
  })
  it('keeps an explicit current amount or excludes an explicitly historical reference', () => {
    expect(prepareOceanCodSource('ADJUSTMENT', '1000', 'CURRENT').codAmountTwd).toBe('1000.00')
    const reference = prepareOceanCodSource('ADJUSTMENT', '1000', 'HISTORICAL_REFERENCE')
    expect(reference.codAmountTwd).toBe('0.00')
    expect(readOceanCodSource(reference.sourceData, reference.codAmountTwd, 'ADJUSTMENT')).toEqual({ codSourceTreatment: 'HISTORICAL_REFERENCE', reportedCodAmountTwd: '1000.00' })
  })
  it('distinguishes explicitly entered zero from absent COD', () => {
    expect(prepareOceanCodSource('ADJUSTMENT', '0', undefined).codAmountTwd).toBe('0.00')
    expect(prepareOceanCodSource('ADJUSTMENT', null, undefined).codAmountTwd).toBeNull()
    expect(prepareOceanCodSource('NORMAL', '23.5', undefined).codAmountTwd).toBe('23.50')
  })
  it('rejects impossible decisions without mutating source evidence', () => {
    expect(() => prepareOceanCodSource('NORMAL', '1', 'HISTORICAL_REFERENCE')).toThrow()
    expect(() => prepareOceanCodSource('ADJUSTMENT', null, 'CURRENT')).toThrow()
    expect(() => prepareOceanCodSource('ADJUSTMENT', null, 'HISTORICAL_REFERENCE')).toThrow()
    expect(() => prepareOceanCodSource('ADJUSTMENT', '1', 'invalid')).toThrow()
  })
  it('excludes historical references even when a legacy persisted amount is stale', () => {
    expect(effectiveOceanCodAmount({ oceanFreightCod: { version: 1, meaning: 'HISTORICAL_REFERENCE', reportedAmountTwd: '1000.00' } }, '1000.00', 'ADJUSTMENT')).toBe('0.00')
    expect(effectiveOceanCodAmount(null, '1000.00', 'ADJUSTMENT')).toBeNull()
  })
})
