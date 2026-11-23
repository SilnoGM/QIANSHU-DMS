import { HttpStatus, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import { SalesOrderInfoUpdateRequestDto } from './sales-order-edit.dto'

const uuid = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`

const VALID_CUSTOMER = {
  name: '王小明',
  phone: '0912345678',
  countryRegionId: uuid('01'),
  provinceStateId: uuid('02'),
  cityId: uuid('03'),
  addressDetail: '苓雅区中正一路100号',
}

const dtoPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: createValidationException,
})

async function validateDto(payload: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(SalesOrderInfoUpdateRequestDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return errors.map(error => error.property)
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectedVersion: 3,
    reason: '客户与出单信息核对',
    customer: VALID_CUSTOMER,
    orderDate: '2026-11-20',
    remark: null,
    ...overrides,
  }
}

describe('SalesOrderInfoUpdateRequestDto', () => {
  it('accepts a complete customer and sales-info payload', async () => {
    await expect(validateDto(payload())).resolves.toEqual([])
  })

  it('accepts an explicit null remark to clear the field', async () => {
    await expect(validateDto(payload({ remark: null }))).resolves.toEqual([])
  })

  it('rejects a customer name longer than 24 code points', async () => {
    await expect(validateDto(payload({
      customer: { ...VALID_CUSTOMER, name: '客'.repeat(25) },
    }))).resolves.toContain('customer')
  })

  it('rejects a reason longer than 500 code points', async () => {
    await expect(validateDto(payload({ reason: '因'.repeat(501) }))).resolves.toContain('reason')
  })

  it('rejects a non-date orderDate', async () => {
    await expect(validateDto(payload({ orderDate: '2026/11/20' }))).resolves.toContain('orderDate')
  })

  it('rejects a version below 1', async () => {
    await expect(validateDto(payload({ expectedVersion: 0 }))).resolves.toContain('expectedVersion')
  })

  it('passes the global validation pipe with an optional remark omitted', async () => {
    const withoutRemark = payload()
    delete withoutRemark.remark
    const result: unknown = await dtoPipe.transform(withoutRemark, {
      type: 'body',
      metatype: SalesOrderInfoUpdateRequestDto,
    })
    expect(result).toBeInstanceOf(SalesOrderInfoUpdateRequestDto)
  })
})
