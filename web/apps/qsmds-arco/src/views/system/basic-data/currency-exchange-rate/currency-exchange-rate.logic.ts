import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export type CurrencyExchangeRateTab = 'currencies' | 'exchange-rates'

export interface CurrencyExchangeRateAccess {
  canReadCurrencies: boolean
  canReadExchangeRates: boolean
}

export interface CurrencyExchangeRateTabItem {
  icon: string
  label: string
  value: CurrencyExchangeRateTab
}

const TAB_ITEMS: readonly CurrencyExchangeRateTabItem[] = [
  {
    icon: 'i-lucide:coins',
    label: '货币管理',
    value: 'currencies',
  },
  {
    icon: 'i-lucide:arrow-left-right',
    label: '当前汇率',
    value: 'exchange-rates',
  },
]

/**
 * 页面入口采用 any-of 读取权限，Tab 列表仍按各自领域权限独立收敛。
 * 这可以让只负责汇率的账号进入同一菜单，同时不会暴露货币列表内容。
 */
export function buildCurrencyExchangeRateTabs(
  access: CurrencyExchangeRateAccess,
): CurrencyExchangeRateTabItem[] {
  return TAB_ITEMS.filter((tab) => {
    return tab.value === 'currencies'
      ? access.canReadCurrencies
      : access.canReadExchangeRates
  })
}

/**
 * query 只能选择当前身份可读的 Tab。权限在运行期撤销时，调用方也复用该规则
 * 自动回落到第一个可读区域，避免旧面板在新身份下继续保留。
 */
export function resolveCurrencyExchangeRateTab(
  requestedTab: unknown,
  access: CurrencyExchangeRateAccess,
): CurrencyExchangeRateTab | null {
  const tabs = buildCurrencyExchangeRateTabs(access)
  const requested = tabs.find(tab => tab.value === requestedTab)
  return requested?.value ?? tabs[0]?.value ?? null
}

/**
 * 货币管理使用无 tab 参数的规范地址；当前汇率显式写入 query，确保刷新、
 * 收藏和旧路由重定向后仍能恢复正确业务区域。
 */
export function buildCurrencyExchangeRateQuery(
  currentQuery: LocationQuery | LocationQueryRaw,
  tab: CurrencyExchangeRateTab,
): LocationQueryRaw {
  const nextQuery: LocationQueryRaw = { ...currentQuery }
  if (tab === 'currencies') {
    delete nextQuery.tab
  }
  else {
    nextQuery.tab = 'exchange-rates'
  }
  return nextQuery
}
