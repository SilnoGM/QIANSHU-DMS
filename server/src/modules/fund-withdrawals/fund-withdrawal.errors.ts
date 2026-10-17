import { HttpStatus } from '@nestjs/common'

import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { FundCalculationError } from '../fund-accounts/domain/fund-calculation.errors'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { NumberingGenerationError } from '../numbering/numbering.errors'

export function fundWithdrawalFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

export const FUND_WITHDRAWAL_ERROR_CODES = {
  NOT_FOUND: 'FUND_WITHDRAWAL_NOT_FOUND',
  STATE_CHANGED: 'FUND_WITHDRAWAL_STATE_CHANGED',
  STATUS_NOT_ALLOWED: 'FUND_WITHDRAWAL_STATUS_NOT_ALLOWED',
  VALIDATION_FAILED: 'FUND_WITHDRAWAL_VALIDATION_FAILED',
  AMOUNT_INVALID: 'FUND_WITHDRAWAL_AMOUNT_INVALID',
  ACCOUNT_UNAVAILABLE: 'FUND_WITHDRAWAL_ACCOUNT_UNAVAILABLE',
  PROOF_REQUIRED: 'FUND_WITHDRAWAL_PAYMENT_PROOF_REQUIRED',
  PROOF_INVALID: 'FUND_WITHDRAWAL_PAYMENT_PROOF_INVALID',
  PROOF_TOO_LARGE: 'FUND_WITHDRAWAL_PAYMENT_PROOF_TOO_LARGE',
  PROOF_UNAVAILABLE: 'FUND_WITHDRAWAL_PAYMENT_PROOF_UNAVAILABLE',
  NUMBER_UNAVAILABLE: 'FUND_WITHDRAWAL_NUMBER_UNAVAILABLE',
  POSTING_UNAVAILABLE: 'FUND_WITHDRAWAL_POSTING_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'FUND_WITHDRAWAL_IDEMPOTENCY_CONFLICT',
  CONFLICT: 'FUND_WITHDRAWAL_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type FundWithdrawalErrorCode =
  (typeof FUND_WITHDRAWAL_ERROR_CODES)[keyof typeof FUND_WITHDRAWAL_ERROR_CODES]

const ACCOUNT_CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  FUND_POSTING_ERROR_CODES.USER_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.SHARE_RATE_INVALID,
  FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID,
])

export function mapFundWithdrawalError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof NumberingGenerationError) {
    return fundWithdrawalFailure(
      FUND_WITHDRAWAL_ERROR_CODES.NUMBER_UNAVAILABLE,
      '提款申请单号暂时无法派发，请检查编号规则 FUND_WITHDRAWAL_NO 后重试',
      HttpStatus.CONFLICT,
    )
  }
  if (error instanceof FundPostingError) {
    if (error.code === FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED) {
      return fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.STATE_CHANGED,
        '资料已变化或正在处理，请刷新后重试',
        HttpStatus.CONFLICT,
      )
    }
    if (error.code === FUND_POSTING_ERROR_CODES.INTERNAL_ERROR) {
      return fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.INTERNAL_ERROR,
        '资金服务内部错误',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
    if (ACCOUNT_CONFIGURATION_CODES.has(error.code)) {
      return fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.ACCOUNT_UNAVAILABLE,
        '申请人的资金账户不可用，请先在账户管理中核对',
        HttpStatus.CONFLICT,
      )
    }
    return fundWithdrawalFailure(
      FUND_WITHDRAWAL_ERROR_CODES.POSTING_UNAVAILABLE,
      '资金扣款规则当前不可用，申请未通过',
      HttpStatus.CONFLICT,
    )
  }
  if (error instanceof FundCalculationError) {
    return fundWithdrawalFailure(
      FUND_WITHDRAWAL_ERROR_CODES.POSTING_UNAVAILABLE,
      '当前金额无法按资金规则扣款，申请未通过',
      HttpStatus.CONFLICT,
    )
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) {
    return fundWithdrawalFailure(
      FUND_WITHDRAWAL_ERROR_CODES.CONFLICT,
      '提款申请或编号已经存在，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    return fundWithdrawalFailure(
      FUND_WITHDRAWAL_ERROR_CODES.STATE_CHANGED,
      '资料已变化或正在处理，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  throw error
}
