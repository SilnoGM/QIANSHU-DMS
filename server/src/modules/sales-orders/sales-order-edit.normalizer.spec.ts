import { ApiException } from '../../infrastructure/http/api.exception'
import { normalizeSalesOrderInfoUpdateCommand } from './sales-order-edit.normalizer'

const uuid = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`

const CUSTOMER = {
  name: '王小明',
  phone: '0912345678',
  countryRegionId: uuid('01'),
  provinceStateId: uuid('02'),
  cityId: uuid('03'),
  addressDetail: '苓雅区中正一路100号',
}

const BUSINESS_TODAY = '2026-11-20'

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

function command(overrides: Record<string, unknown> = {}): unknown {
  return {
    expectedVersion: 2,
    reason: '客户与出单信息核对',
    customer: CUSTOMER,
    orderDate: BUSINESS_TODAY,
    remark: null,
    ...overrides,
  }
}

describe('normalizeSalesOrderInfoUpdateCommand', () => {
  it('normalizes text and maps blank optional social names to null', () => {
    const normalized = normalizeSalesOrderInfoUpdateCommand(command({
      reason: '  客户与出单信息核对  ',
      customer: { ...CUSTOMER, name: '  王小明 ', fbName: '   ', lineName: null },
    }), BUSINESS_TODAY)
    expect(normalized.reason).toBe('客户与出单信息核对')
    expect(normalized.customer.name).toBe('王小明')
    expect(normalized.customer.fbName).toBeNull()
    expect(normalized.customer.lineName).toBeNull()
    expect(normalized.orderDate).toBe(BUSINESS_TODAY)
    expect(normalized.remark).toBeNull()
  })

  it('accepts today and an explicit null remark', () => {
    const normalized = normalizeSalesOrderInfoUpdateCommand(command(), BUSINESS_TODAY)
    expect(normalized.orderDate).toBe(BUSINESS_TODAY)
    expect(normalized.remark).toBeNull()
  })

  it('rejects a future order date', () => {
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ orderDate: '2026-11-21' }),
      BUSINESS_TODAY,
    ))
    expect(failure.code).toBe('VALIDATION_FAILED')
    expect(failure.fieldErrors).toEqual({ orderDate: ['必须是今天或历史日期'] })
  })

  it('rejects a non-existent calendar date', () => {
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ orderDate: '2026-02-30' }),
      BUSINESS_TODAY,
    ))
    expect(failure.fieldErrors).toEqual({ orderDate: ['字段校验失败'] })
  })

  it('rejects a payload that omits remark instead of silently clearing it', () => {
    const body = command()
    delete (body as Record<string, unknown>).remark
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(body, BUSINESS_TODAY))
    expect(failure.fieldErrors).toEqual({ remark: ['字段校验失败'] })
  })

  it('rejects a blank remark string', () => {
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ remark: '   ' }),
      BUSINESS_TODAY,
    ))
    expect(failure.fieldErrors).toEqual({ remark: ['字段校验失败'] })
  })

  it('rejects a customer name longer than 24 code points', () => {
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ customer: { ...CUSTOMER, name: '客'.repeat(25) } }),
      BUSINESS_TODAY,
    ))
    expect(failure.fieldErrors).toEqual({ 'customer.name': ['字段校验失败'] })
  })

  it('rejects a non-uuid region identity', () => {
    const failure = captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ customer: { ...CUSTOMER, cityId: 'not-a-uuid' } }),
      BUSINESS_TODAY,
    ))
    expect(failure.fieldErrors).toEqual({ 'customer.cityId': ['字段校验失败'] })
  })

  it('rejects a blank or oversized reason', () => {
    expect(captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ reason: '   ' }),
      BUSINESS_TODAY,
    )).fieldErrors).toEqual({ reason: ['字段校验失败'] })
    expect(captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ reason: '因'.repeat(501) }),
      BUSINESS_TODAY,
    )).fieldErrors).toEqual({ reason: ['字段校验失败'] })
  })

  it('rejects an invalid expected version', () => {
    expect(captureFailure(() => normalizeSalesOrderInfoUpdateCommand(
      command({ expectedVersion: 0 }),
      BUSINESS_TODAY,
    )).fieldErrors).toEqual({ expectedVersion: ['字段校验失败'] })
  })
})
