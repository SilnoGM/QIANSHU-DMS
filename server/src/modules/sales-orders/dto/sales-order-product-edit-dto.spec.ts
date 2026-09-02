import { HttpStatus, ValidationPipe } from '@nestjs/common'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { normalizeSalesOrderProductEditCommand } from '../sales-order-product-edit.normalizer'
import { SalesOrderProductsUpdateRequestDto } from './sales-order-product-edit.dto'

const dtoPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: createValidationException,
})

function validRequest(): Record<string, unknown> {
  return {
    expectedVersion: 4,
    reason: ' 客户调整产品 ',
    confirmDepositReduction: false,
    existingLines: [{
      lineId: '11111111-1111-4111-8111-111111111111',
      name: '目录产品快照',
      description: '修改后的备注',
      actualUnitPriceAmount: '98.50',
      desiredQuantity: 0,
    }, {
      lineId: '22222222-2222-4222-8222-222222222222',
      name: '临时产品快照',
      description: null,
      actualUnitPriceAmount: '30',
      desiredQuantity: 3,
    }],
    newLines: [{
      lineType: 'CATALOG',
      productId: '33333333-3333-4333-8333-333333333333',
      actualUnitPriceAmount: '120.50',
      quantity: 2,
    }],
  }
}

describe('SalesOrderProductsUpdateRequestDto', () => {
  it('accepts a complete existing-line target set and optional new lines', async () => {
    await expect(dtoPipe.transform(validRequest(), {
      metatype: SalesOrderProductsUpdateRequestDto,
      type: 'body',
    })).resolves.toBeInstanceOf(SalesOrderProductsUpdateRequestDto)
  })

  it.each([
    { expectedVersion: 0 },
    { reason: '' },
    { confirmDepositReduction: 'true' },
    { existingLines: [] },
    { existingLines: [{ lineId: 'invalid', desiredQuantity: 1 }] },
    { existingLines: [{
      lineId: '11111111-1111-4111-8111-111111111111',
      desiredQuantity: -1,
    }] },
    { newLines: Array.from({ length: 101 }, () => ({
      lineType: 'CUSTOM',
      name: '临时产品',
      description: null,
      actualUnitPriceAmount: '1',
      quantity: 1,
    })) },
  ])('rejects invalid product-edit input %#', async (override) => {
    await expect(dtoPipe.transform({ ...validRequest(), ...override }, {
      metatype: SalesOrderProductsUpdateRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('normalizeSalesOrderProductEditCommand', () => {
  it('normalizes zero as business removal and keeps new-line fixed point rules', () => {
    expect(normalizeSalesOrderProductEditCommand(validRequest())).toMatchObject({
      expectedVersion: 4,
      reason: '客户调整产品',
      confirmDepositReduction: false,
      existingLines: [{
        lineId: '11111111-1111-4111-8111-111111111111',
        name: '目录产品快照',
        description: '修改后的备注',
        actualUnitPriceAmount: '98.5000',
        desiredQuantity: 0,
      }, {
        lineId: '22222222-2222-4222-8222-222222222222',
        name: '临时产品快照',
        description: null,
        actualUnitPriceAmount: '30.0000',
        desiredQuantity: 3,
      }],
      newLines: [{
        lineType: 'CATALOG',
        productId: '33333333-3333-4333-8333-333333333333',
        actualUnitPriceAmount: '120.5000',
        quantity: 2,
        lineTotalAmount: '241.0000',
      }],
    })
  })

  it.each([
    { existingLines: [{
      lineId: '11111111-1111-4111-8111-111111111111', name: 'A', description: null,
      actualUnitPriceAmount: '1', desiredQuantity: 1,
    }, {
      lineId: '11111111-1111-4111-8111-111111111111', name: 'B', description: null,
      actualUnitPriceAmount: '1', desiredQuantity: 2,
    }] },
    { newLines: [], existingLines: [] },
    { unexpected: true },
  ])('rejects ambiguous or unknown command input %#', (override) => {
    expect(() => normalizeSalesOrderProductEditCommand({
      ...validRequest(),
      ...override,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
