import type { PurchaseOrderDetailDto, PurchaseOrderDocumentDto, PurchaseOrderStatusHistoryDto } from '@/api/generated/types.gen'

/** 采购付款允许不上传凭证；只按付款 ID 关联，不依赖数组顺序或名称。 */
export function getPaymentDocuments(documents: readonly PurchaseOrderDocumentDto[], paymentId: string): PurchaseOrderDocumentDto[] {
  return documents.filter(document => document.paymentId === paymentId)
}

/** 只展示已持久化状态历史，不从当前订单快照推测金额或内容变更。 */
export function buildPurchaseOrderTimeline(history: readonly PurchaseOrderStatusHistoryDto[]): PurchaseOrderStatusHistoryDto[] {
  return [...history].sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || a.id.localeCompare(b.id))
}

/** 详情已携带同单授权主图，按采购行 ID 匹配，避免旧列表图片或同名产品串图。 */
export function getPurchaseProductImages(detail: PurchaseOrderDetailDto): Map<string, string | undefined> {
  return new Map(detail.lineSummary.previews.map(preview => [preview.lineId, preview.mainImage?.contentUrl]))
}
