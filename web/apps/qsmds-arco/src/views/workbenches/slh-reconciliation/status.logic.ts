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

/** 完成批次的门禁原因：批次已结束、或还有未核对的明细行。 */
export type SlhReconciliationCompleteBlockReason = 'BATCH_COMPLETED' | 'LINES_UNRECONCILED'

const COMPLETE_BLOCK_LABEL_KEYS: Readonly<Record<SlhReconciliationCompleteBlockReason, string>> = {
  BATCH_COMPLETED: 'slhReconciliation.detail.completeBlockedBatchCompleted',
  LINES_UNRECONCILED: 'slhReconciliation.detail.completeBlockedUnreconciled',
}

/**
 * 完成批次的门禁：返回 null 表示可以完成。
 * 判定只看服务端下发的计数（已核对行数由服务端统计），前端不自行推导每一行的状态；
 * 成员数为 0 的批次不挡（没有可核对的行，与既有语义一致）。
 */
export function resolveSlhReconciliationCompleteBlockReason(batch: {
  readonly memberCount: number
  readonly reconciledMemberCount: number
  readonly status: SlhReconciliationBatchStatus
}): SlhReconciliationCompleteBlockReason | null {
  if (batch.status !== 'IN_PROGRESS') {
    return 'BATCH_COMPLETED'
  }
  return batch.reconciledMemberCount >= batch.memberCount ? null : 'LINES_UNRECONCILED'
}

export function resolveSlhReconciliationCompleteBlockLabelKey(reason: SlhReconciliationCompleteBlockReason): string {
  return COMPLETE_BLOCK_LABEL_KEYS[reason]
}

/** 不合格原因：与账单行的匹配规则一一对应（见 slh-bill-line-matching），前端只做取值到文案键的映射。 */
export function resolveSlhBillLineUnmatchedReasonLabelKey(reason: SlhBillLineUnmatchedReason): string {
  return `slhReconciliation.unmatchedReason.${reason}`
}
