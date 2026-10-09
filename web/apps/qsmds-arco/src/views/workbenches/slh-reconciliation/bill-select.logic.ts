import type {
  SlhBillLineUnmatchedReasonCountDto,
  SlhReconciliationBillOptionDto,
} from '@/api/generated/types.gen'
import type { SlhReconciliationBillOptionQuery } from '@/api/modules/slh-reconciliation-batches'
import { resolveSlhBillLineUnmatchedReasonLabelKey } from './status.logic'

/** 弹窗每页 20 条：与账单列表同档，两个分组各自分页。 */
export const SLH_BILL_SELECT_PAGE_SIZE = 20

export type SlhBillSelectGroup = NonNullable<SlhReconciliationBillOptionQuery['group']>
export const SLH_BILL_SELECT_GROUPS: readonly SlhBillSelectGroup[] = ['SELECTABLE', 'BLOCKED']

/** 空态分语境：带关键词时是"没搜到"，否则按当前分组给不同文案。 */
export type SlhBillSelectEmptyKind = 'none' | 'blocked' | 'keyword'

/**
 * 分组与搜索共用一个查询构造；关键词去空白后才发。
 * 「可核对 > 0 且没有进行中批次」由服务端判定，页面不重复计算。
 */
export function buildSlhBillSelectQuery(input: {
  group: SlhBillSelectGroup
  page: number
  pageSize: number
  keyword: string
}): SlhReconciliationBillOptionQuery {
  const keyword = input.keyword.trim()
  return {
    group: input.group,
    page: input.page,
    pageSize: input.pageSize,
    ...(keyword === '' ? {} : { keyword }),
  }
}

export function resolveSlhBillSelectEmptyKind(input: {
  group: SlhBillSelectGroup
  keyword: string
  total: number
}): SlhBillSelectEmptyKind | null {
  if (input.total > 0) {
    return null
  }
  if (input.keyword.trim() !== '') {
    return 'keyword'
  }
  return input.group === 'BLOCKED' ? 'blocked' : 'none'
}

/** 单选：只有可选账单能被选中；点已选中的卡片＝取消选择。 */
export function toggleSlhBillSelection(
  current: SlhReconciliationBillOptionDto | null,
  bill: SlhReconciliationBillOptionDto,
): SlhReconciliationBillOptionDto | null {
  if (!bill.selectable) {
    return current
  }
  return current !== null && current.id === bill.id ? null : bill
}

export interface SlhBillBlockReasonEntry {
  labelKey: string
  count: number
}

export interface SlhBillBlockReasonSummary {
  /** 展示前若干条原因（按条数降序）。 */
  entries: SlhBillBlockReasonEntry[]
  /** 还有多少类原因没展示。 */
  hiddenCount: number
}

/** 不可选原因摘要：取前 `limit` 条原因 + 其余类数，文案键由调用方翻译。 */
export function summarizeSlhBillBlockReasons(
  reasons: readonly SlhBillLineUnmatchedReasonCountDto[],
  limit = 2,
): SlhBillBlockReasonSummary {
  return {
    entries: reasons.slice(0, limit).map(reason => ({
      labelKey: resolveSlhBillLineUnmatchedReasonLabelKey(reason.code),
      count: reason.count,
    })),
    hiddenCount: Math.max(reasons.length - limit, 0),
  }
}

/** 交给调用方翻译：键与参数由本模块决定，译文仍留在语言包。 */
export type SlhBillBlockReasonTranslator = (key: string, params?: Record<string, unknown>) => string

/**
 * 不可选卡片上的说明。
 *
 * 占用与「没有未对账行」都是结论式原因，直接给一句话；只有「有未对账行但一行都
 * 匹配不上」才需要解释，此时把原因按条数排好取前 2 条，其余折成「等 N 类」。
 */
export function buildSlhBillBlockReasonText(
  bill: Pick<SlhReconciliationBillOptionDto, 'blockReason' | 'reasons'>,
  translate: SlhBillBlockReasonTranslator,
): string {
  if (bill.blockReason === 'IN_PROGRESS_BATCH') {
    return translate('slhReconciliation.billSelect.blockInProgress')
  }
  if (bill.blockReason === 'NO_UNRECONCILED_LINES') {
    return translate('slhReconciliation.billSelect.blockNoUnreconciled')
  }
  const summary = summarizeSlhBillBlockReasons(bill.reasons)
  const detail = summary.entries.map(entry => `${translate(entry.labelKey)} ${entry.count}`).join(' · ')
  const more = summary.hiddenCount > 0
    ? `（${translate('slhReconciliation.billSelect.reasonMore', { count: summary.hiddenCount })}）`
    : ''
  return `${translate('slhReconciliation.billSelect.blockNoReconcilable')}${detail}${more}`
}
