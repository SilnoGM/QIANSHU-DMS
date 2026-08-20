import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeSalesOrderCreateCommand,
  parseSalesOrderIdempotencyKey,
} from './sales-order-command.normalizer'

const TODAY = '2026-08-20'

function validInput(): Record<string, unknown> {
  return {
    orderDate: '2026-08-20',
    currencyCode: 'TWD',
    customer: {
      name: ' 王 小明 ',
      phone: ' 0912-345-678 ',
      countryRegionId: '11111111-1111-4111-8111-111111111111',
      provinceStateId: '22222222-2222-4222-8222-222222222222',
      cityId: '33333333-3333-4333-8333-333333333333',
      addressDetail: ' 苓雅区 中正一路 100 号 ',
    },
    lines: [
      {
        lineType: 'CATALOG',
        productId: '44444444-4444-4444-8444-444444444444',
        actualUnitPriceAmount: '20',
        quantity: 2,
      },
      {
        lineType: 'CUSTOM',
        name: ' 临时配件 ',
        description: ' 本单专用 ',
        actualUnitPriceAmount: '10',
        quantity: 1,
      },
    ],
    agreedTotalAmount: '50',
    depositDueAmount: '20',
    balanceDueAmount: '30',
    documents: [
      {
        mediaAssetId: '55555555-5555-4555-8555-555555555555',
        documentType: 'DEPOSIT_VOUCHER',
        title: ' 定金凭证 ',
        remark: null,
      },
    ],
    remark: ' 订单备注 ',
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

describe('normalizeSalesOrderCreateCommand', () => {
  it('normalizes a fixed-currency order and computes trusted line totals', () => {
    const normalized = normalizeSalesOrderCreateCommand(validInput(), TODAY)

    expect(normalized).toMatchObject({
      orderDate: TODAY,
      currencyCode: 'TWD',
      customer: {
        name: '王 小明',
        phone: '0912-345-678',
        addressDetail: '苓雅区中正一路100号',
      },
      lines: [
        {
          lineNumber: 1,
          lineType: 'CATALOG',
          productId: '44444444-4444-4444-8444-444444444444',
          actualUnitPriceAmount: '20.0000',
          quantity: 2,
          lineTotalAmount: '40.0000',
        },
        {
          lineNumber: 2,
          lineType: 'CUSTOM',
          name: '临时配件',
          description: '本单专用',
          actualUnitPriceAmount: '10.0000',
          quantity: 1,
          lineTotalAmount: '10.0000',
        },
      ],
      lineSubtotalAmount: '50.0000',
      agreedTotalAmount: '50.0000',
      depositDueAmount: '20.0000',
      balanceDueAmount: '30.0000',
      remark: '订单备注',
    })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.lines)).toBe(true)
  })

  it.each([
    ['orderDate', { orderDate: '2026-08-21' }],
    ['orderDate', { orderDate: '2026-02-30' }],
    ['currencyCode', { currencyCode: 'USD' }],
    ['lines', { lines: [] }],
    ['lines.0.quantity', {
      lines: [{
        lineType: 'CATALOG',
        productId: '44444444-4444-4444-8444-444444444444',
        actualUnitPriceAmount: '20',
        quantity: 0,
      }],
    }],
    ['lines.0.productId', {
      lines: [{
        lineType: 'CATALOG',
        actualUnitPriceAmount: '20',
        quantity: 1,
      }],
    }],
    ['lines.0', {
      lines: [{
        lineType: 'CUSTOM',
        name: '临时产品',
        productId: '44444444-4444-4444-8444-444444444444',
        description: null,
        actualUnitPriceAmount: '20',
        quantity: 1,
      }],
    }],
    ['body', { issuerUserId: 'must-not-leak' }],
  ])('rejects invalid input at safe field %s', (field, override) => {
    const error = captureApiException(() => normalizeSalesOrderCreateCommand({
      ...validInput(),
      ...override,
    }, TODAY))
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(Object.keys(error.fieldErrors ?? {})).toEqual([field])
    expect(JSON.stringify(error)).not.toContain('must-not-leak')
  })

  it('hard-blocks a manually entered total that differs from line subtotal', () => {
    const error = captureApiException(() => normalizeSalesOrderCreateCommand({
      ...validInput(),
      agreedTotalAmount: '49.99',
      depositDueAmount: '19.99',
    }, TODAY))
    expect(error.code).toBe('SALES_ORDER_TOTAL_MISMATCH')
  })
})

describe('parseSalesOrderIdempotencyKey', () => {
  it('accepts only a canonical lowercase UUID v4', () => {
    expect(parseSalesOrderIdempotencyKey(
      '123e4567-e89b-42d3-a456-426614174000',
    )).toBe('123e4567-e89b-42d3-a456-426614174000')

    for (const value of [
      undefined,
      '123E4567-E89B-42D3-A456-426614174000',
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174000,other',
    ]) {
      expect(() => parseSalesOrderIdempotencyKey(value)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      )
    }
  })
})
