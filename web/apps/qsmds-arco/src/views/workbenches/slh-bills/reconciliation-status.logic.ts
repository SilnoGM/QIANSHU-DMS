import type { SlhBillLineDto, SlhBillListItemDto } from '@/api/generated/types.gen'

/**
 * 对账状态的取值以契约为准（生成类型），本模块是前端唯一一处「取值 → 文案/颜色」映射：
 * 账单管理页（三态）与账单详情页（明细行二态）都从这里取，避免两处各写一份硬编码。
 */
export type SlhBillReconciliationStatus = SlhBillListItemDto['reconciliationStatus']
export type SlhBillLineReconciliationStatus = SlhBillLineDto['reconciliationStatus']

export type SlhBillAnyReconciliationStatus = SlhBillReconciliationStatus | SlhBillLineReconciliationStatus

/**
 * 未对账用红色（还没开始做的活，需要被看见），部分对账用黄色（做了一半），
 * 对账完成与已对账用绿色（收口）。与同列表的汇率来源标签同款：outline 变体 + 着色边框文字，不铺底色。
 */
const TONE_CLASSES: Readonly<Record<SlhBillAnyReconciliationStatus, string>> = {
  PENDING: 'border-destructive/40 text-destructive',
  PARTIAL: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
  COMPLETED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  RECONCILED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
}

export function resolveSlhBillReconciliationTone(status: SlhBillAnyReconciliationStatus): string {
  return TONE_CLASSES[status]
}

/**
 * 两个取值集共用同一段文案：PENDING 在两处都是「未对账」。
 * 筛选工具栏多一个 `all`（不加对账条件），它只用来取文案，没有对应颜色。
 */
export function resolveSlhBillReconciliationLabelKey(status: SlhBillAnyReconciliationStatus | 'all'): string {
  return `slhBill.reconciliationStatus.${status}`
}

/** 列表操作列的对账入口动作：开始新一轮，或继续那条进行中的批次。 */
export type SlhBillReconciliationEntryAction = 'START' | 'CONTINUE'

/**
 * 列表操作列的对账入口：判据是「该账单有没有进行中批次」，不是账单三态。
 *
 * 三态由明细行派生，和批次占用是两件事：刚建批次还没核对的行数是 0（PENDING），
 * 但此刻该给的是「继续对账」；反过来，上一批结束后剩下的行还没核对（PARTIAL），
 * 该给的是「开始对账」——新一轮核对。计数与批次信息还没取到时一律不给入口：
 * 宁可少给一个，也不给一个指向错的入口。
 */
export function resolveSlhBillReconciliationEntry(input: {
  readonly countsKnown: boolean
  readonly inProgressBatchId: string | null
  readonly reconciliationStatus: SlhBillReconciliationStatus
  readonly superseded: boolean
}): SlhBillReconciliationEntryAction | null {
  if (input.superseded || !input.countsKnown) {
    return null
  }
  if (input.inProgressBatchId !== null) {
    return 'CONTINUE'
  }
  // 没有进行中批次：全部核对完的账单没有可开的活，其余都还能开新一轮。
  return input.reconciliationStatus === 'COMPLETED' ? null : 'START'
}

const ENTRY_LABEL_KEYS: Readonly<Record<SlhBillReconciliationEntryAction, string>> = {
  START: 'slhBill.startReconciliation',
  CONTINUE: 'slhBill.continueReconciliation',
}

export function resolveSlhBillReconciliationEntryLabelKey(action: SlhBillReconciliationEntryAction): string {
  return ENTRY_LABEL_KEYS[action]
}

/**
 * 「开始对账」能不能真的开起来：没有可核对的明细行时按钮软禁用（可点但看起来不可用），
 * 点了说明原因——与账单详情页完成按钮同一套软禁用口径。继续对账不受这条影响：
 * 批次已经建好，剩余行核对与否由批次自己管。
 */
export function isSlhBillReconciliationStartBlocked(input: {
  readonly inProgressBatchId: string | null
  readonly reconcilableLineCount: number
}): boolean {
  return input.inProgressBatchId === null && input.reconcilableLineCount === 0
}
