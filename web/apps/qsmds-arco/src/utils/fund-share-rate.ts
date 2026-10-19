import Decimal from 'decimal.js'

/**
 * 与服务端 `FUND_SHARE_RATE_INPUT_PATTERN` 保持一致：0–100、最多两位小数。
 * 前端只做输入拦截；最终存储和分账仍以服务端规范化为准。
 */
const FUND_SHARE_RATE_PATTERN
  = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/u

/**
 * 资金域的定点计算配置。独立 clone 防止修改 decimal.js 全局配置，同时为
 * 最大金额分账和余额相加保留充足精度。
 */
export const FundDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
})

export function parseFundShareRate(value: string): Decimal {
  if (!FUND_SHARE_RATE_PATTERN.test(value)) {
    throw new RangeError('资金分成比例无效')
  }

  const shareRate = new FundDecimal(value)
  if (shareRate.greaterThan(100)) {
    throw new RangeError('资金分成比例无效')
  }
  return shareRate
}

export function normalizeFundShareRate(value: string): string {
  return parseFundShareRate(value).toFixed(2)
}
