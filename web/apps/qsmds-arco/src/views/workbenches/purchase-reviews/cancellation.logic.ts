import type { PurchaseOrderDetailDto } from '../../../api/generated/types.gen'
import Decimal from 'decimal.js'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

type Translate = (key: string, values?: Record<string, string | number>) => string

export function purchaseCancellationBlockReason(detail: Pick<PurchaseOrderDetailDto, 'orderStatus' | 'fulfillmentStatus' | 'paidAmount'>): 'status' | 'shipped' | 'paid' | 'amount' | null {
  if (detail.orderStatus !== 'CONFIRMED') {
    return 'status'
  }
  if (!['ORDERED', 'PREPARING'].includes(detail.fulfillmentStatus)) {
    return 'shipped'
  }
  const paid = validateMoneyString(detail.paidAmount, { precision: 4 })
  if (!paid.valid || paid.normalizedValue === null) {
    return 'amount'
  }
  return new Decimal(paid.normalizedValue).isZero() ? null : 'paid'
}

export function buildPurchaseCancellationText(detail: PurchaseOrderDetailDto, t: Translate): string {
  const text = (value: string | null | undefined) => value?.trim().replace(/\s+/gu, ' ') || t('purchaseReview.copy.notRecorded')
  const money = (value: string) => {
    const result = validateMoneyString(value, { precision: 4 })
    return result.valid && result.normalizedValue !== null
      ? new Decimal(result.normalizedValue).toFixed(2, Decimal.ROUND_HALF_UP)
      : t('purchaseReview.copy.notRecorded')
  }
  return [
    t('purchaseReview.cancellation.copyHeader', { orderNo: text(detail.orderNo), supplier: text(detail.supplier.label), orderDate: text(detail.orderDate) }),
    t('purchaseReview.cancellation.copyProducts', { products: [...detail.lines].sort((a, b) => a.lineNumber - b.lineNumber).map(line => text(line.productName)).join('+') || t('purchaseReview.detail.noProducts') }),
    // 复制服务端实际已付和未付汇总，不用约定定金、尾款替代，也不以浮点数重新计算。
    t('purchaseReview.cancellation.copyAmounts', { total: money(detail.amounts.purchaseTotalAmount), paid: money(detail.amounts.paidAmount), unpaid: money(detail.amounts.outstandingAmount) }),
  ].join('\n\n')
}
