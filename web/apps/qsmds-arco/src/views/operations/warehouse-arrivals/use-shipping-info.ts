import type { Ref } from 'vue'
import type { PurchaseShipmentListItemDto, SalesOrderDetailDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import salesOrdersApi from '../../../api/modules/sales-orders'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'

/**
 * 出货信息只读：货件行提供唛头与品名，客户电话、收货地址与代收尾款取关联销售订单。
 * 到仓时货件尚未装柜，装柜明细还不存在，因此不读取装柜侧资料。
 * 读取沿用页面既有的权限、身份与生命周期边界，撤权或离开时立即取消并清空。
 */
export function useShippingInfoData(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  api = salesOrdersApi,
) {
  const shipment = shallowRef<PurchaseShipmentListItemDto | null>(null)
  const salesOrder = shallowRef<SalesOrderDetailDto | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let controller: AbortController | null = null

  function current(request: AbortController, requestEpoch: number): boolean {
    return !request.signal.aborted && controller === request && enabled.value && requestEpoch === epoch.value
  }

  function close(): void {
    controller?.abort()
    controller = null
    shipment.value = null
    salesOrder.value = null
    loading.value = false
    error.value = null
  }

  async function load(): Promise<void> {
    const row = shipment.value
    if (!enabled.value || row === null) {
      return
    }
    controller?.abort()
    controller = null
    const salesOrderId = row.salesSource?.id ?? null
    // 备货类货件没有销售来源，客户与代收资料保持为空，不发无谓请求也不报错。
    if (salesOrderId === null) {
      salesOrder.value = null
      loading.value = false
      error.value = null
      return
    }
    const request = new AbortController()
    controller = request
    const requestEpoch = epoch.value
    loading.value = true
    error.value = null
    try {
      const response = await api.getById(salesOrderId, request.signal)
      if (current(request, requestEpoch)) {
        salesOrder.value = response.data
      }
    }
    catch (failure) {
      if (current(request, requestEpoch)) {
        error.value = getSalesOrderApiFailure(failure).message
      }
    }
    finally {
      if (controller === request) {
        loading.value = false
      }
    }
  }

  async function open(row: PurchaseShipmentListItemDto): Promise<void> {
    if (!enabled.value) {
      return
    }
    controller?.abort()
    controller = null
    shipment.value = row
    salesOrder.value = null
    loading.value = false
    error.value = null
    await load()
  }

  watch([enabled, epoch], () => close(), { flush: 'sync' })
  onScopeDispose(close)

  return { shipment, salesOrder, loading, error, open, load, close }
}
