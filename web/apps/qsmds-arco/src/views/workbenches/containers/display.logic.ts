import Decimal from 'decimal.js'

/** 仅格式化展示，不回写尺寸、重量及材积，计费仍使用服务端原始精度。 */
export function formatContainerMeasurement(value: string | null, places: 0 | 2): string | null {
  return value === null ? null : new Decimal(value).toFixed(places, Decimal.ROUND_HALF_UP)
}
