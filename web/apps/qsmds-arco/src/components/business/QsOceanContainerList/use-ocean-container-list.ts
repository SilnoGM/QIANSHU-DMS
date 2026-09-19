import type { Ref } from 'vue'
import type { OceanContainerDetailPage, OceanContainerItemsRequest, OceanContainerSummary } from './types'
import { watch } from 'vue'

/** 展开只发出加载意图；请求、归属鉴权和缓存由调用方负责。 */
export function useOceanContainerList(
  items: Readonly<Ref<readonly OceanContainerSummary[]>>,
  details: Readonly<Ref<Readonly<Record<string, OceanContainerDetailPage | undefined>>>>,
  expanded: Ref<string[]>,
  disabled: Readonly<Ref<boolean>>,
  request: (value: OceanContainerItemsRequest) => void,
) {
  const available = (id: string) => !disabled.value && items.value.some(item => item.id === id)
  const canLoad = (id: string) => available(id) && items.value.some(item => item.id === id && item.myItemCount > 0) && details.value[id]?.status !== 'loading'

  watch(items, (value) => {
    const ids = new Set(value.map(item => item.id))
    const next = [...new Set(expanded.value)].filter(id => ids.has(id))
    if (next.length !== expanded.value.length) {
      expanded.value = next
    }
  }, { flush: 'sync', immediate: true })

  function toggle(id: string, open: boolean) {
    if (!available(id) || expanded.value.includes(id) === open) {
      return
    }
    expanded.value = open ? [...expanded.value, id] : expanded.value.filter(value => value !== id)
    const detail = details.value[id]
    if (open && canLoad(id) && (!detail || detail.status === 'idle')) {
      request({ containerId: id, page: 1, pageSize: detail?.pageSize ?? 20 })
    }
  }

  function retry(id: string) {
    const detail = details.value[id]
    if (canLoad(id) && expanded.value.includes(id) && detail?.status === 'error') {
      request({ containerId: id, page: detail.page, pageSize: detail.pageSize })
    }
  }

  function paginate(id: string, page: number) {
    const detail = details.value[id]
    if (!canLoad(id) || !expanded.value.includes(id) || detail?.status !== 'ready' || !Number.isFinite(page)) {
      return
    }
    // 明细页数始终使用本人可见记录总数，不能拿整柜数量推算。
    const next = Math.min(Math.max(1, Math.trunc(page)), Math.max(1, Math.ceil(detail.total / detail.pageSize)))
    if (next !== detail.page) {
      request({ containerId: id, page: next, pageSize: detail.pageSize })
    }
  }

  return { toggle, retry, paginate }
}
