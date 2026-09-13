import { normalizeReceiptReason } from './sales-receipt-normalizer'

describe('receipt reason normalization', () => {
  it('rejects Unicode expansion beyond the persisted limit', () => {
    expect(() => normalizeReceiptReason('㍿'.repeat(126))).toThrow()
  })
  it('normalizes whitespace without manufacturing a reason', () => {
    expect(normalizeReceiptReason('  ')).toBeNull()
    expect(normalizeReceiptReason('  修正金额  ')).toBe('修正金额')
  })
})
