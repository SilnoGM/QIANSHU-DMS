import { validateMoneyString } from '../../../../components/base/MoneyInput/logic'

export type WithdrawalAmountError = 'invalid' | 'required'

export type WithdrawalAmountValidation
  = | { amount: string, valid: true }
    | { error: WithdrawalAmountError, valid: false }

/** 最小正数按币种精度推导；CNY 两位小数时为 0.01。 */
export function minimumWithdrawalAmount(precision: number): string {
  return precision === 0
    ? '1'
    : `0.${'0'.repeat(Math.max(0, precision - 1))}1`
}

/**
 * 提款金额必须严格大于 0；空值与格式/精度错误分开返回，页面据此选择提示文案。
 */
export function validateWithdrawalAmount(
  value: string | null,
  precision: number,
): WithdrawalAmountValidation {
  if (value === null || value.trim().length === 0) {
    return { error: 'required', valid: false }
  }

  const result = validateMoneyString(value, {
    min: minimumWithdrawalAmount(precision),
    precision,
  })
  return result.valid && result.normalizedValue !== null
    ? { amount: result.normalizedValue, valid: true }
    : { error: 'invalid', valid: false }
}
