import { ApiException } from '../../infrastructure/http/api.exception'
import { mapExchangeRatePersistenceError } from './exchange-rate.persistence-error.mapper'

function expectMapped(
  error: unknown,
  expected: {
    code: string
    message: string
    status: number
  },
): void {
  const mapped = mapExchangeRatePersistenceError(error)

  expect(mapped).toBeInstanceOf(ApiException)
  expect(mapped.getStatus()).toBe(expected.status)
  expect(mapped.code).toBe(expected.code)
  expect(mapped.publicMessage).toBe(expected.message)
  expect(mapped.message).not.toContain('must-not-leak')
}

describe('ExchangeRate persistence error mapper', () => {
  it('maps one-current-rate uniqueness and currency foreign key shapes', () => {
    expectMapped(
      {
        code: 'P2002',
        meta: { target: ['currency_id'] },
        message: 'must-not-leak currency',
      },
      {
        code: 'EXCHANGE_RATE_ALREADY_EXISTS',
        message: '该货币已配置当前汇率',
        status: 409,
      },
    )
    expectMapped(
      {
        code: '23503',
        constraint: 'exchange_rates_currency_id_fkey',
        detail: 'must-not-leak currency',
      },
      {
        code: 'CURRENCY_NOT_FOUND',
        message: '货币不存在',
        status: 404,
      },
    )
  })

  it('maps the fixed CNY database guard', () => {
    expectMapped(
      {
        code: 'P2010',
        meta: {
          database_error: {
            code: '23514',
            constraint: 'exchange_rates_currency_not_cny_check',
            message: 'must-not-leak SQL',
          },
        },
      },
      {
        code: 'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
        message: '人民币为固定基准币，不配置当前汇率',
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
      code: 'EXCHANGE_RATE_STATE_CHANGED',
      message: '当前汇率已变化，请刷新后重试',
      status: 409,
    })
  })

  it('preserves safe ApiException and fails closed for unknown errors', () => {
    const original = new ApiException(
      404,
      'EXCHANGE_RATE_NOT_FOUND',
      '当前汇率不存在',
    )
    expect(mapExchangeRatePersistenceError(original)).toBe(original)

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
