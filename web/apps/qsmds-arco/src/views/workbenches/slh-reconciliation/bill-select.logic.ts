import type { SlhBillListItemDto } from '@/api/generated/types.gen'
import type { SlhReconciliationBatchCandidateQuery } from '@/api/modules/slh-reconciliation-batches'

/** 候选账单弹窗每页 10 条：一屏卡片正好铺满，不需要二次滚动。 */
export const SLH_BILL_SELECT_PAGE_SIZE = 10

/** 空态分语境：带关键词时是"没搜到"，不是"没有可对账的账单"。 */
export type SlhBillSelectEmptyKind = 'none' | 'keyword'

/**
 * 分页与搜索共用一个查询构造；关键词去空白后才发。
 * 「生效中 + 仍有未对账行 + 没有进行中批次」由服务端的候选账单接口负责，页面不重复判断。
 */
export function buildSlhBillSelectQuery(input: {
  page: number
  pageSize: number
  keyword: string
}): SlhReconciliationBatchCandidateQuery {
  const keyword = input.keyword.trim()
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(keyword === '' ? {} : { keyword }),
  }
}

export function resolveSlhBillSelectEmptyKind(input: {
  keyword: string
  total: number
}): SlhBillSelectEmptyKind | null {
  if (input.total > 0) {
    return null
  }
  return input.keyword.trim() === '' ? 'none' : 'keyword'
}

/** 单选：点已选中的卡片＝取消选择，点另一张＝切换（任何时刻最多一张被选中）。 */
export function toggleSlhBillSelection(
  current: SlhBillListItemDto | null,
  bill: SlhBillListItemDto,
): SlhBillListItemDto | null {
  return current !== null && current.id === bill.id ? null : bill
}
