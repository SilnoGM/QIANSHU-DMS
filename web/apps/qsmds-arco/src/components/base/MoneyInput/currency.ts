import type { CurrencyCode } from '../AmountDisplay/format'
import { CURRENCY_SYMBOLS } from '../AmountDisplay/format'

export interface MoneyCurrencyOption {
  label: CurrencyCode
  value: CurrencyCode
}

export const DEFAULT_MONEY_CURRENCY: CurrencyCode = 'CNY'

/**
 * 币种集合只从 AmountDisplay 的符号映射派生，避免金额输入与金额展示分别维护枚举。
 * 选项标签使用稳定技术代码，确保紧凑下拉在中文、英文界面中都不会发生宽度跳变。
 */
export const MONEY_CURRENCY_OPTIONS: MoneyCurrencyOption[]
  = (Object.keys(CURRENCY_SYMBOLS) as CurrencyCode[]).map(currency => ({
    label: currency,
    value: currency,
  }))

/**
 * FaSelect 的公共值类型比 CurrencyCode 更宽。运行时只接收当前展示组件已支持的
 * 字符串币种，避免 undefined、数字或未来未知代码污染金额表单模型。
 */
export function isMoneyCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string'
    && Object.hasOwn(CURRENCY_SYMBOLS, value)
}

/**
 * 汇总组件只有在全部行币种一致时才能返回明确币种。空集合和混合币种都返回 null，
 * 由调用方分别提供空状态或“混合币种”提示，禁止借用首行币种伪装汇总结果。
 */
export function resolveCommonMoneyCurrency(
  currencies: readonly CurrencyCode[],
): CurrencyCode | null {
  const firstCurrency = currencies[0]
  if (!firstCurrency) {
    return null
  }

  return currencies.every(currency => currency === firstCurrency)
    ? firstCurrency
    : null
}
