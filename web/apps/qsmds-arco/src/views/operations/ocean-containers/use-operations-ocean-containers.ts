import type { Ref } from 'vue'
import type { OperationsOceanContainerDto, OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { OperationsOceanContainerApi, OperationsOceanContainerQuery } from '@/api/modules/operations-ocean-containers'
import type { OceanContainerDetailPage, OceanContainerItemsRequest } from '@/components/business/QsOceanContainerList/types'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'

/** 个人数据只由服务端授权的接口提供；缓存仅活在当前页面、查询和登录身份中。 */
export function useOperationsOceanContainers(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  query: Readonly<Ref<OperationsOceanContainerQuery>>,
  api: OperationsOceanContainerApi,
  onInvalidPage: (page: number) => void,
  messages: { list: string, items: string, detail: string },
) {
  const rows = shallowRef<OperationsOceanContainerDto[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')
  const expandedIds = ref<string[]>([])
  const details = ref<Record<string, OceanContainerDetailPage>>({})
  const drawerOpen = ref(false)
  const selectedLine = shallowRef<OperationsOceanContainerLineDto | null>(null)
  const selectedContainerName = ref('')
  const detailLoading = ref(false)
  const detailError = ref('')
  const cache = new Map<string, OceanContainerDetailPage>()
  const itemControllers = new Map<string, AbortController>()
  let listController: AbortController | null = null
  let drawerController: AbortController | null = null
  let selectedTarget: { containerId: string, itemId: string } | null = null
  let disposed = false

  function current(controller: AbortController, identity: number): boolean {
    return !disposed && enabled.value && !controller.signal.aborted && epoch.value === identity
  }

  function closeDrawer(): void {
    drawerController?.abort()
    drawerController = null
    drawerOpen.value = false
    selectedLine.value = null
    selectedTarget = null
    selectedContainerName.value = ''
    detailLoading.value = false
    detailError.value = ''
  }

  function reset(): void {
    listController?.abort()
    listController = null
    itemControllers.forEach(controller => controller.abort())
    itemControllers.clear()
    cache.clear()
    rows.value = []
    total.value = 0
    loading.value = false
    error.value = ''
    details.value = {}
    expandedIds.value = []
    closeDrawer()
  }

  async function reload(): Promise<void> {
    reset()
    if (disposed || !enabled.value) {
      return
    }
    const controller = new AbortController()
    listController = controller
    const identity = epoch.value
    loading.value = true
    try {
      const response = await api.list(query.value, controller.signal)
      if (!current(controller, identity)) {
        return
      }
      rows.value = response.data.items
      total.value = response.data.total
      if ((query.value.page ?? 1) > 1 && rows.value.length === 0) {
        onInvalidPage(Math.max(1, Math.ceil(total.value / (query.value.pageSize ?? 10))))
      }
    }
    catch {
      if (current(controller, identity)) {
        error.value = messages.list
      }
    }
    finally {
      if (listController === controller) {
        loading.value = false
        listController = null
      }
    }
  }

  async function requestItems(request: OceanContainerItemsRequest): Promise<void> {
    const { containerId, page, pageSize } = request
    if (disposed || !enabled.value || loading.value || !rows.value.some(row => row.id === containerId && row.myItemCount > 0)) {
      return
    }
    const previous = details.value[containerId]
    if (previous?.status === 'loading' && previous.page === page && previous.pageSize === pageSize) {
      return
    }
    itemControllers.get(containerId)?.abort()
    const key = `${containerId}:${page}:${pageSize}`
    const cached = cache.get(key)
    if (cached) {
      details.value[containerId] = cached
      itemControllers.delete(containerId)
      return
    }
    const controller = new AbortController()
    itemControllers.set(containerId, controller)
    const identity = epoch.value
    details.value[containerId] = { status: 'loading', items: [], total: previous?.total ?? 0, page, pageSize }
    try {
      const response = await api.items(containerId, { page, pageSize }, controller.signal)
      if (!current(controller, identity)) {
        return
      }
      const authoritativeTotal = response.data.total
      const knownTotal = rows.value.find(row => row.id === containerId)?.myItemCount
      if (authoritativeTotal !== knownTotal) {
        // 新的个人计数意味着归属集合可能变化，先丢弃该柜所有旧页，才能安全纠正越界分页。
        for (const cachedKey of cache.keys()) {
          if (cachedKey.startsWith(`${containerId}:`)) {
            cache.delete(cachedKey)
          }
        }
        rows.value = rows.value.map(row => row.id === containerId ? { ...row, myItemCount: authoritativeTotal } : row)
        details.value[containerId] = { status: 'loading', items: [], total: authoritativeTotal, page, pageSize }
        if (selectedTarget?.containerId === containerId) {
          closeDrawer()
        }
      }
      if (authoritativeTotal === 0) {
        details.value[containerId] = { status: 'ready', items: [], total: 0, page: 1, pageSize }
        return
      }
      // 归属变化后总数可能变少，回到最后一个有效页，避免留下空白的越界页。
      if (page > 1 && response.data.items.length === 0) {
        const validPage = Math.max(1, Math.ceil(authoritativeTotal / pageSize))
        if (validPage !== page) {
          await requestItems({ ...request, page: validPage })
          return
        }
      }
      const result: OceanContainerDetailPage = { status: 'ready', items: response.data.items, total: response.data.total, page, pageSize }
      cache.set(key, result)
      details.value[containerId] = result
    }
    catch {
      if (current(controller, identity)) {
        details.value[containerId] = { status: 'error', items: [], total: previous?.total ?? 0, page, pageSize, error: messages.items }
      }
    }
    finally {
      if (itemControllers.get(containerId) === controller) {
        itemControllers.delete(containerId)
      }
    }
  }

  async function loadDetail(): Promise<void> {
    const target = selectedTarget
    if (disposed || !enabled.value || !drawerOpen.value || !target) {
      return
    }
    drawerController?.abort()
    const controller = new AbortController()
    drawerController = controller
    const identity = epoch.value
    selectedLine.value = null
    detailError.value = ''
    detailLoading.value = true
    try {
      // 查看动作总是重新请求，不从已展开行构造完整详情，确保服务端重新校验销售归属。
      const response = await api.item(target.containerId, target.itemId, controller.signal)
      if (current(controller, identity)) {
        selectedLine.value = response.data
      }
    }
    catch {
      if (current(controller, identity)) {
        detailError.value = messages.detail
      }
    }
    finally {
      if (drawerController === controller) {
        detailLoading.value = false
        drawerController = null
      }
    }
  }

  async function openLine(containerId: string, itemId: string): Promise<void> {
    const container = rows.value.find(row => row.id === containerId)
    if (disposed || !enabled.value || !container || !container.myItemCount) {
      return
    }
    selectedTarget = { containerId, itemId }
    selectedContainerName.value = container.containerBatchName
    drawerOpen.value = true
    await loadDetail()
  }

  // 同步取消先于任何旧 Promise 回调执行；KeepAlive 离开也彻底清除个人缓存。
  watch([enabled, epoch, query], () => {
    void reload()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    reset()
  })

  return { rows, total, loading, error, expandedIds, details, drawerOpen, selectedLine, selectedContainerName, detailLoading, detailError, reload, requestItems, openLine, closeDrawer, loadDetail }
}
