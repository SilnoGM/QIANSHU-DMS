/**
 * 采购备注在文本通道和图片内联位置必须压成单行：拆行、去首尾空白、
 * 折叠行内空白、丢弃空行后用全角分号连接。
 *
 * 图片产品明细块的独立「备注：」行保留原始换行，不走这里。
 */
export function flattenPurchaseOrderRemark(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }
  return value
    .split(/\r?\n/u)
    .map(line => line.trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .join('；')
}
