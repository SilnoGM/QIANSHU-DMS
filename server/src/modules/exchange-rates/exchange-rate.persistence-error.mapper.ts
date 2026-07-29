import { HttpStatus } from '@nestjs/common'

import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceFieldName,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'

function mappedException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

export function mapExchangeRatePersistenceError(
  error: unknown,
): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  const isUniqueViolation =
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
  const isForeignKeyViolation =
    hasPersistenceCode(facts, 'P2003')
    || hasPersistenceCode(facts, '23503')

  if (
    isUniqueViolation
    && (
      hasPersistenceTarget(facts, 'currency_id')
      || hasPersistenceConstraint(
        facts,
        'exchange_rates_currency_id_key',
      )
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'EXCHANGE_RATE_ALREADY_EXISTS',
      '该货币已配置当前汇率',
    )
  }

  if (
    isForeignKeyViolation
    && (
      hasPersistenceTarget(facts, 'currency_id')
      || hasPersistenceConstraint(
        facts,
        'exchange_rates_currency_id_fkey',
      )
      || hasPersistenceFieldName(
        facts,
        /^exchange_rates_currency_id_fkey(?:\s+\(index\))?$/u,
      )
    )
  ) {
    return mappedException(
      HttpStatus.NOT_FOUND,
      'CURRENCY_NOT_FOUND',
      '货币不存在',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && hasPersistenceConstraint(
      facts,
      'exchange_rates_currency_not_cny_check',
    )
  ) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
      '人民币为固定基准币，不配置当前汇率',
    )
  }

  if (
    hasPersistenceCode(facts, 'P2034')
    || hasPersistenceCode(facts, '40001')
    || hasPersistenceCode(facts, '40P01')
    || hasPersistenceCode(facts, '55P03')
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'EXCHANGE_RATE_STATE_CHANGED',
      '当前汇率已变化，请刷新后重试',
    )
  }

  return mappedException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
