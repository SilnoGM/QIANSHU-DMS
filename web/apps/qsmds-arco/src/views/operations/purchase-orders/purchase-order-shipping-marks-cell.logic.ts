import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'

/** 只消费已存字段：基础唛头优先，历史独立货件码不反推基础码，也不由内部序号重算。 */
export function getPurchaseOrderShippingMarksSummary(order: Pick<PurchaseOrderListItemDto, 'shippingMarks' | 'shippingMarkText'> & Partial<Pick<PurchaseOrderListItemDto, 'orderStatus'>>) {
  const marks = [...order.shippingMarks]
  const baseMark = order.shippingMarkText
  const primaryMark = baseMark ?? marks[0] ?? null
  return {
    marks,
    baseMark,
    primaryMark,
    // 单货件同码仅展示一次；历史上不同的基础码和货件码仍可分别核对。
    showPartMarks: marks.length > 0 && !(marks.length === 1 && (baseMark === null || marks[0] === baseMark)),
    pending: primaryMark === null && order.orderStatus === 'PENDING_REVIEW',
    additionalCount: Math.max(0, marks.length - 1),
    copyText: marks.join('\n'),
  }
}
