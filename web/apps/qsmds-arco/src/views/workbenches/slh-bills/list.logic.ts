import type { SlhBillListQuery } from '@/api/modules/slh-bills'

export type SlhBillListState = NonNullable<SlhBillListQuery['state']>

export function buildSlhBillListQuery(input: {
  page: number
  pageSize: number
  keyword: string
  periodFrom?: string
  periodTo?: string
  state: SlhBillListState
}): SlhBillListQuery {
  const keyword = input.keyword.trim()
  return {
    page: input.page,
    pageSize: input.pageSize,
    state: input.state,
    ...(keyword === '' ? {} : { keyword }),
    ...(input.periodFrom === undefined ? {} : { periodFrom: input.periodFrom }),
    ...(input.periodTo === undefined ? {} : { periodTo: input.periodTo }),
  }
}
