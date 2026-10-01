import type { SlhReconciliationBatchListQuery } from '@/api/modules/slh-reconciliation-batches'

export type SlhReconciliationBatchFilter = NonNullable<SlhReconciliationBatchListQuery['status']>

/** 工具栏取值顺序与文案键都在这里定，页面只负责渲染。 */
export const SLH_RECONCILIATION_BATCH_FILTERS = ['IN_PROGRESS', 'COMPLETED', 'all'] as const
/** 进页面先看进行中的对账：那是还没收工的活。「全部」是兜底项，放最后。 */
export const SLH_RECONCILIATION_BATCH_DEFAULT_FILTER: SlhReconciliationBatchFilter = 'IN_PROGRESS'

export function buildSlhReconciliationBatchListQuery(input: {
  page: number
  pageSize: number
  keyword: string
  status: SlhReconciliationBatchFilter
}): SlhReconciliationBatchListQuery {
  const keyword = input.keyword.trim()
  return {
    status: input.status,
    page: input.page,
    pageSize: input.pageSize,
    ...(keyword === '' ? {} : { keyword }),
  }
}

/** 工具栏只接受约定取值；非法值一律退回默认，避免把脏值带进查询。 */
export function resolveSlhReconciliationBatchFilter(value: string): SlhReconciliationBatchFilter {
  return SLH_RECONCILIATION_BATCH_FILTERS.find(filter => filter === value) ?? SLH_RECONCILIATION_BATCH_DEFAULT_FILTER
}
