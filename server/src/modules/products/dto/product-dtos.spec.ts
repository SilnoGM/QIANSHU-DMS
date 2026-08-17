import { ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { CreateProductRequestDto } from './product-create.dto'
import { ProductListQueryDto } from './product-list-query.dto'
import {
  ProductIdParamDto,
  UpdateProductRequestDto,
} from './product-update.dto'

const createDtoPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: createValidationException,
})

function validCreateBody(): Record<string, unknown> {
  return {
    name: '测试产品',
    status: 'DRAFT',
    supplierValue: null,
    twdSalePrice: { amount: null, currency: 'TWD' },
    myrSalePrice: { amount: '10.20', currency: 'MYR' },
    purchaseCost: { amount: '5', currency: 'CNY' },
    attributes: [{ title: '颜色', value: '红色' }],
  }
}

describe('ProductListQueryDto', () => {
  it('coerces pagination, trims keyword and preserves exact supplier raw value', async () => {
    const defaults = plainToInstance(ProductListQueryDto, {})
    const complete = plainToInstance(ProductListQueryDto, {
      keyword: '  Product-001  ',
      page: '2',
      pageSize: '100',
      status: 'ACTIVE',
      supplierValue: ' raw-value ',
    })

    expect(defaults).toMatchObject({ page: 1, pageSize: 20 })
    expect(complete).toMatchObject({
      keyword: 'Product-001',
      page: 2,
      pageSize: 100,
      status: 'ACTIVE',
      supplierValue: ' raw-value ',
    })
    expect(await validate(defaults)).toEqual([])
    expect(await validate(complete)).toEqual([])
  })

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { keyword: '   ' },
    { keyword: '😀'.repeat(129) },
    { status: 'UNKNOWN' },
    { supplierValue: '' },
    { supplierValue: '   ' },
    { supplierValue: '😀'.repeat(65) },
  ])('rejects invalid public query input: %j', async (input) => {
    expect(await validate(plainToInstance(ProductListQueryDto, input)))
      .not.toHaveLength(0)
  })
})

describe('CreateProductRequestDto', () => {
  it('accepts the exact create body including nullable amounts and supplier', async () => {
    const transformed = await createDtoPipe.transform(validCreateBody(), {
      type: 'body',
      metatype: CreateProductRequestDto,
    }) as unknown

    expect(transformed).toEqual(validCreateBody())
    expect(transformed).toBeInstanceOf(CreateProductRequestDto)
  })

  it.each([
    ['name', { name: undefined }],
    ['status', { status: 'UNKNOWN' }],
    ['supplierValue', { supplierValue: undefined }],
    ['twdSalePrice', { twdSalePrice: undefined }],
    ['twdSalePrice.amount', { twdSalePrice: { amount: -1, currency: 'TWD' } }],
    ['twdSalePrice.currency', { twdSalePrice: { amount: null, currency: 'USD' } }],
    ['myrSalePrice.currency', { myrSalePrice: { amount: null, currency: 'TWD' } }],
    ['purchaseCost.currency', { purchaseCost: { amount: null, currency: 'cny' } }],
    ['attributes', { attributes: 'not-an-array' }],
  ])('rejects invalid create DTO field %s', async (_field, override) => {
    await expect(createDtoPipe.transform({
      ...validCreateBody(),
      ...override,
    }, {
      type: 'body',
      metatype: CreateProductRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it.each([
    { mainImage: 'https://example.invalid/image.png' },
    { images: [] },
    { videos: [] },
    { unknown: true },
    { attributes: [{ title: '颜色', value: '红色', extra: true }] },
    { twdSalePrice: { amount: null, currency: 'TWD', extra: true } },
  ])('rejects non-whitelisted create fields: %j', async (extra) => {
    await expect(createDtoPipe.transform({
      ...validCreateBody(),
      ...extra,
    }, {
      type: 'body',
      metatype: CreateProductRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('Product detail and update DTOs', () => {
  it('accepts a UUID Product locator and a partial update with expectedVersion', async () => {
    expect(await validate(plainToInstance(ProductIdParamDto, {
      productId: '11111111-1111-4111-8111-111111111111',
    }))).toEqual([])

    const transformed = await createDtoPipe.transform({
      name: '  更新产品  ',
      supplierValue: null,
      expectedVersion: 2,
    }, {
      type: 'body',
      metatype: UpdateProductRequestDto,
    }) as UpdateProductRequestDto
    expect(transformed).toMatchObject({
      name: '更新产品',
      supplierValue: null,
      expectedVersion: 2,
    })

    const nameOnly = await createDtoPipe.transform({
      name: '  仅更新名称  ',
      expectedVersion: 3,
    }, {
      type: 'body',
      metatype: UpdateProductRequestDto,
    }) as UpdateProductRequestDto
    expect(nameOnly).toMatchObject({
      name: '仅更新名称',
      expectedVersion: 3,
    })
  })

  it.each([
    { expectedVersion: 1 },
    { name: '产品' },
    { name: '产品', expectedVersion: 0 },
    { status: 'UNKNOWN', expectedVersion: 1 },
    { twdSalePrice: { amount: '1', currency: 'USD' }, expectedVersion: 1 },
    { attributes: Array.from({ length: 51 }, () => ({ title: 'a', value: 'b' })), expectedVersion: 1 },
  ])('rejects invalid update body: %j', async (body) => {
    await expect(createDtoPipe.transform(body, {
      type: 'body',
      metatype: UpdateProductRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it.each([
    { productNo: 'P001' },
    { mainImage: null },
    { images: [] },
    { videos: [] },
    { version: 2 },
    { updatedByUserId: '11111111-1111-4111-8111-111111111111' },
  ])('rejects immutable or media update fields: %j', async (extra) => {
    await expect(createDtoPipe.transform({
      name: '产品',
      expectedVersion: 1,
      ...extra,
    }, {
      type: 'body',
      metatype: UpdateProductRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
