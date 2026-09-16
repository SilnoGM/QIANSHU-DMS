import type { PurchaseOrderDetailDto } from '../../../api/generated/types.gen'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

type Translate = (key: string, values?: Record<string, string | number>) => string

export function buildPurchaseOrderCopyText(detail: PurchaseOrderDetailDto, t: Translate): string {
  const text = (value: string | null | undefined, fallback = t('purchaseReview.copy.notRecorded')) => value?.trim().replace(/\s+/gu, ' ') || fallback
  const money = (value: string) => {
    const result = validateMoneyString(value, { precision: 4 })
    if (!result.valid || result.normalizedValue === null) {
      return t('purchaseReview.copy.notRecorded')
    }
    // 保留实际单价的四位有效精度，金额全程使用十进制字符串，避免大额转浮点数丢精度。
    const [integer, fraction = ''] = result.normalizedValue.split('.')
    return `${integer}.${fraction.replace(/0+$/u, '').padEnd(2, '0')}`
  }
  const lines = [...detail.lines].sort((a, b) => a.lineNumber - b.lineNumber)
  const products = new Map(lines.map(line => [line.id, text(line.productName)]))
  const lineText = lines.map(line => t('purchaseReview.copy.line', {
    productName: text(line.productName),
    quantity: line.quantity,
    unitPrice: money(line.actualPurchaseUnitPriceAmount),
    subtotal: money(line.lineTotalAmount),
  })).join('\n\n') || t('purchaseReview.detail.noProducts')
  // 只给当前有效货件提供贴标信息；复制不派发编号或唛头，也不推断尚未生成的值。
  const partsText = detail.parts.filter(part => part.status !== 'CANCELLED')
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(part => t('purchaseReview.copy.part', {
      partLabel: t('purchaseReview.copy.partLabel', { number: String(part.partNumber).padStart(2, '0') }),
      products: [...part.items].sort((a, b) => a.lineNumber - b.lineNumber).map(item => products.get(item.purchaseOrderLineId) || t('purchaseReview.copy.productUnavailable')).join('+') || t('purchaseReview.copy.productUnavailable'),
      shippingMark: text(part.shippingMarkText, t('purchaseReview.copy.pendingMark')),
    }))
    .join('\n\n') || t('purchaseReview.copy.noParts')

  return [
    t('purchaseReview.copy.header', {
      orderNo: text(detail.orderNo),
      supplier: text(detail.supplier.label),
      orderDate: text(detail.orderDate),
    }),
    `${t('purchaseReview.copy.productsTitle')}\n${lineText}`,
    t('purchaseReview.copy.amounts', {
      total: money(detail.amounts.purchaseTotalAmount),
      deposit: money(detail.amounts.depositDueAmount),
      balance: money(detail.amounts.balanceDueAmount),
    }),
    `${t('purchaseReview.copy.shippingTitle')}\n${partsText}`,
  ].join('\n\n')
}
