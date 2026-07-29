import type { CurrencyDescriptor } from '../currency'
import { isCurrencyMinorUnit } from '../currency'

export interface MoneyCurrencyOption {
  disabled?: boolean
  label: string
  value: string
}

/**
 * FaSelect 在 modelValue 找不到对应选项时会展示第一项。以不可选择的哨兵项承接
 * null，确保“尚未选择币种”不会在视觉上被误报为第一个真实币种。
 */
export const EMPTY_MONEY_CURRENCY_VALUE = '__money_input_empty_currency__'

/**
 * 仅启用币种可用于新选择；当前值即使已经停用也必须保留为 disabled 选项，
 * 以便历史数据真实回显。未知当前值同样保留，但不得伪装成可选择币种。
 */
export function createMoneyCurrencyOptions(
  currencies: readonly CurrencyDescriptor[],
  currentCurrency: null | string,
): MoneyCurrencyOption[] {
  const options: MoneyCurrencyOption[] = [{
    disabled: true,
    label: '请选择币种',
    value: EMPTY_MONEY_CURRENCY_VALUE,
  }]
  const seenCodes = new Set<string>()
  let currentCurrencyFound = false

  for (const currency of currencies) {
    if (
      seenCodes.has(currency.code)
      || !isCurrencyMinorUnit(currency.minorUnit)
    ) {
      continue
    }

    seenCodes.add(currency.code)
    if (currency.code === currentCurrency) {
      currentCurrencyFound = true
    }

    if (currency.enabled) {
      options.push({
        label: currency.code,
        value: currency.code,
      })
    }
    else if (currency.code === currentCurrency) {
      options.push({
        disabled: true,
        label: `${currency.code}（已停用）`,
        value: currency.code,
      })
    }
  }

  if (currentCurrency && !currentCurrencyFound) {
    options.push({
      disabled: true,
      label: `${currentCurrency}（未知币种）`,
      value: currentCurrency,
    })
  }

  return options
}

/**
 * 汇总组件只有在全部行币种一致时才能返回明确币种。空集合和混合币种都返回 null，
 * 由调用方分别提供空状态或“混合币种”提示，禁止借用首行币种伪装汇总结果。
 */
export function resolveCommonMoneyCurrency(
  currencies: readonly (null | string)[],
): string | null {
  const firstCurrency = currencies[0]
  if (!firstCurrency) {
    return null
  }

  return currencies.every(currency => currency === firstCurrency)
    ? firstCurrency
    : null
}
