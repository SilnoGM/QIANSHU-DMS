import {
  assertCustomPurchasePrices,
  calculatePurchaseOrderLineTotal,
  derivePurchaseOrderPaymentStatus,
  normalizePositivePurchaseOrderAmount,
  normalizePurchaseOrderAmount,
  normalizePurchaseOrderQuantity,
  normalizePurchaseOrderSnapshotAmount,
  normalizePurchaseOrderReferenceAmount,
  parsePurchaseOrderAmountUnits,
  validatePurchaseOrderAgreedAmounts,
} from './purchase-order-decimal'

describe('purchase order decimal rules', () => {
  it.each([
    ['0', '0.00'],
    ['1.2', '1.20'],
    ['99999999999999999999999999.99', '99999999999999999999999999.99'],
  ])('normalizes the user amount %s', (input, expected) => {
    expect(normalizePurchaseOrderAmount(input)).toBe(expected)
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
    '1.',
    '.1',
    '1.001',
    '1e2',
    '100000000000000000000000000',
  ])('rejects unsafe or over-precision user amount %p', (input) => {
    expect(() => normalizePurchaseOrderAmount(input)).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_AMOUNT_INVALID' }),
    )
  })

  it('preserves four-decimal archived image snapshot normalization', () => {
    expect(normalizePurchaseOrderSnapshotAmount('1.2345')).toBe('1.2345')
    expect(() => normalizePurchaseOrderSnapshotAmount('1.23456')).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_AMOUNT_INVALID' }),
    )
  })

  it('rounds new catalog reference snapshots to cents while keeping historical snapshot normalization stable', () => {
    expect(normalizePurchaseOrderReferenceAmount('1.2345')).toBe('1.23')
    expect(normalizePurchaseOrderReferenceAmount('1.2350')).toBe('1.24')
    expect(normalizePurchaseOrderReferenceAmount('9007199254740993.9950')).toBe('9007199254740994.00')
    expect(normalizePurchaseOrderSnapshotAmount('1.2350')).toBe('1.2350')
  })

  it('uses cents and rejects nonzero sub-cent operational amounts without rounding', () => {
    expect(parsePurchaseOrderAmountUnits('12.34')).toBe(1234n)
    expect(parsePurchaseOrderAmountUnits('12.3400')).toBe(1234n)
    expect(() => parsePurchaseOrderAmountUnits('12.3450')).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_AMOUNT_INVALID' }))
  })

  it('accepts only positive PostgreSQL integers for quantity', () => {
    expect(normalizePurchaseOrderQuantity(1)).toBe(1)
    expect(normalizePurchaseOrderQuantity(2_147_483_647)).toBe(2_147_483_647)

    for (const value of [0, -1, 1.2, 2_147_483_648, '1', null]) {
      expect(() => normalizePurchaseOrderQuantity(value)).toThrow(
        expect.objectContaining({ code: 'PURCHASE_ORDER_QUANTITY_INVALID' }),
      )
    }
  })

  it('calculates line totals without IEEE-754 arithmetic', () => {
    expect(calculatePurchaseOrderLineTotal('19.9900', 3)).toBe('59.97')
    expect(calculatePurchaseOrderLineTotal('0.01', 3)).toBe('0.03')
    expect(() => calculatePurchaseOrderLineTotal('0.0001', 3)).toThrow()
  })

  it('hard-blocks both purchase amount equations', () => {
    expect(validatePurchaseOrderAgreedAmounts({
      lineSubtotalAmount: '100.0000',
      purchaseTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '70',
    })).toEqual({
      lineSubtotalAmount: '100.00',
      purchaseTotalAmount: '100.00',
      depositDueAmount: '30.00',
      balanceDueAmount: '70.00',
    })

    expect(() => validatePurchaseOrderAgreedAmounts({
      lineSubtotalAmount: '99',
      purchaseTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '70',
    })).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_TOTAL_MISMATCH' }))
    expect(() => validatePurchaseOrderAgreedAmounts({
      lineSubtotalAmount: '100',
      purchaseTotalAmount: '100',
      depositDueAmount: '30',
      balanceDueAmount: '69',
    })).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_PAYMENT_TERMS_MISMATCH',
    }))
  })

  it('requires both CUSTOM prices to be user-entered and equal', () => {
    expect(assertCustomPurchasePrices('12.3', '12.30')).toEqual({
      referencePurchaseUnitPriceAmount: '12.30',
      actualPurchaseUnitPriceAmount: '12.30',
    })
    for (const prices of [[undefined, '1'], ['1', undefined], ['1', '1.01']]) {
      expect(() => assertCustomPurchasePrices(prices[0], prices[1])).toThrow(
        expect.objectContaining({ code: 'PURCHASE_ORDER_CUSTOM_PRICES_INVALID' }),
      )
    }
  })

  it('derives payment status, including zero-value orders, and rejects overpayment', () => {
    expect(derivePurchaseOrderPaymentStatus('0', '0')).toBe('PAID')
    expect(derivePurchaseOrderPaymentStatus('100', '0')).toBe('UNPAID')
    expect(derivePurchaseOrderPaymentStatus('100', '0.01')).toBe('PARTIALLY_PAID')
    expect(derivePurchaseOrderPaymentStatus('100', '100')).toBe('PAID')
    expect(() => derivePurchaseOrderPaymentStatus('100', '100.01')).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_PAYMENT_EXCEEDS_TOTAL' }),
    )
  })

  it('requires an actual payment amount greater than zero', () => {
    expect(normalizePositivePurchaseOrderAmount('0.01')).toBe('0.01')
    expect(() => normalizePositivePurchaseOrderAmount('0')).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_PAYMENT_AMOUNT_INVALID' }),
    )
  })
})
