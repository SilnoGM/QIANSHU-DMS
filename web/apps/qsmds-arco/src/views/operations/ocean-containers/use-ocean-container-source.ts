import type { AxiosResponse } from 'axios'
import type { Ref } from 'vue'
import type { OperationsOceanContainerLineDto, PurchaseOrderDetailDto, SalesOrderDetailDto } from '@/api/generated/types.gen'
import type { OceanContainerSourceRequest } from '@/components/business/QsOceanContainerList/types'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'

interface SourceApi {
  item: (containerId: string, lineId: string, signal: AbortSignal) => Promise<AxiosResponse<OperationsOceanContainerLineDto>>
  sales: (id: string, signal: AbortSignal) => Promise<AxiosResponse<SalesOrderDetailDto>>
  purchase: (id: string, signal: AbortSignal) => Promise<AxiosResponse<PurchaseOrderDetailDto>>
}

/** 来源抽屉只接受明细定位；每次打开或重试都先复核本人归属，不使用列表缓存中的订单 ID。 */
export function useOceanContainerSource(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  canViewSales: Readonly<Ref<boolean>>,
  canViewPurchase: Readonly<Ref<boolean>>,
  api: SourceApi,
  failureMessage: string,
) {
  const target = shallowRef<OceanContainerSourceRequest | null>(null)
  const salesDetail = shallowRef<SalesOrderDetailDto | null>(null)
  const purchaseDetail = shallowRef<PurchaseOrderDetailDto | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  let disposed = false
  const allowed = (kind: OceanContainerSourceRequest['kind']) => enabled.value && (kind === 'sales' ? canViewSales.value : canViewPurchase.value)

  function close(): void {
    controller?.abort()
    controller = null
    target.value = null
    salesDetail.value = null
    purchaseDetail.value = null
    loading.value = false
    error.value = ''
  }

  async function reload(): Promise<void> {
    const selection = target.value
    if (disposed || !selection || !allowed(selection.kind)) {
      return
    }
    controller?.abort()
    const request = new AbortController()
    controller = request
    const identity = epoch.value
    const current = () => !disposed && controller === request && !request.signal.aborted && epoch.value === identity && allowed(selection.kind)
    salesDetail.value = null
    purchaseDetail.value = null
    error.value = ''
    loading.value = true
    try {
      const { data: line } = await api.item(selection.containerId, selection.lineId, request.signal)
      // 第一段读取返回时再次检查；关闭、切换来源或撤权后不能接着读取整张订单。
      if (!current()) {
        return
      }
      if (selection.kind === 'sales' && line.salesOrderId) {
        const { data } = await api.sales(line.salesOrderId, request.signal)
        if (current()) {
          salesDetail.value = data
        }
      }
      else if (selection.kind === 'purchase' && line.purchaseOrderId) {
        const { data } = await api.purchase(line.purchaseOrderId, request.signal)
        if (current()) {
          purchaseDetail.value = data
        }
      }
      else {
        error.value = failureMessage
      }
    }
    catch {
      if (current()) {
        error.value = failureMessage
      }
    }
    finally {
      if (controller === request) {
        controller = null
        loading.value = false
      }
    }
  }

  async function open(selection: OceanContainerSourceRequest): Promise<void> {
    close()
    if (disposed || !allowed(selection.kind)) {
      return
    }
    target.value = { ...selection }
    await reload()
  }

  watch([enabled, epoch, canViewSales, canViewPurchase], close, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    close()
  })
  return { target, salesDetail, purchaseDetail, loading, error, open, close, reload }
}
