import { plainToInstance } from 'class-transformer'

import { ApiException } from '../../infrastructure/http/api.exception'
import { CreatePurchaseOrderRequestDto } from './dto/purchase-order-create.dto'
import {
  normalizePurchaseOrderCreateCommand,
  parsePurchaseOrderIdempotencyKey,
} from './purchase-order-command.normalizer'

const TODAY = '2026-08-27'

function linkedInput(): Record<string, unknown> {
  return {
    purchaseType: 'SALES_LINKED',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    supplierValue: ' supplier_a ',
    orderDate: TODAY,
    shippingMarkText: ' BOX A\nBOX B ',
    lines: [
      {
        lineType: 'CATALOG',
        productId: '22222222-2222-4222-8222-222222222222',
        sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
        actualPurchaseUnitPriceAmount: '20',
        quantity: 2,
      },
      {
        lineType: 'CUSTOM',
        sourceSalesOrderLineId: '44444444-4444-4444-8444-444444444444',
        name: ' 采购侧临时产品 ',
        description: ' 采购侧临时说明 ',
        referencePurchaseUnitPriceAmount: '10',
        actualPurchaseUnitPriceAmount: '10.00',
        quantity: 1,
      },
    ],
    purchaseTotalAmount: '50',
    depositDueAmount: '20',
    balanceDueAmount: '30',
    remark: ' 采购备注 ',
  }
}

function stockInput(): Record<string, unknown> {
  return {
    purchaseType: 'STOCK',
    supplierValue: 'SUPPLIER_A',
    orderDate: TODAY,
    shippingMarkText: null,
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
      .toHaveLength(2)
  })

  it('normalizes a sales-linked command and computes trusted totals', () => {
    expect(normalizePurchaseOrderCreateCommand(linkedInput(), TODAY)).toEqual({
      purchaseType: 'SALES_LINKED',
      salesOrderId: '11111111-1111-4111-8111-111111111111',
      supplierValue: 'SUPPLIER_A',
      orderDate: TODAY,
      currencyCode: 'CNY',
      shippingMarkText: 'BOX A\nBOX B',
      lines: [
        {
          lineNumber: 1,
          lineType: 'CATALOG',
          productId: '22222222-2222-4222-8222-222222222222',
          sourceSalesOrderLineId: '33333333-3333-4333-8333-333333333333',
          actualPurchaseUnitPriceAmount: '20.0000',
          quantity: 2,
          lineTotalAmount: '40.0000',
        },
        {
          lineNumber: 2,
          lineType: 'CUSTOM',
          sourceSalesOrderLineId: '44444444-4444-4444-8444-444444444444',
          name: '采购侧临时产品',
          description: '采购侧临时说明',
          referencePurchaseUnitPriceAmount: '10.0000',
          actualPurchaseUnitPriceAmount: '10.0000',
          quantity: 1,
          lineTotalAmount: '10.0000',
        },
      ],
      lineSubtotalAmount: '50.0000',
      purchaseTotalAmount: '50.0000',
      depositDueAmount: '20.0000',
      balanceDueAmount: '30.0000',
      remark: '采购备注',
    })
  })

  it('normalizes an independent stock CUSTOM line without a sales source', () => {
    const normalized = normalizePurchaseOrderCreateCommand(stockInput(), TODAY)
    expect(normalized).toMatchObject({
      purchaseType: 'STOCK',
      salesOrderId: null,
      currencyCode: 'CNY',
      lines: [{
        lineType: 'CUSTOM',
        sourceSalesOrderLineId: null,
        name: '临时包装',
        description: '手工备货',
        referencePurchaseUnitPriceAmount: '12.3000',
        actualPurchaseUnitPriceAmount: '12.3000',
        lineTotalAmount: '24.6000',
      }],
    })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.lines)).toBe(true)
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
