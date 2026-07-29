export type CurrencyMinorUnit = 0 | 1 | 2 | 3 | 4

/**
 * 金额基础组件消费的中立币种描述符。
 *
 * 这里故意不包含数据库 id、汇率或权限等业务字段，API DTO 应由页面或 Store
 * 映射后再传入基础组件，避免基础组件反向依赖货币目录的实现方式。
 */
export interface CurrencyDescriptor {
  code: string
  enabled: boolean
  minorUnit: CurrencyMinorUnit
  name: string
  symbol: null | string
}

export function isCurrencyMinorUnit(value: unknown): value is CurrencyMinorUnit {
  return Number.isInteger(value)
    && typeof value === 'number'
    && value >= 0
    && value <= 4
}

/**
 * 运行时数据可能绕过 TypeScript，因此查找时同时守住 minorUnit 的有效范围。
 * 找不到或描述符不合法时返回 null，由展示组件执行明确的未知币种降级。
 */
export function findCurrencyDescriptor(
  currencies: readonly CurrencyDescriptor[],
  code: null | string | undefined,
): CurrencyDescriptor | null {
  if (typeof code !== 'string' || code.length === 0) {
    return null
  }

  return currencies.find(currency => (
    currency.code === code
    && isCurrencyMinorUnit(currency.minorUnit)
  )) ?? null
}
