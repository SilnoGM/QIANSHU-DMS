import Decimal from 'decimal.js'

/** 仅格式化展示，不回写尺寸、重量及材积，计费仍使用服务端原始精度。 */
export function formatContainerMeasurement(value: string | null, places: 0 | 2): string | null {
  if (value === null) {
    return null
  }
  const rounded = new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP)
  return (rounded.isZero() ? new Decimal(0) : rounded).toFixed(places)
}

/**
 * 毛重只读展示按有效数位：180.00 → 180、180.50 → 180.5。
 * 编辑输入仍显示两位小数，计费与落库口径不变。
 */
export function formatContainerWeight(value: string | null): string | null {
  const formatted = formatContainerMeasurement(value, 2)
  return formatted === null ? null : formatted.replace(/\.?0+$/u, '')
}
