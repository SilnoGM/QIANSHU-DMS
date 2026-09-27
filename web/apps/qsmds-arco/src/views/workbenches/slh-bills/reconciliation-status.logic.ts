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
