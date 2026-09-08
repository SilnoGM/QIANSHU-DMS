import {
  normalizePurchaseOrderDate,
  normalizePurchaseOrderShippingMark,
  validatePurchaseOrderLineShape,
} from './purchase-order-rules'

describe('purchase order general rules', () => {
  it('normalizes blank shipping marks and preserves trimmed multiline text', () => {
    expect(normalizePurchaseOrderShippingMark(undefined)).toBeNull()
    expect(normalizePurchaseOrderShippingMark(' \n\t ')).toBeNull()
    expect(normalizePurchaseOrderShippingMark('  BOX A\nBOX B  ')).toBe('BOX A\nBOX B')
  })

  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(normalizePurchaseOrderShippingMark('😀'.repeat(2_000)))
      .toBe('😀'.repeat(2_000))
    expect(() => normalizePurchaseOrderShippingMark('😀'.repeat(2_001))).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_SHIPPING_MARK_INVALID' }),
    )
  })

  it('accepts a valid current/past order date and rejects future or invalid dates', () => {
    expect(normalizePurchaseOrderDate('2026-08-27', '2026-08-27')).toBe('2026-08-27')
    expect(normalizePurchaseOrderDate('2024-02-29', '2026-08-27')).toBe('2024-02-29')
    for (const value of ['2026-08-28', '2026-02-29', '2026-8-27', new Date()]) {
      expect(() => normalizePurchaseOrderDate(value, '2026-08-27')).toThrow(
        expect.objectContaining({ code: 'PURCHASE_ORDER_DATE_INVALID' }),
      )
    }
  })

  it('requires a source line only for SALES_LINKED lines', () => {
    expect(validatePurchaseOrderLineShape({
      purchaseType: 'SALES_LINKED',
      lineType: 'CATALOG',
      productId: 'product-id',
      productNoSnapshot: 'P-001',
      sourceSalesOrderLineId: 'sales-line-id',
    })).toEqual({
      productId: 'product-id',
      productNoSnapshot: 'P-001',
      sourceSalesOrderLineId: 'sales-line-id',
    })
    expect(validatePurchaseOrderLineShape({
      purchaseType: 'STOCK',
      lineType: 'CUSTOM',
      productId: null,
      productNoSnapshot: null,
      sourceSalesOrderLineId: null,
    })).toEqual({
      productId: null,
      productNoSnapshot: null,
      sourceSalesOrderLineId: null,
    })
  })

  it.each([
    { purchaseType: 'SALES_LINKED', lineType: 'CATALOG', productId: 'p', productNoSnapshot: 'P', sourceSalesOrderLineId: null },
    { purchaseType: 'STOCK', lineType: 'CATALOG', productId: 'p', productNoSnapshot: 'P', sourceSalesOrderLineId: 'line' },
    { purchaseType: 'STOCK', lineType: 'CATALOG', productId: null, productNoSnapshot: 'P', sourceSalesOrderLineId: null },
    { purchaseType: 'STOCK', lineType: 'CUSTOM', productId: 'p', productNoSnapshot: null, sourceSalesOrderLineId: null },
    { purchaseType: 'STOCK', lineType: 'CUSTOM', productId: null, productNoSnapshot: 'P', sourceSalesOrderLineId: null },
  ] as const)('rejects invalid line identity shape %#', input => {
    expect(() => validatePurchaseOrderLineShape(input)).toThrow(
      expect.objectContaining({ code: 'PURCHASE_ORDER_LINE_SHAPE_INVALID' }),
    )
  })
})
