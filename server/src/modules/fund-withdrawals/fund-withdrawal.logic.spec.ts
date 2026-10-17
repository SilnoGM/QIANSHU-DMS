import {
  buildFundWithdrawalProofFilename,
  formatWithdrawalFilenameAmount,
  normalizeFundWithdrawalAmount,
  requireFundWithdrawalRequestKey,
} from './fund-withdrawal.logic'

describe('fund withdrawal logic', () => {
  it('normalizes positive two-decimal amounts and rejects invalid values', () => {
    expect(normalizeFundWithdrawalAmount('100')).toBe('100.00')
    expect(normalizeFundWithdrawalAmount('100.5')).toBe('100.50')
    expect(normalizeFundWithdrawalAmount(' 0.01 ')).toBe('0.01')
    for (const invalid of ['0', '0.00', '-1', '1.234', '1,000', 'abc']) {
      expect(() => normalizeFundWithdrawalAmount(invalid)).toThrow(RangeError)
    }
  })

  it('builds the agreed proof filename without changing the extension', () => {
    const fileName = buildFundWithdrawalProofFilename({
      amount: '100.00',
      displayName: '张三',
      extension: '.png',
      uploadedAt: new Date('2026-10-17T00:00:00.000Z'),
    })
    expect(fileName).toBe('张三-提款100元-20261017.png')
    expect(formatWithdrawalFilenameAmount('100.50')).toBe('100.5')
    expect(formatWithdrawalFilenameAmount('0.01')).toBe('0.01')
    expect(buildFundWithdrawalProofFilename({
      amount: '12.30',
      displayName: '张三/李四',
      extension: '.webp',
      uploadedAt: new Date('2026-10-17T00:00:00.000Z'),
    })).toBe('张三_李四-提款12.3元-20261017.webp')
  })

  it('requires a canonical UUID idempotency key', () => {
    expect(requireFundWithdrawalRequestKey('11111111-1111-4111-8111-111111111111'))
      .toBe('11111111-1111-4111-8111-111111111111')
    expect(() => requireFundWithdrawalRequestKey('not-a-uuid')).toThrow(RangeError)
  })
})
