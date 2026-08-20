import { HttpStatus, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import {
  CreateSalesOrderRequestDto,
  SalesOrderCustomerInputDto,
} from './sales-order-create.dto'

const dtoPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: createValidationException,
})

describe('SalesOrderCustomerInputDto', () => {
  it('accepts canonical UUID v5 identities emitted by the existing region selector', async () => {
    const dto = plainToInstance(SalesOrderCustomerInputDto, {
      name: '王小明',
      phone: '0912345678',
      countryRegionId: '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
      provinceStateId: 'ee82c572-f653-51d2-98d4-f11ac5928aa1',
      cityId: '78f9134e-3d72-5f6e-9897-ca7e50004229',
      addressDetail: '苓雅区中正一路100号',
    })

    await expect(validate(dto)).resolves.toEqual([])
  })
})

describe('CreateSalesOrderRequestDto', () => {
  it('accepts a complete catalog sales-order request through the global validation contract', async () => {
    const request = {
      orderDate: '2026-08-20',
      currencyCode: 'TWD',
      customer: {
        name: '王小明',
        phone: '0912345678',
        countryRegionId: '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
        provinceStateId: 'ee82c572-f653-51d2-98d4-f11ac5928aa1',
        cityId: '78f9134e-3d72-5f6e-9897-ca7e50004229',
        addressDetail: '苓雅区中正一路100号',
      },
      lines: [{
        lineType: 'CATALOG',
        productId: '62f874aa-1b13-4dd0-8d6e-e67e71a3096f',
        actualUnitPriceAmount: '100.0000',
        quantity: 2,
      }],
      agreedTotalAmount: '200.0000',
      depositDueAmount: '50.0000',
      balanceDueAmount: '150.0000',
      documents: [],
      remark: null,
    }

    await expect(dtoPipe.transform(request, {
      metatype: CreateSalesOrderRequestDto,
      type: 'body',
    })).resolves.toBeInstanceOf(CreateSalesOrderRequestDto)
  })
})
