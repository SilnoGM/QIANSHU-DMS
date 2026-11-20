import { HttpStatus, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import {
  SalesOrderCustomerUpdateRequestDto,
  SalesOrderSalesInfoUpdateRequestDto,
} from './sales-order-edit.dto'

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

async function validateDto<T extends object>(type: new () => T, payload: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  return errors.map(error => error.property)
}

describe('SalesOrderCustomerUpdateRequestDto', () => {
  it('accepts a complete customer update payload', async () => {
    await expect(validateDto(SalesOrderCustomerUpdateRequestDto, {
      expectedVersion: 3,
      reason: '客户更正姓名',
      customer: VALID_CUSTOMER,
    })).resolves.toEqual([])
  })

  it('rejects a customer name longer than 24 code points', async () => {
    await expect(validateDto(SalesOrderCustomerUpdateRequestDto, {
      expectedVersion: 3,
      reason: '客户更正姓名',
      customer: { ...VALID_CUSTOMER, name: '客'.repeat(25) },
    })).resolves.toContain('customer')
  })

  it('rejects a reason longer than 500 code points', async () => {
    await expect(validateDto(SalesOrderCustomerUpdateRequestDto, {
      expectedVersion: 3,
      reason: '因'.repeat(501),
      customer: VALID_CUSTOMER,
    })).resolves.toContain('reason')
  })

  it('rejects a version below 1', async () => {
    await expect(validateDto(SalesOrderCustomerUpdateRequestDto, {
      expectedVersion: 0,
      reason: '客户更正姓名',
      customer: VALID_CUSTOMER,
    })).resolves.toContain('expectedVersion')
  })
})

describe('SalesOrderSalesInfoUpdateRequestDto', () => {
  it('accepts a null remark to clear the field', async () => {
    await expect(validateDto(SalesOrderSalesInfoUpdateRequestDto, {
      expectedVersion: 3,
      reason: '核对出单日期',
      orderDate: '2026-11-20',
      remark: null,
    })).resolves.toEqual([])
  })

  it('rejects a non-date orderDate', async () => {
    await expect(validateDto(SalesOrderSalesInfoUpdateRequestDto, {
      expectedVersion: 3,
      reason: '核对出单日期',
      orderDate: '2026/11/20',
      remark: null,
    })).resolves.toContain('orderDate')
  })

  it('passes the global validation pipe with an optional remark omitted', async () => {
    const result: unknown = await dtoPipe.transform({
      expectedVersion: 3,
      reason: '核对出单日期',
      orderDate: '2026-11-20',
    }, { type: 'body', metatype: SalesOrderSalesInfoUpdateRequestDto })
    expect(result).toBeInstanceOf(SalesOrderSalesInfoUpdateRequestDto)
  })
})
