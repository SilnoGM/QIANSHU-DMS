import type { SlhBillListQuery, SlhBillStatusCountsQuery } from '@/api/modules/slh-bills'

export type SlhBillListState = NonNullable<SlhBillListQuery['state']>
export type SlhBillReconciliationFilter = NonNullable<SlhBillListQuery['reconciliationStatus']>

/** 两块工具栏的取值顺序与文案键都在这里定，页面只负责渲染。 */
export const SLH_BILL_LIST_STATES = ['active', 'superseded', 'all'] as const
// 「全部」放在最后：它是兜底项，不是常用的工作视图。
export const SLH_BILL_RECONCILIATION_FILTERS = ['PENDING', 'PARTIAL', 'COMPLETED', 'all'] as const
/** 进页面先看待对账的账单，这是财务最常处理的一批。 */
export const SLH_BILL_DEFAULT_RECONCILIATION_FILTER: SlhBillReconciliationFilter = 'PENDING'

export function buildSlhBillListQuery(input: {
  page: number
  pageSize: number
  keyword: string
  periodFrom?: string
  periodTo?: string
  state: SlhBillListState
  reconciliationStatus: SlhBillReconciliationFilter
}): SlhBillListQuery {
  return {
    ...buildSlhBillFilter(input),
    page: input.page,
    pageSize: input.pageSize,
  }
}

/**
 * 计数查询与列表查询共用同一组筛选，只去掉分页：计数覆盖完整结果集，不是当前页。
 * `state` 与 `reconciliationStatus` 都要发出去——两块工具栏各自要按"忽略自己、保留对方"的口径计数。
 */
export function buildSlhBillStatusCountsQuery(input: {
  keyword: string
  periodFrom?: string
  periodTo?: string
  state: SlhBillListState
  reconciliationStatus: SlhBillReconciliationFilter
}): SlhBillStatusCountsQuery {
  return buildSlhBillFilter(input)
}

function buildSlhBillFilter(input: {
  keyword: string
  periodFrom?: string
  periodTo?: string
  state: SlhBillListState
  reconciliationStatus: SlhBillReconciliationFilter
}): Omit<SlhBillListQuery, 'page' | 'pageSize'> {
  const keyword = input.keyword.trim()
  return {
    state: input.state,
    reconciliationStatus: input.reconciliationStatus,
    ...(keyword === '' ? {} : { keyword }),
    ...(input.periodFrom === undefined ? {} : { periodFrom: input.periodFrom }),
    ...(input.periodTo === undefined ? {} : { periodTo: input.periodTo }),
  }
}

/** 工具栏只接受约定取值；非法值一律退回默认，避免把脏值带进查询。 */
export function resolveSlhBillListState(value: string): SlhBillListState {
  return SLH_BILL_LIST_STATES.find(state => state === value) ?? 'active'
}

export function resolveSlhBillReconciliationFilter(value: string): SlhBillReconciliationFilter {
  return SLH_BILL_RECONCILIATION_FILTERS.find(filter => filter === value) ?? SLH_BILL_DEFAULT_RECONCILIATION_FILTER
}
