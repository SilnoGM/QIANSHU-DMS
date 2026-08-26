import type { CurrencyAmountValue } from '../../../components/base/AmountDisplay/format'
import type { CurrencyDescriptor } from '../../../components/base/currency'

import Decimal from 'decimal.js'
import { formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export interface SalesOrderPaymentProgress {
  readonly formattedPercentage: string
  readonly progressValue: number
}

export interface SalesOrderCustomerCopySource {
  readonly customerName: string
  readonly customerPhone: string
  readonly customerFullAddress: string
}

export function buildSalesOrderCustomerCopyText(
  customer: SalesOrderCustomerCopySource,
): string {
  // 复制内容保持固定三行；只移除业务明确指定的“中国台湾”，不改变地址中的其他文字或空格。
  const copyAddress = customer.customerFullAddress.replaceAll('中国台湾', '')
  return [
    `客户姓名：${customer.customerName}`,
    `客户电话：${customer.customerPhone}`,
    `客户地址：${copyAddress}`,
  ].join('\n')
}

/**
 * 汇总矩阵已经以“币种”为行标题，因此金额单元格只保留符号与数值。
 * 复用 AmountDisplay 的精确十进制格式化后再移除末尾代码，避免另写一套舍入规则。
 */
export function formatSalesOrderSummaryAmount(
  value: CurrencyAmountValue,
  currency: string,
  currencies: readonly CurrencyDescriptor[],
): string {
  const formatted = formatCurrencyAmount(value, currency, currencies)
  const normalizedCurrency = currency.trim()
  const currencySuffix = ` ${normalizedCurrency}`

  return normalizedCurrency.length > 0 && formatted.endsWith(currencySuffix)
    ? formatted.slice(0, -currencySuffix.length)
    : formatted
}

/**
 * 根据累计已收和销售总价计算收款进度。真实比例允许超过 100%，但传给进度条的
 * number 只用于视觉展示并限制在 0 到 100，业务金额始终保留 Decimal 字符串边界。
 */
export function calculateSalesOrderPaymentProgress(
  receivedAmount: string | null,
  agreedTotalAmount: string | null,
): SalesOrderPaymentProgress | null {
  const receivedResult = validateMoneyString(receivedAmount, { precision: 4 })
  const totalResult = validateMoneyString(agreedTotalAmount, { precision: 4 })

  if (
    !receivedResult.valid
    || !totalResult.valid
    || receivedResult.normalizedValue === null
    || totalResult.normalizedValue === null
  ) {
    return null
  }

  const total = new Decimal(totalResult.normalizedValue)
  if (total.isZero()) {
    return null
  }

  const percentage = new Decimal(receivedResult.normalizedValue)
    .dividedBy(total)
    .times(100)
  return {
    formattedPercentage: `${percentage.toFixed(2, Decimal.ROUND_HALF_UP)}%`,
    progressValue: Decimal.min(percentage, 100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
  }
}
