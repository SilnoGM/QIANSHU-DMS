import type { Ref } from 'vue'
import type { ShipmentListQuery } from './logic'
import type { PurchaseOrderDetailDto, PurchaseShipmentDetailDto, PurchaseShipmentListItemDto, PurchaseShipmentStatusCountsDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import purchaseShipmentsApi from '../../../api/modules/purchase-shipments'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import { isShipmentPlaceholderView, shipmentCountsQuery } from './logic'

/** 所有读取绑定当前视图与身份；列表、计数和详情独立取消，任一失败不遮蔽其他区域。 */
type PurchaseShipmentReadApi = Pick<typeof purchaseShipmentsApi, 'getById' | 'list' | 'statusCounts'>

export function useShipmentData(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  query: Readonly<Ref<ShipmentListQuery>>,
  onInvalidPage: (page: number) => void,
  api: PurchaseShipmentReadApi = purchaseShipmentsApi,
  orders = purchaseOrdersApi,
) {
  const rows = shallowRef<PurchaseShipmentListItemDto[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')
  const counts = shallowRef<PurchaseShipmentStatusCountsDto['items']>([])
  const buyerOptions = shallowRef<PurchaseShipmentStatusCountsDto['buyerOptions']>([])
  const countsError = ref(false)
  const detail = shallowRef<PurchaseShipmentDetailDto | null>(null)
  const orderDetail = shallowRef<PurchaseOrderDetailDto | null>(null)
  const detailKind = ref<'shipment' | 'order' | null>(null)
  const detailId = ref<string | null>(null)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  let listController: AbortController | null = null
  let countController: AbortController | null = null
  let detailController: AbortController | null = null

  function current(controller: AbortController, requestEpoch: number): boolean {
    return !controller.signal.aborted && enabled.value && requestEpoch === epoch.value
  }

  async function loadRows(): Promise<void> {
    if (!enabled.value) {
      return
    }
    listController?.abort()
    const view = query.value.view
    // 运输业务尚未开放，预留视图不能把到仓数据当作装柜记录，也不能发送服务端尚不支持的筛选。
    if (isShipmentPlaceholderView(view)) {
      rows.value = []
      total.value = 0
      loading.value = false
      error.value = ''
      return
    }
    const controller = new AbortController()
    listController = controller
    const requestEpoch = epoch.value
    loading.value = true
    error.value = ''
    try {
      const response = await api.list({ ...query.value, view }, controller.signal)
      if (!current(controller, requestEpoch)) {
        return
      }
      rows.value = response.data.items
      total.value = response.data.total
      if ((query.value.page ?? 1) > 1 && rows.value.length === 0) {
        onInvalidPage(Math.max(1, Math.ceil(total.value / (query.value.pageSize ?? 20))))
      }
    }
    catch (failure) {
      if (current(controller, requestEpoch)) {
        rows.value = []
        total.value = 0
        error.value = getPurchaseOrderApiFailure(failure).message
      }
    }
    finally {
      if (listController === controller) {
        loading.value = false
      }
    }
  }

  async function loadCounts(): Promise<void> {
    if (!enabled.value) {
      return
    }
    countController?.abort()
    const controller = new AbortController()
    countController = controller
    const requestEpoch = epoch.value
    try {
      const response = await api.statusCounts(shipmentCountsQuery(query.value), controller.signal)
      if (!current(controller, requestEpoch)) {
        return
      }
      counts.value = response.data.items
      buyerOptions.value = response.data.buyerOptions
      countsError.value = false
    }
    catch {
      if (current(controller, requestEpoch)) {
        countsError.value = true
      }
    }
  }

  function refresh(): void {
    void loadRows()
    void loadCounts()
  }

  async function loadDetail(): Promise<void> {
    detailController?.abort()
    const id = detailId.value
    const kind = detailKind.value
    if (!enabled.value || id === null || kind === null) {
      return
    }
    const controller = new AbortController()
    detailController = controller
    const requestEpoch = epoch.value
    detailLoading.value = true
    detailError.value = null
    detail.value = null
    orderDetail.value = null
    try {
      if (kind === 'shipment') {
        const response = await api.getById(id, controller.signal)
        if (current(controller, requestEpoch)) {
          detail.value = response.data
        }
      }
      else {
        const response = await orders.getById(id, controller.signal)
        if (current(controller, requestEpoch)) {
          orderDetail.value = response.data
        }
      }
    }
    catch (failure) {
      if (current(controller, requestEpoch)) {
        detailError.value = getPurchaseOrderApiFailure(failure).message
      }
    }
    finally {
      if (detailController === controller) {
        detailLoading.value = false
      }
    }
  }

  async function openShipment(id: string): Promise<void> {
    if (!enabled.value) {
      return
    }
    detailId.value = id
    detailKind.value = 'shipment'
    await loadDetail()
  }

  async function openOrder(id: string): Promise<void> {
    if (!enabled.value) {
      return
    }
    detailId.value = id
    detailKind.value = 'order'
    await loadDetail()
  }

  function reset(): void {
    listController?.abort()
    countController?.abort()
    detailController?.abort()
    listController = null
    countController = null
    detailController = null
    rows.value = []
    total.value = 0
    counts.value = []
    buyerOptions.value = []
    error.value = ''
    countsError.value = false
    loading.value = false
    detailLoading.value = false
    detailKind.value = null
    detailId.value = null
    detail.value = null
    orderDetail.value = null
    detailError.value = null
  }

  watch(detailKind, (kind) => {
    if (kind === null) {
      detailController?.abort()
      detailLoading.value = false
    }
  }, { flush: 'sync' })
  watch([enabled, epoch, query], () => {
    reset()
    if (enabled.value) {
      refresh()
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(reset)

  return { rows, total, loading, error, counts, countsError, buyerOptions, detail, orderDetail, detailKind, detailLoading, detailError, refresh, loadCounts, loadDetail, openShipment, openOrder }
}
