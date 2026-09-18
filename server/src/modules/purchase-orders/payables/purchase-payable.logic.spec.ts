import { resolvePayableOwner, summarizePayable } from './purchase-payable.logic'

describe('purchase payable rules', () => {
  it('uses the sales issuer, while stock always belongs to the company', () => {
    expect(resolvePayableOwner('SALES_LINKED', 'issuer')).toEqual({ accountOwnerType: 'USER', ownerUserId: 'issuer' })
    expect(resolvePayableOwner('STOCK', null)).toEqual({ accountOwnerType: 'COMPANY', ownerUserId: null })
    expect(() => resolvePayableOwner('SALES_LINKED', null)).toThrow()
  })
  it('calculates remaining amounts exactly and never creates a zero payment', () => {
    expect(summarizePayable('100.01', ['30.00', '0.01'], false)).toEqual({ paidAmount: '30.01', remainingAmount: '70.00', status: 'PENDING_PAYMENT' })
    expect(summarizePayable('0.00', [], false).status).toBe('NO_PAYMENT')
    expect(summarizePayable('100.01', ['100.01'], false).status).toBe('PAID')
    expect(summarizePayable('100.01', [], true).status).toBe('CANCELLED')
  })
  it('rejects overpayment and fractional cents instead of hiding discrepancies', () => {
    expect(() => summarizePayable('100.00', ['100.01'], false)).toThrow()
    expect(() => summarizePayable('1.001', [], false)).toThrow()
  })
})
