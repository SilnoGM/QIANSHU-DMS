export const FUND_CALCULATION_ERROR_CODES = {
  AMOUNT_INVALID: 'FUND_AMOUNT_INVALID',
  SHARE_RATE_INVALID: 'FUND_SHARE_RATE_INVALID',
  POSTING_AMOUNT_INVALID: 'FUND_POSTING_AMOUNT_INVALID',
  POSTING_RULE_INVALID: 'FUND_POSTING_RULE_INVALID',
  ADJUSTMENT_MODE_INVALID: 'FUND_ADJUSTMENT_MODE_INVALID',
  REVERSAL_TARGET_INVALID: 'FUND_REVERSAL_TARGET_INVALID',
  REVERSAL_SNAPSHOT_INVALID: 'FUND_REVERSAL_SNAPSHOT_INVALID',
  REVERSAL_EXCEEDS_REMAINING: 'FUND_REVERSAL_EXCEEDS_REMAINING',
} as const

export type FundCalculationErrorCode =
  (typeof FUND_CALCULATION_ERROR_CODES)[keyof typeof FUND_CALCULATION_ERROR_CODES]

/**
 * 纯计算层只暴露稳定分类和固定中文消息，不携带原始输入。后续 HTTP/内部服务
 * 边界可以按 code 映射错误，同时避免金额、业务信息或幂等键进入异常日志。
 */
export class FundCalculationError extends Error {
  constructor(
    readonly code: FundCalculationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'FundCalculationError'
  }
}
