import type { SlhReconciliationBatchCreateDto, SlhReconciliationBatchPreviewDto, SlhReconciliationMatchPreviewLineDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

/** 两步弹窗的步骤：先选账单，再看系统算出的可核对范围。 */
export type SlhReconciliationSelectStep = 0 | 1
export const SLH_RECONCILIATION_SELECT_STEPS = ['selectBill', 'previewScope'] as const

export type SlhReconciliationPreviewLine = SlhReconciliationMatchPreviewLineDto

export interface SlhReconciliationPreviewSummary {
  matchedCount: number
  unmatchedCount: number
  /** 一条都没匹配上时不能开始对账：建空批次没有业务意义。 */
  canStart: boolean
}

export function resolveSlhReconciliationPreviewSummary(preview: SlhReconciliationBatchPreviewDto | null): SlhReconciliationPreviewSummary {
  const matchedCount = preview?.matched.length ?? 0
  const unmatchedCount = preview?.unmatched.length ?? 0
  return { matchedCount, unmatchedCount, canStart: matchedCount > 0 }
}

/**
 * 创建载荷：把用户预览时看到的行集合一并提交，服务端会用重跑结果比对，
 * 不一致就拒绝创建，避免「看到的范围」和「实际冻结的范围」悄悄不同。
 */
export function buildSlhReconciliationBatchCreatePayload(
  billId: string,
  preview: SlhReconciliationBatchPreviewDto | null,
): SlhReconciliationBatchCreateDto {
  return { billId, previewLineIds: (preview?.matched ?? []).map(line => line.lineId) }
}

/** 预览行表的列：已匹配的看核对依据，未匹配的看原因。 */
export function buildSlhReconciliationPreviewColumns(
  t: (key: string) => string,
  kind: 'matched' | 'unmatched',
): QsGenericTableColumn<SlhReconciliationPreviewLine>[] {
  const shared: QsGenericTableColumn<SlhReconciliationPreviewLine>[] = [
    { id: 'lineNumber', title: t('slhReconciliation.selectModal.billLineNumber'), accessorKey: 'lineNumber', width: 110, minWidth: 110, align: 'right' },
    { id: 'container', title: t('slhReconciliation.selectModal.containerName'), accessorFn: line => line.containerBatchNameText ?? '', minWidth: 150 },
    { id: 'shippingMark', title: t('slhReconciliation.selectModal.shippingMark'), accessorFn: line => line.shippingMarkText ?? '', minWidth: 150 },
    { id: 'goodsName', title: t('slhReconciliation.selectModal.goodsName'), accessorKey: 'goodsName', minWidth: 200 },
    // 客户名来自账单「收货人信息」的解析结果；账单只写了仓库时按缺值占位符展示。
    { id: 'customerName', title: t('slhReconciliation.selectModal.customerName'), accessorFn: line => line.recipientName ?? t('slhBill.valueMissing'), minWidth: 180 },
  ]
  if (kind === 'matched') {
    return [
      ...shared,
      { id: 'matchedContainer', title: t('slhReconciliation.selectModal.matchedContainer'), accessorFn: line => line.matchedContainerBatchName ?? '', minWidth: 160 },
      { id: 'matchedLine', title: t('slhReconciliation.selectModal.matchedLine'), accessorFn: line => String(line.matchedLoadingItemLineNumber ?? ''), minWidth: 120, align: 'right' },
      { id: 'source', title: t('slhReconciliation.selectModal.source'), accessorFn: line => line.matchSource ?? '', minWidth: 140 },
    ]
  }
  return [...shared, { id: 'reason', title: t('slhReconciliation.selectModal.reason'), accessorFn: line => line.reason ?? '', minWidth: 240 }]
}
