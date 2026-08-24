import type { CurrencyAmountValue } from '../../../components/base/AmountDisplay/format'
import type { CurrencyDescriptor } from '../../../components/base/currency'

import { formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'

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
