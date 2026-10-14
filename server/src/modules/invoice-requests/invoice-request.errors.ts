import { ApiException } from '../../infrastructure/http/api.exception'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { FundCalculationError } from '../fund-accounts/domain/fund-calculation.errors'
import { NumberingGenerationError } from '../numbering/numbering.errors'

/** 开票申请域内的失败出口：只抛带稳定错误码的业务异常。 */
export function invoiceRequestFailure(code: string, message: string, status = 422): never {
  throw new ApiException(status, code, message)
}

export const INVOICE_REQUEST_ERROR_CODES = {
  NOT_FOUND: 'INVOICE_REQUEST_NOT_FOUND',
  STATE_CHANGED: 'INVOICE_REQUEST_STATE_CHANGED',
  STATUS_NOT_ALLOWED: 'INVOICE_REQUEST_STATUS_NOT_ALLOWED',
  OWNER_ONLY: 'INVOICE_REQUEST_OWNER_ONLY',
  DUPLICATE_SUSPECTED: 'INVOICE_REQUEST_DUPLICATE_SUSPECTED',
  SETTLE_WAIT_PERIOD: 'INVOICE_REQUEST_SETTLE_WAIT_PERIOD',
  DOCUMENT_REQUIRED: 'INVOICE_REQUEST_DOCUMENT_REQUIRED',
  DOCUMENT_EXISTS: 'INVOICE_REQUEST_DOCUMENT_EXISTS',
  DOCUMENT_INVALID: 'INVOICE_REQUEST_DOCUMENT_INVALID',
  DOCUMENT_TOO_LARGE: 'INVOICE_REQUEST_DOCUMENT_TOO_LARGE',
  DOCUMENT_UNAVAILABLE: 'INVOICE_REQUEST_DOCUMENT_UNAVAILABLE',
  RATE_UNAVAILABLE: 'INVOICE_REQUEST_RATE_UNAVAILABLE',
  RATE_CHANGED: 'INVOICE_REQUEST_RATE_CHANGED',
  NUMBER_UNAVAILABLE: 'INVOICE_REQUEST_NUMBER_UNAVAILABLE',
  CONFLICT: 'INVOICE_REQUEST_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'INVOICE_REQUEST_IDEMPOTENCY_CONFLICT',
  POSTING_ACCOUNT_UNAVAILABLE: 'INVOICE_REQUEST_POSTING_ACCOUNT_UNAVAILABLE',
  POSTING_UNAVAILABLE: 'INVOICE_REQUEST_POSTING_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type InvoiceRequestErrorCode =
  (typeof INVOICE_REQUEST_ERROR_CODES)[keyof typeof INVOICE_REQUEST_ERROR_CODES]

/**
 * 「账户或比例还没配」的资金错误码：结算入账时统一提示去账户管理配置。
 * 与规则/来源本身不可用分开，避免把配置缺失说成系统故障。
 */
const FUND_ACCOUNT_CONFIGURATION_ERROR_CODES: ReadonlySet<string> = new Set([
  FUND_POSTING_ERROR_CODES.USER_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
  FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE,
  FUND_POSTING_ERROR_CODES.SHARE_RATE_INVALID,
  FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID,
])

/**
 * 持久化、编号与资金动账异常到域内错误码的映射。
 * 可重试的并发冲突与「提交标识被复用」必须给出不同错误码，前端才能区分「刷新重试」与「别用同一个键」。
 */
export function mapInvoiceRequestError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }
  if (error instanceof NumberingGenerationError) {
    return invoiceRequestFailure(
      INVOICE_REQUEST_ERROR_CODES.NUMBER_UNAVAILABLE,
      '申请单号暂时无法派发，请检查编号规则 INVOICE_REQUEST 后重试',
      409,
    )
  }
  if (error instanceof FundPostingError) {
    if (error.code === FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED) {
      return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.STATE_CHANGED, '资料已变化或正在处理，请刷新后重试', 409)
    }
    if (error.code === FUND_POSTING_ERROR_CODES.INTERNAL_ERROR) {
      return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.INTERNAL_ERROR, '资金服务内部错误', 500)
    }
    if (FUND_ACCOUNT_CONFIGURATION_ERROR_CODES.has(error.code)) {
      return invoiceRequestFailure(
        INVOICE_REQUEST_ERROR_CODES.POSTING_ACCOUNT_UNAVAILABLE,
        '申请人的资金账户未配置或未设置分成比例，请先在账户管理里配置后重试',
        409,
      )
    }
    return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.POSTING_UNAVAILABLE, '资金入账规则当前不可用，单据未结算', 409)
  }
  if (error instanceof FundCalculationError) {
    return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.POSTING_UNAVAILABLE, '当前金额无法按资金规则入账，单据未结算', 409)
  }
  const facts = readPersistenceErrorFacts(error)
  if (['P2002', '23505'].some(code => hasPersistenceCode(facts, code))) {
    return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.CONFLICT, '该申请单或编号已经存在，请刷新后重试', 409)
  }
  if (['P2034', '40001', '40P01', '55P03', '57014'].some(code => hasPersistenceCode(facts, code))) {
    return invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.STATE_CHANGED, '资料已变化或正在处理，请刷新后重试', 409)
  }
  throw error
}
