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
export function getPurchaseProductImages(detail: Pick<PurchaseOrderDetailDto, 'lineSummary'>): Map<string, string | undefined> {
  return new Map(detail.lineSummary.previews.map(preview => [preview.lineId, preview.mainImage?.contentUrl]))
}

/**
 * 货件只关联产品快照并展示本件分配数量；订单金额继续由原采购行汇总，不能随拆件重复计入。
 * 历史订单 parts 为空时保持为空，不根据旧唛头或采购行推测历史分件。
 */
export function getPurchaseOrderPartRecords(detail: Pick<PurchaseOrderDetailDto, 'parts' | 'lines' | 'lineSummary'>) {
  const linesById = new Map(detail.lines.map(line => [line.id, line]))
  const imagesByLine = getPurchaseProductImages(detail)
  return [...detail.parts].sort((a, b) => a.partNumber - b.partNumber).map(part => ({
    id: part.id,
    shipmentNo: part.shipmentNo,
    partNumber: part.partNumber,
    status: part.status,
    shippingMarkText: part.shippingMarkText,
    shippedAt: part.shippedAt,
    shippedBy: part.shippedBy,
    shipmentRecordedAt: part.shipmentRecordedAt,
    shipmentRemark: part.shipmentRemark,
    warehouseReceivedAt: part.warehouseReceivedAt,
    warehouseReceivedBy: part.warehouseReceivedBy,
    warehouseRecordedAt: part.warehouseRecordedAt,
    warehouseRemark: part.warehouseRemark,
    items: [...part.items].sort((a, b) => a.lineNumber - b.lineNumber).map((item) => {
      const line = linesById.get(item.purchaseOrderLineId)
      return {
        purchaseOrderLineId: item.purchaseOrderLineId,
        lineNumber: item.lineNumber,
        quantity: item.quantity,
        productNo: line?.productNo ?? null,
        productName: line?.productName ?? null,
        description: line?.description ?? null,
        imageSrc: imagesByLine.get(item.purchaseOrderLineId),
      }
    }),
  }))
}
