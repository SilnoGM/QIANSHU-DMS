import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
} from './application/fund-posting.errors'

const NOT_FOUND_CODES = new Set<FundPostingErrorCode>([
  FUND_POSTING_ERROR_CODES.USER_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.POSTING_BATCH_NOT_FOUND,
])

const CONFLICT_CODES = new Set<FundPostingErrorCode>([
  FUND_POSTING_ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
  FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.ACCOUNT_STATE_CHANGED,
  FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_DISABLED,
  FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_CODE_ALREADY_EXISTS,
  FUND_POSTING_ERROR_CODES.POSTING_TYPE_DISABLED,
  FUND_POSTING_ERROR_CODES.POSTING_TYPE_CODE_ALREADY_EXISTS,
  FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED,
  FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.CONFIG_STATE_CHANGED,
  FUND_POSTING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  FUND_POSTING_ERROR_CODES.REVERSAL_STATE_CHANGED,
  FUND_POSTING_ERROR_CODES.REVERSAL_REQUIRES_RECEIPT_VOID,
  FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED,
])

function statusForFundError(code: FundPostingErrorCode): HttpStatus {
  if (NOT_FOUND_CODES.has(code)) return HttpStatus.NOT_FOUND
  if (CONFLICT_CODES.has(code)) return HttpStatus.CONFLICT
  if (
    code === FUND_POSTING_ERROR_CODES.INTERNAL_ERROR
    || code === FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID
  ) {
    return HttpStatus.INTERNAL_SERVER_ERROR
  }
  return HttpStatus.UNPROCESSABLE_ENTITY
}

/**
 * 资金应用层不依赖 HTTP；只有 Controller 边界在这里把稳定领域错误翻译为 API。
 * 未知异常和损坏的历史快照统一失败关闭，不把 SQL、payload 或底层 message 暴露出去。
 */
export function mapFundHttpError(error: unknown): ApiException {
  if (error instanceof ApiException) return error
  if (!(error instanceof FundPostingError)) {
    return new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FUND_POSTING_ERROR_CODES.INTERNAL_ERROR,
      '资金服务内部错误',
    )
  }

  const status = statusForFundError(error.code)
  const publicCode = error.code === FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID
    ? FUND_POSTING_ERROR_CODES.INTERNAL_ERROR
    : error.code
  return new ApiException(
    status,
    publicCode,
    status === HttpStatus.INTERNAL_SERVER_ERROR
      ? '资金服务内部错误'
      : error.message,
    error.field === undefined ? undefined : { [error.field]: [error.message] },
  )
}

export async function executeFundHttpOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    throw mapFundHttpError(error)
  }
}
