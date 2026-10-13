import type { SalesOrderAmountRevisionDto, SalesOrderCompletionHoldDto, SalesOrderDetailDto, SalesOrderDocumentDto, SalesOrderStatusHistoryDto } from '@/api/generated/types.gen'

export type SalesOrderTimelineEntry
  = | { key: string, kind: 'status', record: SalesOrderStatusHistoryDto }
    | { key: string, kind: 'amount', record: SalesOrderAmountRevisionDto }

/**
 * 停留原因（完成判定见自动状态服务，口径 R3）到文案的描述：标签与解释分开给 i18n 键，
 * 「对账进行中」按是否还有未核对行选两套解释模板；计数只进解释，不进标签。
 */
export interface SalesOrderCompletionHoldDescription {
  readonly labelKey: string
  readonly hintKey: string
  readonly hintParams: Readonly<Record<string, number>>
}

export function describeCompletionHold(
  hold: SalesOrderCompletionHoldDto | null,
): SalesOrderCompletionHoldDescription | null {
  if (hold === null) {
    return null
  }
  if (hold.reason === 'PAYMENT_INCOMPLETE') {
    return {
      labelKey: 'salesOrderDrawer.completionHolds.PAYMENT_INCOMPLETE',
      hintKey: 'salesOrderDrawer.completionHolds.PAYMENT_INCOMPLETE_HINT',
      hintParams: {},
    }
  }
  if (hold.reason === 'RECONCILIATION_IN_PROGRESS') {
    return hold.unreconciledMemberCount > 0
      ? {
          labelKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS',
          hintKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS_HINT',
          hintParams: {
            batchCount: hold.pendingBatchCount,
            lineCount: hold.unreconciledMemberCount,
          },
        }
      : {
          labelKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS',
          hintKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS_HINT_NO_LINES',
          hintParams: { batchCount: hold.pendingBatchCount },
        }
  }
  return {
    labelKey: 'salesOrderDrawer.completionHolds.AWAITING_RECONCILIATION_COVERAGE',
    hintKey: 'salesOrderDrawer.completionHolds.AWAITING_RECONCILIATION_COVERAGE_HINT',
    hintParams: {},
  }
}

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
