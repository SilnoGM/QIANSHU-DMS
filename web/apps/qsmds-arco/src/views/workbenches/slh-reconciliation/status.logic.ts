import type { SlhReconciliationBatchListItemDto } from '@/api/generated/types.gen'

/**
 * 批次状态的「取值 → 文案/颜色」映射（前端唯一一处）。
 * 取值以契约为准（生成类型）；匹配来源与不合格原因的映射随创建弹窗一并移除。
 */
export type SlhReconciliationBatchStatus = SlhReconciliationBatchListItemDto['status']

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
