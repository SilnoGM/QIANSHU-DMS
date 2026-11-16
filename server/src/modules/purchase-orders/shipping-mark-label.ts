/**
 * 贴标后缀在采购单图片、前端复制文案和对账单中必须逐字一致：去首尾空白、折叠内部空白，
 * 缺项不留分隔符。这里只做归一化，字段类型校验由各调用方的必填/选填规则负责。
 */
export function normalizeShippingMarkLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

/** STOCK 采购单没有销售单，用固定标记保证每行唛头都是「【货件唛头】后缀」的完整格式。 */
export const STOCK_SHIPPING_MARK_SUFFIX = '公司囤货采购'

export interface ShippingMarkSuffixSource {
  readonly issuerPrefix: string | null
  readonly customerName: string | null
}

function joinShippingMarkSuffix(source: ShippingMarkSuffixSource | null): string {
  return [
    normalizeShippingMarkLabel(source?.issuerPrefix ?? ''),
    normalizeShippingMarkLabel(source?.customerName ?? ''),
  ].filter(Boolean).join('-')
}

export function buildShippingMarkSuffix(
  purchaseType: 'SALES_LINKED' | 'STOCK',
  source: ShippingMarkSuffixSource | null,
): string {
  return purchaseType === 'STOCK' ? STOCK_SHIPPING_MARK_SUFFIX : joinShippingMarkSuffix(source)
}

/** 括号只包住货件唛头，后缀在括号外；与采购单图片的贴标文案完全一致。 */
export function formatShippingMark(shippingMarkText: string, suffix: string): string {
  return `【${shippingMarkText}】${suffix}`
}
