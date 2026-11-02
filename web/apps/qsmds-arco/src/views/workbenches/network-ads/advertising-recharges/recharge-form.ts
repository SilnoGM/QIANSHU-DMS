import type { AdvertisingRechargeStatus } from './logic'
import type { CurrencyDescriptor } from '@/components/base/currency'
import {
  ADVERTISING_RECHARGE_CURRENCY_OPTIONS,

} from './logic'

/**
 * 充值币种固定为美元与人民币两种，且都要可选：
 * 货币目录的 `enabled` 表达的是汇率可用性，不能拿它限制本业务的币种选择，
 * 因此在本地把这两个币种显式置为可选，其余目录字段仍取真实目录。
 */
export function resolveRechargeCurrencies(catalog: readonly CurrencyDescriptor[]): CurrencyDescriptor[] {
  const byCode = new Map(catalog.map(currency => [currency.code, currency]))
  return ADVERTISING_RECHARGE_CURRENCY_OPTIONS.map((code) => {
    const descriptor = byCode.get(code)
    return {
      code,
      enabled: true,
      minorUnit: descriptor?.minorUnit ?? 2,
      name: descriptor?.name ?? code,
      symbol: descriptor?.symbol ?? null,
    }
  })
}

/** 财务实付固定人民币；同样不受货币目录 enabled 影响。 */
export function resolvePaymentCurrencies(catalog: readonly CurrencyDescriptor[]): CurrencyDescriptor[] {
  const descriptor = catalog.find(currency => currency.code === 'CNY')
  return [{
    code: 'CNY',
    enabled: true,
    minorUnit: descriptor?.minorUnit ?? 2,
    name: descriptor?.name ?? 'CNY',
    symbol: descriptor?.symbol ?? null,
  }]
}

/** 运营列表与财务列表共用的状态计数归一：ALL 由各状态求和，避免多取一次列表。 */
export function sumAdvertisingRechargeCounts(
  counts: readonly { status: AdvertisingRechargeStatus, count: number }[],
): Record<string, number> {
  const result: Record<string, number> = {}
  let all = 0
  for (const entry of counts) {
    result[entry.status] = entry.count
    all += entry.count
  }
  result.ALL = all
  return result
}
