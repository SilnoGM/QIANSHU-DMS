import { normalizePriceQuotationSheetRequest } from './price-quotation-sheet.normalizer'

const TODAY = '2026-11-22'

function catalogLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lineType: 'CATALOG',
    productId: '11111111-1111-4111-8111-111111111111',
    expectedReferencePurchaseUnitPriceAmount: '9300',
    actualPurchaseUnitPriceAmount: '9300',
    quantity: 2,
    description: '  请附带说明书  ',
    ...overrides,
  }
}

function customLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lineType: 'CUSTOM',
    name: '  定制托盘  ',
    referencePurchaseUnitPriceAmount: '1200',
    actualPurchaseUnitPriceAmount: '1200.00',
    quantity: 3,
    description: null,
    ...overrides,
  }
}

function catalogRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productMode: 'CATALOG',
    supplierValue: '  supplier-a  ',
    orderDate: '2026-11-21',
    lines: [catalogLine()],
    ...overrides,
  }
}

function customRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productMode: 'CUSTOM',
    customSupplierName: '  张三加工厂  ',
    orderDate: '2026-11-21',
    lines: [customLine()],
    ...overrides,
  }
}

describe('normalizePriceQuotationSheetRequest', () => {
  it('normalizes a catalog request and computes line totals from the actual price', () => {
    const command = normalizePriceQuotationSheetRequest(catalogRequest(), TODAY)

    expect(command).toMatchObject({
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER-A',
      customSupplierName: null,
      orderDate: '2026-11-21',
    })
    expect(command.lines).toEqual([{
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: '11111111-1111-4111-8111-111111111111',
      name: null,
      expectedReferencePurchaseUnitPriceAmount: '9300.00',
      referencePurchaseUnitPriceAmount: null,
      actualPurchaseUnitPriceAmount: '9300.00',
      quantity: 2,
      lineTotalAmount: '18600.00',
      description: '请附带说明书',
    }])
  })

  it('normalizes a custom request and accepts reference/actual written differently', () => {
    const command = normalizePriceQuotationSheetRequest(customRequest(), TODAY)

    expect(command).toMatchObject({
      productMode: 'CUSTOM',
      supplierValue: null,
      customSupplierName: '张三加工厂',
    })
    expect(command.lines[0]).toMatchObject({
      lineNumber: 1,
      lineType: 'CUSTOM',
      productId: null,
      name: '定制托盘',
      referencePurchaseUnitPriceAmount: '1200.00',
      actualPurchaseUnitPriceAmount: '1200.00',
      quantity: 3,
      lineTotalAmount: '3600.00',
      description: null,
    })
  })

  it('rejects malformed envelopes and future dates', () => {
    expect(() => normalizePriceQuotationSheetRequest(null, TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePriceQuotationSheetRequest([], TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ productMode: 'MIXED' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_PRODUCT_MODE_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ orderDate: '2026-11-23' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_DATE_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ orderDate: '2026-02-31' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_DATE_INVALID' }))
  })

  it('rejects supplier sources that do not match the product mode', () => {
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ customSupplierName: '张三' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(customRequest({ supplierValue: 'SUPPLIER-A' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ supplierValue: '   ' }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePriceQuotationSheetRequest(customRequest({ customSupplierName: '   ' }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID' }))
  })

  it('rejects line modes, product identities, quantities and prices that cannot be rendered', () => {
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [customLine()] }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_LINE_MODE_MISMATCH' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ productId: undefined })] }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ expectedReferencePurchaseUnitPriceAmount: undefined })] }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ quantity: 0 })] }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_QUANTITY_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ actualPurchaseUnitPriceAmount: '1.234' })] }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_AMOUNT_INVALID' }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [] }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('requires custom reference and actual prices to be equal', () => {
    expect(() => normalizePriceQuotationSheetRequest(customRequest({ lines: [customLine({ referencePurchaseUnitPriceAmount: '1201' })] }), TODAY)).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_CUSTOM_PRICES_INVALID' }))
  })

  it('trims descriptions and caps the display field at 80 code points', () => {
    const command = normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ description: '  备注  ' })] }), TODAY)
    expect(command.lines[0]?.description).toBe('备注')
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines: [catalogLine({ description: '备'.repeat(81) })] }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('rejects more than 100 lines even if the DTO gate is bypassed', () => {
    const lines = Array.from({ length: 101 }, (_, index) => catalogLine({ productId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` }))
    expect(() => normalizePriceQuotationSheetRequest(catalogRequest({ lines }), TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
