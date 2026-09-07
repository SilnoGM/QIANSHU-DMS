import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'

/** 服务端按货件编号提供顺序；保留每件原文，不去重，也不把历史单唛头合成为货件。 */
export function getPurchaseOrderShippingMarksSummary(order: Pick<PurchaseOrderListItemDto, 'shippingMarks' | 'shippingMarkText'>) {
  const marks = [...order.shippingMarks]
  return {
    marks,
    firstMark: marks[0] ?? null,
    additionalCount: Math.max(0, marks.length - 1),
    copyText: marks.join('\n'),
    legacyMark: marks.length === 0 ? order.shippingMarkText : null,
  }
}
