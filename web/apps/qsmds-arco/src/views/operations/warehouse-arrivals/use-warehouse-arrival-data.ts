import type { Ref } from 'vue'
import type { ShipmentListQuery } from '../../workbenches/shipments/logic'
import type { PurchaseShipmentStatusCountsDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef } from 'vue'
import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import purchaseShipmentsApi from '../../../api/modules/purchase-shipments'
import { useShipmentData } from '../../workbenches/shipments/use-shipment-data'

type PurchaseShipmentReadApi = Pick<typeof purchaseShipmentsApi, 'getById' | 'list' | 'statusCounts'>

export function useWarehouseArrivalData(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  query: Readonly<Ref<ShipmentListQuery>>,
  onInvalidPage: (page: number) => void,
  api: PurchaseShipmentReadApi = purchaseShipmentsApi,
  orders = purchaseOrdersApi,
) {
  const warehouseCounts = shallowRef<{ value: string, items: PurchaseShipmentStatusCountsDto['items'] }[]>([])
  const warehouseCountsError = ref(false)
  let sequence = 0

  function clearWarehouseCounts(): void {
    sequence++
    warehouseCounts.value = []
    warehouseCountsError.value = false
  }

  const state = useShipmentData(enabled, epoch, query, onInvalidPage, {
    list: (filters, signal) => api.list(filters, signal),
    getById: (id, signal) => api.getById(id, signal),
    statusCounts: (filters, signal) => {
      clearWarehouseCounts()
      const requestSequence = sequence
      const requestEpoch = epoch.value
      const { destinationWarehouseValue: _warehouse, destinationWarehouseMissing: _missing, ...globalFilters } = filters

      // 复用共享读取的取消信号，权限、身份、筛选或页面生命周期变化时立即移除旧统计。
      signal.addEventListener('abort', () => {
        if (requestSequence === sequence) {
          clearWarehouseCounts()
        }
      }, { once: true })

      // 上层总数与逐仓库计数来自同一次快照；不再按仓库数量并发 N 个计数请求。
      const globalResponse = api.statusCounts(globalFilters, signal)
      void globalResponse.then((response) => {
        if (signal.aborted || !enabled.value || requestEpoch !== epoch.value || requestSequence !== sequence) {
          return
        }
        warehouseCounts.value = [...(response.data.warehouseCounts ?? [])]
        warehouseCountsError.value = false
      }).catch(() => {
        if (signal.aborted || !enabled.value || requestEpoch !== epoch.value || requestSequence !== sequence) {
          return
        }
        warehouseCountsError.value = true
      })
      return globalResponse
    },
  }, orders)

  onScopeDispose(clearWarehouseCounts)

  return { ...state, warehouseCounts, warehouseCountsError }
}
