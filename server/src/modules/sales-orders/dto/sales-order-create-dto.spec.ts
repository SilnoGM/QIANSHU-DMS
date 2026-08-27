import { HttpStatus, ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import {
  CreateSalesOrderRequestDto,
  SalesOrderCustomerInputDto,
  SalesOrderLineInputDto,
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
        actualUnitPriceAmount: '100.00',
        quantity: 2,
      }],
      agreedTotalAmount: '200.0000',
      depositDueAmount: '50.0000',
      balanceDueAmount: '150.0000',
      issuanceVoucher: {
        mediaAssetId: '55555555-5555-4555-8555-555555555555',
      },
      remark: null,
    }

    await expect(dtoPipe.transform(request, {
      metatype: CreateSalesOrderRequestDto,
      type: 'body',
    })).resolves.toBeInstanceOf(CreateSalesOrderRequestDto)
  })

  it('rejects a missing issuance voucher and the legacy documents array', async () => {
    const base = {
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
        lineType: 'CUSTOM',
        name: '临时产品',
        description: null,
        actualUnitPriceAmount: '1',
        quantity: 1,
      }],
      agreedTotalAmount: '1',
      depositDueAmount: '0',
      balanceDueAmount: '1',
      remark: null,
    }

    await expect(dtoPipe.transform(base, {
      metatype: CreateSalesOrderRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(dtoPipe.transform({
      ...base,
      documents: [],
      issuanceVoucher: {
        mediaAssetId: '55555555-5555-4555-8555-555555555555',
      },
    }, {
      metatype: CreateSalesOrderRequestDto,
      type: 'body',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('SalesOrderLineInputDto', () => {
  it.each(['0', '1', '1.2', '1.23'])(
    'accepts an actual unit price with at most two decimals: %s',
    async (actualUnitPriceAmount) => {
      const dto = plainToInstance(SalesOrderLineInputDto, {
        lineType: 'CATALOG',
        productId: '62f874aa-1b13-4dd0-8d6e-e67e71a3096f',
        actualUnitPriceAmount,
        quantity: 1,
      })

      await expect(validate(dto)).resolves.toEqual([])
    },
  )

  it('rejects a third decimal place in actual unit price', async () => {
    const dto = plainToInstance(SalesOrderLineInputDto, {
      lineType: 'CATALOG',
      productId: '62f874aa-1b13-4dd0-8d6e-e67e71a3096f',
      actualUnitPriceAmount: '1.234',
      quantity: 1,
    })

    const errors = await validate(dto)
    expect(errors.map(error => error.property)).toContain('actualUnitPriceAmount')
  })
})
