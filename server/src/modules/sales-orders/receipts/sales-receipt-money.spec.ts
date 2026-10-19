import { convertReceiptToCny, assertReceiptCapacity } from './sales-receipt-money'

describe('receipt money', () => {
  it('divides foreign units per CNY and rounds HALF_UP at cents', () => {
    expect(convertReceiptToCny('10000.00', '4.8000')).toBe('2083.33')
    expect(convertReceiptToCny('0.01', '2.0000')).toBe('0.01')
  })
  it('rejects rounded zero and decimal overflow', () => {
    expect(() => convertReceiptToCny('0.01', '100.0000')).toThrow()
    expect(() => convertReceiptToCny('99999999999999999999999999.99', '0.0001')).toThrow()
  })
  it('reserves pending receipts separately from confirmed payments', () => {
    expect(() => assertReceiptCapacity('100.00', '40.00', '50.00', '10.00')).not.toThrow()
    expect(() => assertReceiptCapacity('100.00', '40.00', '50.00', '10.01')).toThrow()
  })
})
