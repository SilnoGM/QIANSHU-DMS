import type { Ref } from 'vue'
import type { PurchaseShipmentDetailDto, SalesOrderDetailDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseShipmentsApi from '../../../api/modules/purchase-shipments'
import salesOrdersApi from '../../../api/modules/sales-orders'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'

/** 归属人只读取关联销售单的出单人，不能用货件操作人或登录账号兜底。 */
export function usePackagingCostContext(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  partId: Readonly<Ref<string | null>>,
  shipments: Pick<typeof purchaseShipmentsApi, 'getById'> = purchaseShipmentsApi,
  sales: Pick<typeof salesOrdersApi, 'getById'> = salesOrdersApi,
) {
  const shipment = shallowRef<PurchaseShipmentDetailDto | null>(null)
  const owner = shallowRef<SalesOrderDetailDto['issuer'] | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  const unavailableReason = computed(() => {
    if (!shipment.value || shipment.value.viewStatus !== 'WAREHOUSE_RECEIVED') {
      return 'invalidShipment'
    }
    return shipment.value.salesSource ? null : 'noSalesSource'
  })
  const eligible = computed(() => enabled.value && !!partId.value && !loading.value && !error.value && unavailableReason.value === null && owner.value !== null)

  function clear(): void {
    controller?.abort()
    controller = null
    shipment.value = null
    owner.value = null
    loading.value = false
    error.value = ''
  }

  async function reload(): Promise<void> {
    clear()
    if (!enabled.value || !partId.value) {
      return
    }
    const id = partId.value
    const requestEpoch = epoch.value
    const request = new AbortController()
    controller = request
    loading.value = true
    // 关闭、换货件、撤权和换账号后，即使网络层没有及时取消，也不接受旧响应。
    const current = () => controller === request && !request.signal.aborted && enabled.value && partId.value === id && epoch.value === requestEpoch
    try {
      const response = await shipments.getById(id, request.signal)
      if (!current()) {
        return
      }
      shipment.value = response.data
      if (unavailableReason.value === null && response.data.salesSource) {
        const source = await sales.getById(response.data.salesSource.id, request.signal)
        if (current()) {
          owner.value = source.data.issuer
        }
      }
    }
    catch (failure) {
      if (current()) {
        error.value = getPurchaseOrderApiFailure(failure).message
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }

  watch([enabled, epoch, partId], () => {
    void reload()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(clear)
  return { shipment, owner, loading, error, eligible, unavailableReason, reload }
}
