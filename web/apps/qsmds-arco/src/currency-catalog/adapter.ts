import type { CurrencyCatalogItem } from './types'
import type { CurrencyDescriptor } from '@/components/base/currency'

/**
 * 把可信目录映射为金额基础组件的最小公共契约。
 *
 * 这里保留停用币种：输入组件会禁止新选择停用项，但仍需显示已有记录的币种；
 * 展示组件也必须能解析历史业务数据，不能因停用而回退为未知货币。
 */
export function toCurrencyDescriptors(
  catalog: readonly CurrencyCatalogItem[],
): readonly CurrencyDescriptor[] {
  return Object.freeze(catalog.map(item => Object.freeze({
    code: item.code,
    enabled: item.enabled,
    minorUnit: item.minorUnit,
    name: item.name,
    symbol: item.symbol,
  } satisfies CurrencyDescriptor)))
}
