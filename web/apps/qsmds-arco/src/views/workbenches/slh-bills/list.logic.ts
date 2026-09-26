import type { SlhBillListQuery } from '@/api/modules/slh-bills'
import Decimal from 'decimal.js'

export type SlhBillListState = NonNullable<SlhBillListQuery['state']>
export type SlhBillAmountBoundError = 'format' | 'order' | null
// 与 OpenAPI 契约的 payableMin/payableMax 形状一致：非负十进制、最多两位小数、无前导零。
const AMOUNT_BOUND_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/

export interface SlhBillAmountBound {
  value: string | null
  valid: boolean
}

/** 金额区间禁止把非法值送到服务端换回 422，因此先在页面本地收敛形状。 */
export function normalizeSlhBillAmountBound(raw: string): SlhBillAmountBound {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { value: null, valid: true }
  }
  return AMOUNT_BOUND_PATTERN.test(trimmed)
    ? { value: trimmed, valid: true }
    : { value: null, valid: false }
}

/** 区间只有两端都合法且下限不大于上限时才能进入查询。 */
export function resolveSlhBillAmountRange(
  min: SlhBillAmountBound,
  max: SlhBillAmountBound,
): { payableMin?: string, payableMax?: string, error: SlhBillAmountBoundError } {
  if (!min.valid || !max.valid) {
    return { error: 'format' }
  }
  const payableMin = min.value
  const payableMax = max.value
  if (payableMin !== null && payableMax !== null && new Decimal(payableMin).greaterThan(payableMax)) {
    return { error: 'order' }
  }
  return {
    error: null,
    ...(payableMin === null ? {} : { payableMin }),
    ...(payableMax === null ? {} : { payableMax }),
  }
}

export function buildSlhBillListQuery(input: {
  page: number
  pageSize: number
  keyword: string
  periodFrom?: string
  periodTo?: string
  payableMin?: string
  payableMax?: string
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
    ...(input.payableMin === undefined ? {} : { payableMin: input.payableMin }),
    ...(input.payableMax === undefined ? {} : { payableMax: input.payableMax }),
  }
}
