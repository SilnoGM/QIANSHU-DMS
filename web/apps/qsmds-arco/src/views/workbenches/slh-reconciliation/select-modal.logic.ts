import type { SlhBillListItemDto, SlhReconciliationBatchCreateDto, SlhReconciliationBatchPreviewDto, SlhReconciliationMatchPreviewLineDto } from '@/api/generated/types.gen'
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

/**
 * 预览表行：父组带 children、明细行不带（分组只有一层）。
 * 列访问器对组行返回空值，与采购付款页同一套写法。
 */
export interface SlhReconciliationPreviewRow {
  id: string
  line: SlhReconciliationPreviewLine | null
  /** 组行的标题与行数；明细行为 null。 */
  group: { label: string, count: number, tone: 'matched' | 'unmatched' } | null
  children?: SlhReconciliationPreviewRow[]
}

/**
 * 预览两组固定顺序：先「已匹配合格的行」（本次核对的载荷），再「暂不能核对的行」（原因）。
 * 两组都默认展开：不合格原因本身就是这一步必须展示的信息。
 */
export function buildSlhReconciliationPreviewRows(
  preview: SlhReconciliationBatchPreviewDto | null,
  labels: { matched: string, unmatched: string },
): SlhReconciliationPreviewRow[] {
  if (preview === null) {
    return []
  }
  const toRows = (lines: SlhReconciliationPreviewLine[]): SlhReconciliationPreviewRow[] =>
    lines.map(line => ({ id: `line-${line.lineId}`, line, group: null }))
  return [
    { id: 'group-matched', line: null, group: { label: labels.matched, count: preview.matched.length, tone: 'matched' }, children: toRows(preview.matched) },
    { id: 'group-unmatched', line: null, group: { label: labels.unmatched, count: preview.unmatched.length, tone: 'unmatched' }, children: toRows(preview.unmatched) },
  ]
}

/**
 * 预览表列：六列收口，把「匹配柜次 + 匹配来源」与「不合格原因」合成一列「匹配结果」，
 * 让两张组表共用同一列位置——已匹配行看依据，未匹配行看原因。
 * 宽度按弹窗可用宽度（约 846px）配平：品名与客户名允许换行，保证「匹配结果」整列可见。
 */
export function buildSlhReconciliationPreviewColumns(
  t: (key: string) => string,
): QsGenericTableColumn<SlhReconciliationPreviewRow>[] {
  return [
    { id: 'lineNumber', title: t('slhReconciliation.selectModal.billLineNumber'), accessorFn: row => row.line?.lineNumber ?? '', width: 95, minWidth: 95, align: 'right' },
    { id: 'container', title: t('slhReconciliation.selectModal.containerName'), accessorFn: row => row.line?.containerBatchNameText ?? '', width: 120, minWidth: 120 },
    { id: 'shippingMark', title: t('slhReconciliation.selectModal.shippingMark'), accessorFn: row => row.line?.shippingMarkText ?? '', width: 120, minWidth: 120 },
    { id: 'goodsName', title: t('slhReconciliation.selectModal.goodsName'), accessorFn: row => row.line?.goodsName ?? '', width: 145, minWidth: 145 },
    // 客户名来自账单「收货人信息」的解析结果；账单只写了仓库时按缺值占位符展示。
    { id: 'customerName', title: t('slhReconciliation.selectModal.customerName'), accessorFn: row => row.line === null ? '' : row.line.recipientName ?? t('slhBill.valueMissing'), width: 140, minWidth: 140 },
    { id: 'matchResult', title: t('slhReconciliation.selectModal.matchResult'), width: 190, minWidth: 190 },
  ]
}

/**
 * 选中账单行：整行浅绿底 + 上下细绿边，首尾格补左右边拼成完整边框。
 * 与账单问题行标黄同一套写法：用单元格级背景，否则固定列与斑马纹的单元格底色会盖住行背景；
 * 固定列必须加 `!`，否则它自带的不透明底会保持原色，那一格的底色与边框会断开。
 */
export const SLH_RECONCILIATION_SELECTED_ROW_CLASS = '[&>td]:border-y [&>td]:border-primary/40 [&>td]:bg-primary/5 [&>td:first-child]:border-l [&>td:last-child]:border-r [&>td[data-pinned]]:bg-primary/5!'

export function resolveSlhReconciliationBillRowClass(row: { original: SlhBillListItemDto }, selectedBillId: string): string {
  return row.original.id === selectedBillId ? SLH_RECONCILIATION_SELECTED_ROW_CLASS : ''
}
