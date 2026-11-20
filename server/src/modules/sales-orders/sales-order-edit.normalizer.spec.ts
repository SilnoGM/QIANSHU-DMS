import { ApiException } from '../../infrastructure/http/api.exception'
import {
  normalizeSalesOrderCustomerUpdateCommand,
  normalizeSalesOrderSalesInfoUpdateCommand,
} from './sales-order-edit.normalizer'

const uuid = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`

const CUSTOMER = {
  name: '王小明',
  phone: '0912345678',
  countryRegionId: uuid('01'),
  provinceStateId: uuid('02'),
  cityId: uuid('03'),
  addressDetail: '苓雅区中正一路100号',
}

function captureFailure(run: () => unknown): ApiException {
  try {
    run()
  }
  catch (error) {
    if (error instanceof ApiException) return error
    throw error
  }
  throw new Error('expected ApiException')
}

describe('normalizeSalesOrderCustomerUpdateCommand', () => {
  it('normalizes text and maps blank optional social names to null', () => {
    const command = normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 2,
      reason: '  客户更正姓名  ',
      customer: { ...CUSTOMER, name: '  王小明 ', fbName: '   ', lineName: null },
    })
    expect(command.reason).toBe('客户更正姓名')
    expect(command.customer.name).toBe('王小明')
    expect(command.customer.fbName).toBeNull()
    expect(command.customer.lineName).toBeNull()
  })

  it('rejects a customer name longer than 24 code points', () => {
    const failure = captureFailure(() => normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 2,
      reason: '客户更正姓名',
      customer: { ...CUSTOMER, name: '客'.repeat(25) },
    }))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.fieldErrors).toEqual({ 'customer.name': ['字段校验失败'] })
  })

  it('rejects a non-uuid region identity', () => {
    const failure = captureFailure(() => normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 2,
      reason: '客户更正姓名',
      customer: { ...CUSTOMER, cityId: 'not-a-uuid' },
    }))
    expect(failure.fieldErrors).toEqual({ 'customer.cityId': ['字段校验失败'] })
  })

  it('rejects a blank or oversized reason', () => {
    expect(captureFailure(() => normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 2,
      reason: '   ',
      customer: CUSTOMER,
    })).fieldErrors).toEqual({ reason: ['字段校验失败'] })
    expect(captureFailure(() => normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 2,
      reason: '因'.repeat(501),
      customer: CUSTOMER,
    })).fieldErrors).toEqual({ reason: ['字段校验失败'] })
  })

  it('rejects an invalid expected version', () => {
    expect(captureFailure(() => normalizeSalesOrderCustomerUpdateCommand({
      expectedVersion: 0,
      reason: '客户更正姓名',
      customer: CUSTOMER,
    })).fieldErrors).toEqual({ expectedVersion: ['字段校验失败'] })
  })
})

describe('normalizeSalesOrderSalesInfoUpdateCommand', () => {
  const businessToday = '2026-11-20'

  it('accepts today and an explicit null remark', () => {
    const command = normalizeSalesOrderSalesInfoUpdateCommand({
      expectedVersion: 4,
      reason: '核对出单日期',
      orderDate: businessToday,
      remark: null,
    }, businessToday)
    expect(command.orderDate).toBe(businessToday)
    expect(command.remark).toBeNull()
  })

  it('rejects a future order date', () => {
    const failure = captureFailure(() => normalizeSalesOrderSalesInfoUpdateCommand({
      expectedVersion: 4,
      reason: '核对出单日期',
      orderDate: '2026-11-21',
      remark: null,
    }, businessToday))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.fieldErrors).toEqual({ orderDate: ['必须是今天或历史日期'] })
  })

  it('rejects a non-existent calendar date', () => {
    const failure = captureFailure(() => normalizeSalesOrderSalesInfoUpdateCommand({
      expectedVersion: 4,
      reason: '核对出单日期',
      orderDate: '2026-02-30',
      remark: null,
    }, businessToday))
    expect(failure.fieldErrors).toEqual({ orderDate: ['字段校验失败'] })
  })

  it('rejects a payload that omits remark instead of silently clearing it', () => {
    const failure = captureFailure(() => normalizeSalesOrderSalesInfoUpdateCommand({
      expectedVersion: 4,
      reason: '核对出单日期',
      orderDate: businessToday,
    }, businessToday))
    expect(failure.fieldErrors).toEqual({ remark: ['字段校验失败'] })
  })

  it('rejects a blank remark string', () => {
    const failure = captureFailure(() => normalizeSalesOrderSalesInfoUpdateCommand({
      expectedVersion: 4,
      reason: '核对出单日期',
      orderDate: businessToday,
      remark: '   ',
    }, businessToday))
    expect(failure.fieldErrors).toEqual({ remark: ['字段校验失败'] })
  })
})
