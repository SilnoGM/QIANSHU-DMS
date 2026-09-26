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

/**
 * 行点击是否应当进入详情。
 *
 * 行内按钮、链接与输入控件自己处理点击，只有其余区域才算作"打开这一行"，
 * 否则点一次复制会同时触发导航。真实事件对象来自浏览器，这里只依赖 closest。
 */
export function shouldOpenSlhBillFromRowClick(target: unknown): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null
  if (typeof candidate?.closest !== 'function') {
    return true
  }
  return candidate.closest('button, a, input, select, textarea, [role="button"]') === null
}
