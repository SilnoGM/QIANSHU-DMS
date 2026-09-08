import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'

export type PurchaseOrderRecordsKind = 'payments' | 'documents' | 'changes'
export type PurchaseOrderRecordCounts = Pick<PurchaseOrderListItemDto, 'paymentRecordSummary' | 'documentSummary' | 'changeSummary'>

export const PURCHASE_ORDER_RECORD_ICONS = {
  payments: 'i-lucide:hand-coins',
  documents: 'i-lucide:files',
  changes: 'i-lucide:history',
} as const

/** 入口展示历史总数，不把有效付款金额口径混入记录浏览数量。 */
export function getPurchaseOrderRecordCount(kind: PurchaseOrderRecordsKind, order: PurchaseOrderRecordCounts): number {
  if (kind === 'payments') {
    return order.paymentRecordSummary.totalCount
  }
  if (kind === 'documents') {
    return order.documentSummary.count
  }
  return order.changeSummary.statusCount + order.changeSummary.amountCount
}
