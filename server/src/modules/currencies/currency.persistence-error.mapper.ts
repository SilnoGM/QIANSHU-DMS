import { HttpStatus } from '@nestjs/common'

import {
  hasPersistenceCode,
  hasPersistenceConstraint,
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

export function mapCurrencyPersistenceError(error: unknown): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  const isUniqueViolation =
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')

  if (
    isUniqueViolation
    && (
      hasPersistenceTarget(facts, 'code')
      || hasPersistenceConstraint(facts, 'currencies_code_key')
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'CURRENCY_CODE_ALREADY_EXISTS',
      '货币编码已存在',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && hasPersistenceConstraint(
      facts,
      'currencies_exchange_rate_required_check',
    )
  ) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'CURRENCY_EXCHANGE_RATE_REQUIRED',
      '请先配置当前汇率再启用该货币',
    )
  }

  if (
    hasPersistenceCode(facts, '23514')
    && (
      hasPersistenceConstraint(facts, 'currencies_cny_shape_check')
      || hasPersistenceConstraint(facts, 'currencies_cny_delete_check')
    )
  ) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'BASE_CURRENCY_CANNOT_BE_DISABLED',
      '人民币为固定基准币，不能停用',
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
      'CURRENCY_STATE_CHANGED',
      '货币状态已变化，请刷新后重试',
    )
  }

  return mappedException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
