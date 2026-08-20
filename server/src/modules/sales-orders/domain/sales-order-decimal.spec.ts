import {
  calculateSalesOrderLineTotal,
  deriveSalesOrderPaymentStatus,
  normalizeSalesOrderAmount,
  normalizeSalesOrderQuantity,
  validateSalesOrderAgreedAmounts,
} from './sales-order-decimal'

describe('sales order decimal rules', () => {
  it.each([
    ['0', '0.0000'],
    ['1.2', '1.2000'],
    ['99999999999999999999999999.9999', '99999999999999999999999999.9999'],
  ])('normalizes the non-negative amount %s', (input, expected) => {
    expect(normalizeSalesOrderAmount(input)).toBe(expected)
  })

  it.each([
    -1,
    1,
    1n,
    null,
    '',
    '00',
    '01',
    '+1',
    '-0',
    '-0.0000',
    '1.',
    '.1',
    '1.00000',
    '1e2',
    '100000000000000000000000000',
  ])('rejects an unsafe amount %p', (input) => {
    expect(() => normalizeSalesOrderAmount(input)).toThrow(
      expect.objectContaining({ code: 'SALES_ORDER_AMOUNT_INVALID' }),
    )
  })

  it('accepts only positive PostgreSQL integers for quantity', () => {
    expect(normalizeSalesOrderQuantity(1)).toBe(1)
    expect(normalizeSalesOrderQuantity(2_147_483_647)).toBe(2_147_483_647)

    for (const value of [0, -1, 1.2, 2_147_483_648, '1', null]) {
      expect(() => normalizeSalesOrderQuantity(value)).toThrow(
        expect.objectContaining({ code: 'SALES_ORDER_QUANTITY_INVALID' }),
      )
    }
  })

  it('calculates line totals without IEEE-754 arithmetic', () => {
    expect(calculateSalesOrderLineTotal('19.9900', 3)).toBe('59.9700')
    expect(calculateSalesOrderLineTotal('0.0001', 3)).toBe('0.0003')
  })

  it('hard-blocks both agreed amount equations', () => {
    expect(validateSalesOrderAgreedAmounts({
      lineSubtotalAmount: '100.0000',
      agreedTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '70',
    })).toEqual({
      lineSubtotalAmount: '100.0000',
      agreedTotalAmount: '100.0000',
      depositDueAmount: '30.0000',
      balanceDueAmount: '70.0000',
    })

    expect(() => validateSalesOrderAgreedAmounts({
      lineSubtotalAmount: '99',
      agreedTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '70',
    })).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_TOTAL_MISMATCH',
    }))
    expect(() => validateSalesOrderAgreedAmounts({
      lineSubtotalAmount: '100',
      agreedTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '69',
    })).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_PAYMENT_TERMS_MISMATCH',
    }))
  })

  it('derives payment status and rejects overpayment', () => {
    expect(deriveSalesOrderPaymentStatus('100', '0')).toBe('UNPAID')
    expect(deriveSalesOrderPaymentStatus('100', '0.0001'))
      .toBe('PARTIALLY_PAID')
    expect(deriveSalesOrderPaymentStatus('100', '100')).toBe('PAID')
    expect(() => deriveSalesOrderPaymentStatus('100', '100.0001')).toThrow(
      expect.objectContaining({ code: 'SALES_ORDER_PAYMENT_EXCEEDS_TOTAL' }),
    )
  })
})
