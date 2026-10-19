import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeProductCreateCommand,
  parseProductIdempotencyKey,
} from './product-command.normalizer'

interface ProductInputFixture extends Record<string, unknown> {
  name: string
  categoryName: string
  productHeadName: string
  status: string
  supplierValue: string
  twdSalePrice: { amount: string; currency: string }
  myrSalePrice: { amount: null; currency: string }
  purchaseCost: { amount: string; currency: string }
  attributes: Array<{ title: string; value: string }>
}

function validInput(): ProductInputFixture {
  return {
    name: ' Product ',
    categoryName: ' 分类 ',
    productHeadName: ' 产品头 ',
    status: 'INACTIVE',
    supplierValue: 'SUPPLIER_A',
    twdSalePrice: { amount: '1.0', currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: '20.50', currency: 'CNY' },
    attributes: [
      { title: ' Color ', value: ' Re\u0301d ' },
      { title: 'Color', value: 'Blue' },
    ],
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

function expectValidationField(input: unknown, field: string): void {
  const error = captureApiException(() => normalizeProductCreateCommand(input))
  expect(error).toMatchObject({
    code: 'VALIDATION_FAILED',
    publicMessage: '请求参数校验失败',
  })
  expect(Object.keys(error.fieldErrors ?? {})).toEqual([field])
  expect(error.fieldErrors?.[field]).toEqual([expect.any(String)])
  expect(JSON.stringify(error)).not.toContain('must-not-leak')
}

describe('normalizeProductCreateCommand', () => {
  it('normalizes text and decimal scale while preserving ordered duplicates', () => {
    const source = validInput()
    source.name = ' Cafe\u0301 '

    const normalized = normalizeProductCreateCommand(source)

    expect(normalized).toEqual({
      name: 'Café',
      categoryName: '分类',
      productHeadName: '产品头',
      status: 'INACTIVE',
      supplierValue: 'SUPPLIER_A',
      twdSalePrice: {
        amount: '1.0000',
        currency: 'TWD',
        inputFractionDigits: 1,
      },
      myrSalePrice: {
        amount: null,
        currency: 'MYR',
        inputFractionDigits: 0,
      },
      purchaseCost: {
        amount: '20.5000',
        currency: 'CNY',
        inputFractionDigits: 2,
      },
      attributes: [
        { title: 'Color', value: 'Réd' },
        { title: 'Color', value: 'Blue' },
      ],
      remark: null,
    })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.twdSalePrice)).toBe(true)
    expect(Object.isFrozen(normalized.attributes)).toBe(true)
    expect(normalized.attributes.every(item => Object.isFrozen(item))).toBe(true)

    source.attributes[0].value = 'changed'
    expect(normalized.attributes[0]?.value).toBe('Réd')
  })

  it('normalizes and preserves an optional remark', () => {
    expect(normalizeProductCreateCommand(validInput()).remark).toBeNull()
    expect(normalizeProductCreateCommand({
      ...validInput(),
      remark: '  需加宽机身到 1.2 米  ',
    }).remark).toBe('需加宽机身到 1.2 米')
    expect(() => normalizeProductCreateCommand({
      ...validInput(),
      remark: '   ',
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('requires a supplier for every status', () => {    expect(normalizeProductCreateCommand(validInput()).supplierValue)
      .toBe('SUPPLIER_A')
    expect(normalizeProductCreateCommand({
      ...validInput(),
      status: 'ACTIVE',
    }).supplierValue).toBe('SUPPLIER_A')

    for (const status of ['ACTIVE', 'INACTIVE'] as const) {
      const error = captureApiException(() => normalizeProductCreateCommand({
        ...validInput(),
        status,
        supplierValue: null,
      }))
      expect(error).toMatchObject({
        code: 'PRODUCT_SUPPLIER_REQUIRED',
        publicMessage: '请选择供应商',
      })
      expect(error.fieldErrors).toEqual({
        supplierValue: ['请选择供应商'],
      })
    }
  })

  it('rejects a half-filled taxonomy pair', () => {
    const categoryOnly = captureApiException(() => normalizeProductCreateCommand({
      ...validInput(),
      productHeadName: null,
    }))
    expect(categoryOnly.fieldErrors).toEqual({
      productHeadName: ['分类与产品头必须同时填写'],
    })

    const productHeadOnly = captureApiException(() => normalizeProductCreateCommand({
      ...validInput(),
      categoryName: null,
    }))
    expect(productHeadOnly.fieldErrors).toEqual({
      productHeadName: ['分类与产品头必须同时填写'],
    })
  })

  it.each([
    ['name', { name: '   ' }],
    ['name', { name: '😀'.repeat(129) }],
    ['categoryName', { categoryName: '   ' }],
    ['productHeadName', { productHeadName: '😀'.repeat(65) }],
    ['status', { status: 'UNKNOWN' }],
    ['supplierValue', { supplierValue: '   ' }],
    ['supplierValue', { supplierValue: '😀'.repeat(65) }],
    ['twdSalePrice.currency', { twdSalePrice: { amount: null, currency: 'USD' } }],
    ['myrSalePrice.currency', { myrSalePrice: { amount: null, currency: 'TWD' } }],
    ['purchaseCost.currency', { purchaseCost: { amount: null, currency: 'cny' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: '-1', currency: 'TWD' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: '01', currency: 'TWD' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: '1e2', currency: 'TWD' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: '1,000', currency: 'TWD' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: `${'9'.repeat(27)}.0`, currency: 'TWD' } }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: '1.00000', currency: 'TWD' } }],
    ['attributes', { attributes: Array.from({ length: 51 }, () => ({ title: 'A', value: 'B' })) }],
    ['attributes.0.title', { attributes: [{ title: ' ', value: 'B' }] }],
    ['attributes.0.value', { attributes: [{ title: 'A', value: '😀'.repeat(513) }] }],
    ['attributes.0', { attributes: [{ title: 'A', value: 'B', extra: 'must-not-leak' }] }],
    ['body', { mainImage: 'must-not-leak' }],
  ])('rejects invalid input at safe field %s', (field, override) => {
    expectValidationField({ ...validInput(), ...override }, field)
  })
})

describe('parseProductIdempotencyKey', () => {
  it('accepts only a canonical lowercase UUID v4 header', () => {
    expect(parseProductIdempotencyKey(
      '123e4567-e89b-42d3-a456-426614174000',
    )).toBe('123e4567-e89b-42d3-a456-426614174000')
  })

  it.each([
    undefined,
    null,
    '',
    '123E4567-E89B-42D3-A456-426614174000',
    '123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-42d3-7456-426614174000',
    '123e4567-e89b-42d3-a456-426614174000, 123e4567-e89b-42d3-a456-426614174001',
    ['123e4567-e89b-42d3-a456-426614174000'],
  ])('rejects a missing, merged, or non-canonical header: %j', (value) => {
    const error = captureApiException(() => parseProductIdempotencyKey(value))
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(error.fieldErrors).toEqual({
      idempotencyKey: ['必须是规范的小写 UUID v4'],
    })
    if (typeof value === 'string' && value.length > 0) {
      expect(JSON.stringify(error)).not.toContain(value)
    }
  })
})
