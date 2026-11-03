import { HttpStatus } from '@nestjs/common'

import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../fund-accounts/domain/fund-calculation.errors'
import { NumberingGenerationError } from '../numbering/numbering.errors'

export function advertisingRechargeFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

export const ADVERTISING_RECHARGE_ERROR_CODES = {
  NOT_FOUND: 'ADVERTISING_RECHARGE_NOT_FOUND',
  STATE_CHANGED: 'ADVERTISING_RECHARGE_STATE_CHANGED',
  STATUS_NOT_ALLOWED: 'ADVERTISING_RECHARGE_STATUS_NOT_ALLOWED',
  VALIDATION_FAILED: 'ADVERTISING_RECHARGE_VALIDATION_FAILED',
  AMOUNT_INVALID: 'ADVERTISING_RECHARGE_AMOUNT_INVALID',
  ACCOUNT_UNAVAILABLE: 'ADVERTISING_RECHARGE_ACCOUNT_UNAVAILABLE',
  QR_REQUIRED: 'ADVERTISING_RECHARGE_QR_REQUIRED',
  QR_INVALID: 'ADVERTISING_RECHARGE_QR_INVALID',
  QR_TOO_LARGE: 'ADVERTISING_RECHARGE_QR_TOO_LARGE',
  QR_UNAVAILABLE: 'ADVERTISING_RECHARGE_QR_UNAVAILABLE',
  PROOF_INVALID: 'ADVERTISING_RECHARGE_PROOF_INVALID',
  PROOF_REQUIRED: 'ADVERTISING_RECHARGE_PROOF_REQUIRED',
  PROOF_TOO_LARGE: 'ADVERTISING_RECHARGE_PROOF_TOO_LARGE',
  PROOF_UNAVAILABLE: 'ADVERTISING_RECHARGE_PROOF_UNAVAILABLE',
  NUMBER_UNAVAILABLE: 'ADVERTISING_RECHARGE_NUMBER_UNAVAILABLE',
  POSTING_UNAVAILABLE: 'ADVERTISING_RECHARGE_POSTING_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'ADVERTISING_RECHARGE_IDEMPOTENCY_CONFLICT',
  CONFLICT: 'ADVERTISING_RECHARGE_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type AdvertisingRechargeErrorCode =
  (typeof ADVERTISING_RECHARGE_ERROR_CODES)[keyof typeof ADVERTISING_RECHARGE_ERROR_CODES]

const ACCOUNT_CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  FUND_POSTING_ERROR_CODES.USER_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.SHARE_RATE_INVALID,
  FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID,
])

/**
 * 把资金域错误翻译成广告充值可读提示：账户/比例不可用与规则停用都要能让人立刻知道
 * 下一步找谁处理，而不是只拿到一个笼统的 500。
 */
export function mapAdvertisingRechargeError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof NumberingGenerationError) {
    return advertisingRechargeFailure(
      ADVERTISING_RECHARGE_ERROR_CODES.NUMBER_UNAVAILABLE,
      '充值申请单号暂时无法派发，请检查编号规则 ADVERTISING_RECHARGE_NO 后重试',
      HttpStatus.CONFLICT,
    )
  }
  if (error instanceof FundPostingError) {
    if (error.code === FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED) {
      return advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.STATE_CHANGED,
        '资料已变化或正在处理，请刷新后重试',
        HttpStatus.CONFLICT,
      )
    }
    if (error.code === FUND_POSTING_ERROR_CODES.INTERNAL_ERROR) {
      return advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.INTERNAL_ERROR,
        '资金服务内部错误',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
    if (ACCOUNT_CONFIGURATION_CODES.has(error.code)) {
      return advertisingRechargeFailure(
        ADVERTISING_RECHARGE_ERROR_CODES.ACCOUNT_UNAVAILABLE,
        '申请人的资金账户或分成比例不可用，请先在账户管理中核对',
        HttpStatus.CONFLICT,
      )
    }
    return advertisingRechargeFailure(
      ADVERTISING_RECHARGE_ERROR_CODES.POSTING_UNAVAILABLE,
      '资金分摊规则当前不可用，付款未完成',
      HttpStatus.CONFLICT,
    )
  }
  if (error instanceof FundCalculationError) {
    return advertisingRechargeFailure(
      ADVERTISING_RECHARGE_ERROR_CODES.POSTING_UNAVAILABLE,
      '当前金额无法按广告投放费用规则分摊，付款未完成',
      HttpStatus.CONFLICT,
    )
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) {
    return advertisingRechargeFailure(
      ADVERTISING_RECHARGE_ERROR_CODES.CONFLICT,
      '充值申请或编号已经存在，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    return advertisingRechargeFailure(
      ADVERTISING_RECHARGE_ERROR_CODES.STATE_CHANGED,
      '资料已变化或正在处理，请刷新后重试',
      HttpStatus.CONFLICT,
    )
  }
  throw error
}
