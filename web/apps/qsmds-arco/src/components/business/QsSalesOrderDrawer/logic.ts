import type { SalesOrderAmountRevisionDto, SalesOrderDetailDto, SalesOrderDocumentDto, SalesOrderStatusHistoryDto } from '@/api/generated/types.gen'

export type SalesOrderTimelineEntry
  = | { key: string, kind: 'status', record: SalesOrderStatusHistoryDto }
    | { key: string, kind: 'amount', record: SalesOrderAmountRevisionDto }

/** 收款凭证只随其收款记录展示；解除关联的订单凭证不再提供预览。 */
export function getOrderDocuments(documents: readonly SalesOrderDocumentDto[]): SalesOrderDocumentDto[] {
  return documents.filter(document => document.documentType !== 'PAYMENT_VOUCHER' && document.detachedAt === null)
}

/** 仅聚合服务端已经持久化的历史，不通过当前内容推测不存在的修改记录。 */
export function buildSalesOrderTimeline(
  detail: Pick<SalesOrderDetailDto, 'statusHistory' | 'amountRevisions'>,
): SalesOrderTimelineEntry[] {
  const entries: SalesOrderTimelineEntry[] = [
    ...detail.statusHistory.map(record => ({ key: `status-${record.id}`, kind: 'status' as const, record })),
    ...detail.amountRevisions.map(record => ({ key: `amount-${record.id}`, kind: 'amount' as const, record })),
  ]
  return entries.sort((a, b) => Date.parse(b.record.changedAt) - Date.parse(a.record.changedAt) || a.key.localeCompare(b.key))
}

export function revisionAmounts(revision: SalesOrderAmountRevisionDto) {
  return [
    { label: 'lineSubtotalAmount', before: revision.oldLineSubtotalAmount, after: revision.newLineSubtotalAmount },
    { label: 'salesTotal', before: revision.oldAgreedTotalAmount, after: revision.newAgreedTotalAmount },
    { label: 'deposit', before: revision.oldDepositDueAmount, after: revision.newDepositDueAmount },
    { label: 'balance', before: revision.oldBalanceDueAmount, after: revision.newBalanceDueAmount },
  ]
}
