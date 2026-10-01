import type { SlhReconciliationBatchListItemDto, SlhReconciliationMatchPreviewLineDto } from '@/api/generated/types.gen'

/**
 * 批次状态、匹配来源与不合格原因的「取值 → 文案/颜色」映射（前端唯一一处）。
 * 取值全部以契约为准（生成类型）：三个取值集分别是批次自身状态、匹配依据的来源，
 * 以及「这一行现在为什么不能核对」。
 */
export type SlhReconciliationBatchStatus = SlhReconciliationBatchListItemDto['status']
export type SlhBillLineMatchSource = NonNullable<SlhReconciliationMatchPreviewLineDto['matchSource']>
export type SlhBillLineUnmatchedReason = NonNullable<SlhReconciliationMatchPreviewLineDto['reason']>

/** 进行中用主色（还在作业中），已完成用绿色（收口）。与对账状态标签同款 outline 变体，不铺底色。 */
const BATCH_STATUS_TONES: Readonly<Record<SlhReconciliationBatchStatus, string>> = {
  IN_PROGRESS: 'border-primary/40 text-primary',
  COMPLETED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
}

export function resolveSlhReconciliationBatchTone(status: SlhReconciliationBatchStatus): string {
  return BATCH_STATUS_TONES[status]
}

export function resolveSlhReconciliationBatchLabelKey(status: SlhReconciliationBatchStatus): string {
  return `slhReconciliation.batchStatus.${status}`
}

/** 匹配来源：柜号名称是主路径，唛头推断是辅助路径，界面上必须可区分。 */
export function resolveSlhBillLineMatchSourceLabelKey(source: SlhBillLineMatchSource): string {
  return `slhReconciliation.matchSource.${source}`
}

/** 不合格原因：三层原因各有独立文案，前端只做取值到文案键的映射。 */
export function resolveSlhBillLineUnmatchedReasonLabelKey(reason: SlhBillLineUnmatchedReason): string {
  return `slhReconciliation.unmatchedReason.${reason}`
}
