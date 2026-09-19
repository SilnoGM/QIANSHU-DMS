import { normalizeBill, normalizeBillLine, parseCreationKey, fingerprint } from './ocean-freight-bill.normalizer'

describe('ocean freight bill normalization', () => {
  it('normalizes decimals and optional blanks before fingerprinting', () => {
    expect(fingerprint(normalizeBill({ billName: ' January ', twdPerCny: '4.800', remark: '' })))
      .toBe(fingerprint(normalizeBill({ billName: 'January', twdPerCny: '4.8' })))
  })
  it.each(['0', '-1', '4.1234567890123', '1e3'])('rejects invalid rate %s', twdPerCny => {
    expect(() => normalizeBill({ billName: 'Bill', twdPerCny })).toThrow()
  })
  it('rejects impossible dates instead of rolling forward', () => {
    expect(() => normalizeBill({ billName: 'Bill', twdPerCny: '4.8', billDate: '2026-02-30' })).toThrow()
  })
  it('does not accept client supplied reconciliation state or computed amounts', () => {
    expect(() => normalizeBillLine({ lineType: 'NORMAL', goodsName: 'Machine', packageCount: 1, reconciliationStatus: 'CONFIRMED' } as never)).toThrow()
    expect(() => normalizeBill({ billName: 'Bill', twdPerCny: '4.8', payableAmountCny: '100' } as never)).toThrow()
  })
  it('preserves incomplete packaging until later reconciliation', () => {
    expect(normalizeBillLine({ lineType: 'NORMAL', goodsName: 'Machine' }).packageCount).toBeNull()
    expect(normalizeBillLine({ lineType: 'ADJUSTMENT', goodsName: 'Delivery adjustment' }).packageCount).toBeNull()
  })
  it('preserves zero separately from absent COD and never copies related amounts', () => {
    expect(normalizeBillLine({ lineType: 'ADJUSTMENT', goodsName: 'Fee' }).codAmountTwd).toBeNull()
    expect(normalizeBillLine({ lineType: 'ADJUSTMENT', goodsName: 'Fee', codAmountTwd: '0' }).codAmountTwd).toBe('0')
  })
  it('rejects unpersistable control characters before a database write', () => {
    expect(() => normalizeBill({ billName: 'Bill', twdPerCny: '4.8', remark: 'A\u0000B' })).toThrow()
    expect(() => normalizeBillLine({ lineType: 'NORMAL', goodsName: 'A\u0001B' })).toThrow()
  })
  it.each(['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm'])('rejects zero %s rather than failing database constraints', field => {
    expect(() => normalizeBillLine({ lineType: 'NORMAL', goodsName: 'Machine', [field]: '0' })).toThrow()
  })
  it('requires UUID request keys', () => { expect(() => parseCreationKey('')).toThrow() })
})
