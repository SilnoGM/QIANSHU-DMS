import type { SlhBillLineUnmatchedReasonCountDto, SlhReconciliationBatchListItemDto } from '@/api/generated/types.gen'

/**
 * 批次状态与匹配原因的「取值 → 文案/颜色」映射（前端唯一一处）。
 * 取值全部以契约为准（生成类型）：批次自身状态、以及「这一行为什么不能核对」。
 */
export type SlhReconciliationBatchStatus = SlhReconciliationBatchListItemDto['status']
export type SlhBillLineUnmatchedReason = SlhBillLineUnmatchedReasonCountDto['code']

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

/** 不合格原因：与账单行的匹配规则一一对应（见 slh-bill-line-matching），前端只做取值到文案键的映射。 */
export function resolveSlhBillLineUnmatchedReasonLabelKey(reason: SlhBillLineUnmatchedReason): string {
  return `slhReconciliation.unmatchedReason.${reason}`
}
