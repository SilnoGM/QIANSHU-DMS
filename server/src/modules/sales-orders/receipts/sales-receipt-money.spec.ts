import { convertReceiptToCny, assertReceiptCapacity } from './sales-receipt-money'

describe('receipt money', () => {
  it('divides foreign units per CNY and rounds HALF_UP at cents', () => {
    expect(convertReceiptToCny('10000.0000', '4.800000000000')).toBe('2083.33')
    expect(convertReceiptToCny('0.0100', '2.000000000000')).toBe('0.01')
  })
  it('rejects rounded zero and decimal overflow', () => {
    expect(() => convertReceiptToCny('0.0001', '100.000000000000')).toThrow()
    expect(() => convertReceiptToCny('99999999999999999999999999.9999', '0.000000000001')).toThrow()
  })
  it('reserves pending receipts separately from confirmed payments', () => {
    expect(() => assertReceiptCapacity('100.0000', '40.0000', '50.0000', '10.0000')).not.toThrow()
    expect(() => assertReceiptCapacity('100.0000', '40.0000', '50.0000', '10.0001')).toThrow()
  })
})
