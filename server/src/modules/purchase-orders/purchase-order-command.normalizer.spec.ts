import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { ApiException } from '../../infrastructure/http/api.exception'
import { CreatePurchaseOrderRequestDto } from './dto/purchase-order-create.dto'
import {
  normalizePurchaseOrderCreateCommand,
  parsePurchaseOrderIdempotencyKey,
} from './purchase-order-command.normalizer'

const TODAY = '2026-08-27'

function linkedInput(): Record<string, unknown> {
  return {
    parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity: 2 }] }],
    purchaseType: 'SALES_LINKED',
    productMode: 'CATALOG',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    supplierValue: ' supplier_a ',
    orderDate: TODAY,
    expectedShippingMarkResolution: 'a'.repeat(64),
    lines: [
      {
        lineType: 'CATALOG',
        productId: '22222222-2222-4222-8222-222222222222',
        sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
        actualPurchaseUnitPriceAmount: '20',
        quantity: 2,
      },
    ],
    purchaseTotalAmount: '40',
    depositDueAmount: '10',
    balanceDueAmount: '30',
    remark: ' 采购备注 ',
  }
}

function stockInput(): Record<string, unknown> {
  return {
    parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity: 2 }] }],
    purchaseType: 'STOCK',
    productMode: 'CUSTOM',
    customSupplierName: ' ＡＢＣ 供应商 ',
    orderDate: TODAY,
    expectedShippingMarkResolution: 'a'.repeat(64),
    lines: [{
      lineType: 'CUSTOM',
      name: ' 临时包装 ',
      description: ' 手工备货 ',
      referencePurchaseUnitPriceAmount: '12.3',
      actualPurchaseUnitPriceAmount: '12.30',
      quantity: 2,
    }],
    purchaseTotalAmount: '24.6',
    depositDueAmount: '0',
    balanceDueAmount: '24.60',
    remark: null,
  }
}

function captureApiException(action: () => unknown): ApiException {
  let thrown: unknown
  try {
    action()
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ApiException)
  return thrown as ApiException
}

