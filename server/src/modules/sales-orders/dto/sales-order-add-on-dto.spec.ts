import { HttpStatus, ValidationPipe } from '@nestjs/common'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { normalizeSalesOrderAddOnCommand } from '../sales-order-command.normalizer'
import { SalesOrderAddOnLinesRequestDto } from './sales-order-add-on.dto'

const dtoPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: createValidationException,
})

function validRequest(): Record<string, unknown> {
  return {
    expectedVersion: 3,
    supplierValue: ' supplier_tw_01 ',
    reason: ' 客户加购产品 ',
    lines: [{
      lineType: 'CATALOG',
      productId: '11111111-1111-4111-8111-111111111111',
      actualUnitPriceAmount: '120.50',
      quantity: 2,
    }, {
      lineType: 'CUSTOM',
      name: ' 临时安装服务 ',
      description: ' 客户现场追加 ',
      actualUnitPriceAmount: '30',
      quantity: 1,
    }],
  }
}

describe('SalesOrderAddOnLinesRequestDto', () => {
  it('accepts catalog and custom lines through the global validation contract', async () => {
    await expect(dtoPipe.transform(validRequest(), {
      metatype: SalesOrderAddOnLinesRequestDto,
      type: 'body',
    })).resolves.toBeInstanceOf(SalesOrderAddOnLinesRequestDto)
  })

  it.each([
    ['expectedVersion', { expectedVersion: 0 }],
    ['supplierValue', { supplierValue: '供应商' }],
    ['reason', { reason: '' }],
    ['lines', { lines: [] }],
    ['lines', { lines: Array.from({ length: 101 }, () => ({
      lineType: 'CUSTOM',
      name: '临时产品',
      description: null,
      actualUnitPriceAmount: '1',
      quantity: 1,
    })) }],
    ['lines', { lines: [{
      lineType: 'CATALOG',
      productId: 'not-a-uuid',
      actualUnitPriceAmount: '1',
      quantity: 1,
    }] }],
    ['lines', { lines: [{
      lineType: 'CUSTOM',
      name: '',
      description: null,
      actualUnitPriceAmount: '1',
      quantity: 1,
    }] }],
    ['lines', { lines: [{
      lineType: 'CUSTOM',
      name: '临时产品',
      description: null,
      actualUnitPriceAmount: '1.234',
      quantity: 1,
    }] }],
    ['lines', { lines: [{
      lineType: 'CUSTOM',
      name: '临时产品',
      description: null,
      actualUnitPriceAmount: '1',
      quantity: 0,
    }] }],
  ])('rejects invalid %s input', async (_field, override) => {
    await expect(dtoPipe.transform({
      ...validRequest(),
      ...override,
    }, {
      metatype: SalesOrderAddOnLinesRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects unknown fields at the request and line boundaries', async () => {
    await expect(dtoPipe.transform({
      ...validRequest(),
      currencyCode: 'TWD',
    }, {
      metatype: SalesOrderAddOnLinesRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    const request = validRequest()
    request.lines = [{
      lineType: 'CATALOG',
      productId: '11111111-1111-4111-8111-111111111111',
      unexpectedLineField: '不应接收的字段',
      actualUnitPriceAmount: '1',
      quantity: 1,
    }]
    await expect(dtoPipe.transform(request, {
      metatype: SalesOrderAddOnLinesRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('normalizeSalesOrderAddOnCommand', () => {
  it('reuses the sales line amount rules and computes trusted fixed-point totals', () => {
    expect(normalizeSalesOrderAddOnCommand(validRequest())).toMatchObject({
      expectedVersion: 3,
      supplierValue: 'SUPPLIER_TW_01',
      reason: '客户加购产品',
      amountDelta: '271.0000',
      lines: [{
        lineNumber: 1,
        lineType: 'CATALOG',
        actualUnitPriceAmount: '120.5000',
        quantity: 2,
        lineTotalAmount: '241.0000',
      }, {
        lineNumber: 2,
        lineType: 'CUSTOM',
        name: '临时安装服务',
        description: '客户现场追加',
        actualUnitPriceAmount: '30.0000',
        quantity: 1,
        lineTotalAmount: '30.0000',
      }],
    })
  })
})
