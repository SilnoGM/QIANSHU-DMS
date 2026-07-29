import { ApiException } from '../../infrastructure/http/api.exception'
import { mapCurrencyPersistenceError } from './currency.persistence-error.mapper'

function expectMapped(
  error: unknown,
  expected: {
    code: string
    message: string
    status: number
  },
): void {
  const mapped = mapCurrencyPersistenceError(error)

  expect(mapped).toBeInstanceOf(ApiException)
  expect(mapped.getStatus()).toBe(expected.status)
  expect(mapped.code).toBe(expected.code)
  expect(mapped.publicMessage).toBe(expected.message)
  expect(mapped.message).not.toContain('must-not-leak')
}

describe('Currency persistence error mapper', () => {
  it('maps the code uniqueness boundary from Prisma and PostgreSQL shapes', () => {
    for (const error of [
      {
        code: 'P2002',
        meta: { target: ['code'] },
        message: 'must-not-leak TWD',
      },
      {
        code: '23505',
        constraint: 'currencies_code_key',
        detail: 'must-not-leak TWD',
      },
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              constraint: { fields: ['code'] },
            },
          },
        },
      },
    ]) {
      expectMapped(error, {
        code: 'CURRENCY_CODE_ALREADY_EXISTS',
        message: '货币编码已存在',
        status: 409,
      })
    }
  })

  it('maps the activation dependency and fixed CNY constraints', () => {
    expectMapped(
      {
        code: 'P2010',
        meta: {
          database_error: {
            code: '23514',
            constraint: 'currencies_exchange_rate_required_check',
            message: 'must-not-leak SQL',
          },
        },
      },
      {
        code: 'CURRENCY_EXCHANGE_RATE_REQUIRED',
        message: '请先配置当前汇率再启用该货币',
        status: 422,
      },
    )
    expectMapped(
      {
        code: '23514',
        constraint: 'currencies_cny_shape_check',
        message: 'must-not-leak SQL',
      },
      {
        code: 'BASE_CURRENCY_CANNOT_BE_DISABLED',
        message: '人民币为固定基准币，不能停用',
        status: 422,
      },
    )
  })

  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { code: 'P2010', meta: { database_error: { code: '40P01' } } },
    {
      code: 'P2010',
      meta: { driver_adapter_error: { cause: { code: '55P03' } } },
    },
  ])('maps retryable transaction state %#', (error) => {
    expectMapped(error, {
      code: 'CURRENCY_STATE_CHANGED',
      message: '货币状态已变化，请刷新后重试',
      status: 409,
    })
  })

  it('preserves safe ApiException and fails closed for unknown errors', () => {
    const original = new ApiException(
      404,
      'CURRENCY_NOT_FOUND',
      '货币不存在',
    )
    expect(mapCurrencyPersistenceError(original)).toBe(original)

    expectMapped(
      {
        code: 'P2002',
        meta: { target: ['unknown'] },
        message: 'must-not-leak',
      },
      {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
        status: 500,
      },
    )
  })
})