describe('normalizePurchaseOrderCreateCommand', () => {
  it('accepts the DTO class instance produced by the global ValidationPipe', () => {
    const transformed = plainToInstance(
      CreatePurchaseOrderRequestDto,
      linkedInput(),
    )
    expect(normalizePurchaseOrderCreateCommand(transformed, TODAY).lines)
      .toHaveLength(1)
  })

  it('normalizes a sales-linked command and computes trusted totals', () => {
    expect(normalizePurchaseOrderCreateCommand(linkedInput(), TODAY)).toEqual({
      parts: [{ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ lineNumber: 1, quantity: 2 }] }],
      purchaseType: 'SALES_LINKED',
      productMode: 'CATALOG',
      salesOrderId: '11111111-1111-4111-8111-111111111111',
      supplierValue: 'SUPPLIER_A',
      customSupplierName: null,
      orderDate: TODAY,
      currencyCode: 'CNY',
      expectedShippingMarkResolution: 'a'.repeat(64),
      lines: [
        {
          lineNumber: 1,
          lineType: 'CATALOG',
          productId: '22222222-2222-4222-8222-222222222222',
          sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
          actualPurchaseUnitPriceAmount: '20.00',
          quantity: 2,
          lineTotalAmount: '40.00',
        },
      ],
      lineSubtotalAmount: '40.00',
      purchaseTotalAmount: '40.00',
      depositDueAmount: '10.00',
      balanceDueAmount: '30.00',
      remark: '采购备注',
    })
  })

  it('normalizes an independent stock CUSTOM line without a sales source', () => {
    const normalized = normalizePurchaseOrderCreateCommand(stockInput(), TODAY)
    expect(normalized).toMatchObject({
      purchaseType: 'STOCK',
      productMode: 'CUSTOM',
      salesOrderId: null,
      supplierValue: null,
      customSupplierName: 'ABC 供应商',
      currencyCode: 'CNY',
      lines: [{
        lineType: 'CUSTOM',
        sourceSalesOrderLineId: null,
        name: '临时包装',
        description: '手工备货',
        referencePurchaseUnitPriceAmount: '12.30',
        actualPurchaseUnitPriceAmount: '12.30',
        lineTotalAmount: '24.60',
      }],
    })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.lines)).toBe(true)
  })

  it('normalizes a CUSTOM supplier by NFKC and Unicode code points', () => {
    const normalized = normalizePurchaseOrderCreateCommand(stockInput(), TODAY)
    expect(normalized.customSupplierName).toBe('ABC 供应商')

    expect(() => normalizePurchaseOrderCreateCommand({
      ...stockInput(),
      customSupplierName: '😀'.repeat(129),
    }, TODAY)).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
    }))
  })

  it.each([
    [{ ...linkedInput(), productMode: 'MIXED' }, 'PURCHASE_ORDER_PRODUCT_MODE_INVALID'],
    [{ ...linkedInput(), productMode: 'UNKNOWN' }, 'PURCHASE_ORDER_PRODUCT_MODE_INVALID'],
    [{ ...linkedInput(), customSupplierName: '不应提交' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
    [{ ...stockInput(), supplierValue: 'SUPPLIER_A' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
    [{ ...stockInput(), customSupplierName: '   ' }, 'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID'],
    [{ ...stockInput(), productMode: 'CATALOG' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
    [{ ...linkedInput(), productMode: 'CUSTOM' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
  ])('rejects invalid product mode or supplier source %#', (value, code) => {
    expect(() => normalizePurchaseOrderCreateCommand(value, TODAY)).toThrow(
      expect.objectContaining({ code }),
    )
  })

  it('rejects lines outside the selected product mode', () => {
    expect(() => normalizePurchaseOrderCreateCommand({
      ...stockInput(),
      lines: [{
        lineType: 'CATALOG',
        productId: '22222222-2222-4222-8222-222222222222',
        actualPurchaseUnitPriceAmount: '10',
        quantity: 1,
      }],
      purchaseTotalAmount: '10',
      depositDueAmount: '0',
      balanceDueAmount: '10',
    }, TODAY)).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_LINE_MODE_MISMATCH',
    }))
  })

  it.each([
    ['body', { orderNo: 'must-not-be-client-controlled' }],
    ['body', { currencyCode: 'CNY' }],
    ['salesOrderId', { salesOrderId: undefined }],
    ['salesOrderId', { purchaseType: 'STOCK', salesOrderId: '11111111-1111-4111-8111-111111111111' }],
    ['lines', { lines: [] }],
    ['lines.0', { lines: [{
      lineType: 'CATALOG',
      productId: '22222222-2222-4222-8222-222222222222',
      sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
      referencePurchaseUnitPriceAmount: '20',
      actualPurchaseUnitPriceAmount: '20',
      quantity: 1,
    }] }],
    ['lines.0.sourceSalesOrderLineId', { lines: [{
      lineType: 'CATALOG',
      productId: '22222222-2222-4222-8222-222222222222',
      actualPurchaseUnitPriceAmount: '50',
      quantity: 1,
    }] }],
    ['lines.0.actualPurchaseUnitPriceAmount', { lines: [{
      lineType: 'CATALOG',
      productId: '22222222-2222-4222-8222-222222222222',
      sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
      actualPurchaseUnitPriceAmount: '1.001',
      quantity: 1,
    }] }],
  ])('rejects invalid linked input at safe field %s', (field, override) => {
    const error = captureApiException(() => normalizePurchaseOrderCreateCommand({
      ...linkedInput(),
      ...override,
    }, TODAY))
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(error.fieldErrors ?? {})).toEqual([field])
    expect(JSON.stringify(error)).not.toContain('must-not-be-client-controlled')
  })

  it('requires equal CUSTOM prices and does not infer one from the other', () => {
    for (const prices of [
      { referencePurchaseUnitPriceAmount: undefined, actualPurchaseUnitPriceAmount: '12.3' },
      { referencePurchaseUnitPriceAmount: '12.3', actualPurchaseUnitPriceAmount: undefined },
      { referencePurchaseUnitPriceAmount: '12.3', actualPurchaseUnitPriceAmount: '12.31' },
    ]) {
      const input = stockInput()
      input.lines = [{
        ...(input.lines as Array<Record<string, unknown>>)[0],
        ...prices,
      }]
      expect(() => normalizePurchaseOrderCreateCommand(input, TODAY)).toThrow(
        expect.objectContaining({ code: 'PURCHASE_ORDER_CUSTOM_PRICES_INVALID' }),
      )
    }
  })

  it('hard-blocks user totals above two decimals or unequal to line subtotal', () => {
    expect(() => normalizePurchaseOrderCreateCommand({
      ...stockInput(),
      purchaseTotalAmount: '24.6001',
    }, TODAY)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizePurchaseOrderCreateCommand({
      ...stockInput(),
      purchaseTotalAmount: '24.61',
      balanceDueAmount: '24.61',
    }, TODAY)).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_TOTAL_MISMATCH',
    }))
  })
})

describe('CreatePurchaseOrderRequestDto', () => {
  it('exposes only CATALOG and CUSTOM as valid create product modes', async () => {
    await expect(validate(plainToInstance(
      CreatePurchaseOrderRequestDto,
      linkedInput(),
    ))).resolves.toHaveLength(0)

    const mixedErrors = await validate(plainToInstance(
      CreatePurchaseOrderRequestDto,
      { ...linkedInput(), productMode: 'MIXED' },
    ))
    expect(mixedErrors.map(error => error.property)).toContain('productMode')
  })

  it('requires the supplier field selected by the product mode', async () => {
    const catalogErrors = await validate(plainToInstance(
      CreatePurchaseOrderRequestDto,
      { ...linkedInput(), supplierValue: undefined },
    ))
    expect(catalogErrors.map(error => error.property)).toContain('supplierValue')

    const customErrors = await validate(plainToInstance(
      CreatePurchaseOrderRequestDto,
      { ...stockInput(), customSupplierName: undefined },
    ))
    expect(customErrors.map(error => error.property)).toContain(
      'customSupplierName',
    )
  })
})

describe('parsePurchaseOrderIdempotencyKey', () => {
  it('accepts only a canonical lowercase UUID v4', () => {
    expect(parsePurchaseOrderIdempotencyKey(
      '123e4567-e89b-42d3-a456-426614174000',
    )).toBe('123e4567-e89b-42d3-a456-426614174000')

    for (const value of [
      undefined,
      '123E4567-E89B-42D3-A456-426614174000',
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174000,other',
    ]) {
      expect(() => parsePurchaseOrderIdempotencyKey(value)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    }
  })
})
