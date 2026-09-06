import type { PurchaseOrderAmountRevisionDto, PurchaseOrderDetailDto, PurchaseOrderDocumentDto, PurchaseOrderStatusHistoryDto } from '@/api/generated/types.gen'

/** 采购付款允许不上传凭证；只按付款 ID 关联，不依赖数组顺序或名称。 */
export function getPaymentDocuments(documents: readonly PurchaseOrderDocumentDto[], paymentId: string): PurchaseOrderDocumentDto[] {
  return documents.filter(document => document.paymentId === paymentId)
}

export function getOrderDocuments(documents: readonly PurchaseOrderDocumentDto[]): PurchaseOrderDocumentDto[] {
  return documents.filter(document => document.documentType !== 'PAYMENT_VOUCHER' && document.detachedAt === null)
}

export type PurchaseOrderTimelineEntry
  = | { key: string, kind: 'status', record: PurchaseOrderStatusHistoryDto }
    | { key: string, kind: 'amount', record: PurchaseOrderAmountRevisionDto }

/** 只展示已持久化状态与金额历史，不从当前订单快照推测变更。 */
export function buildPurchaseOrderTimeline(detail: Pick<PurchaseOrderDetailDto, 'statusHistory' | 'amountRevisions'>): PurchaseOrderTimelineEntry[] {
  const entries: PurchaseOrderTimelineEntry[] = [
    ...detail.statusHistory.map(record => ({ key: `status-${record.id}`, kind: 'status' as const, record })),
    ...detail.amountRevisions.map(record => ({ key: `amount-${record.id}`, kind: 'amount' as const, record })),
  ]
  return entries.sort((a, b) => Date.parse(b.record.changedAt) - Date.parse(a.record.changedAt) || a.key.localeCompare(b.key))
}

export function revisionAmounts(revision: PurchaseOrderAmountRevisionDto) {
  return [
    { label: 'lineSubtotalAmount', before: revision.oldLineSubtotalAmount, after: revision.newLineSubtotalAmount },
    { label: 'purchaseTotalAmount', before: revision.oldPurchaseTotalAmount, after: revision.newPurchaseTotalAmount },
    { label: 'depositDueAmount', before: revision.oldDepositDueAmount, after: revision.newDepositDueAmount },
    { label: 'balanceDueAmount', before: revision.oldBalanceDueAmount, after: revision.newBalanceDueAmount },
  ]
}

/** 详情已携带同单授权主图，按采购行 ID 匹配，避免旧列表图片或同名产品串图。 */
export function getPurchaseProductImages(detail: PurchaseOrderDetailDto): Map<string, string | undefined> {
  return new Map(detail.lineSummary.previews.map(preview => [preview.lineId, preview.mainImage?.contentUrl]))
}
