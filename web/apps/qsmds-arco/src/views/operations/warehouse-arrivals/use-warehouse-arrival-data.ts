import type { Ref } from 'vue'
import type { ShipmentListQuery } from '../../workbenches/shipments/logic'
import type { PurchaseShipmentStatusCountsDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import purchaseShipmentsApi from '../../../api/modules/purchase-shipments'
import { useShipmentData } from '../../workbenches/shipments/use-shipment-data'

export function useWarehouseArrivalData(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  query: Readonly<Ref<ShipmentListQuery>>,
  onInvalidPage: (page: number) => void,
  warehouseValues: Readonly<Ref<readonly string[]>>,
  api = purchaseShipmentsApi,
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
      const values = [...new Set(warehouseValues.value)]

      // 复用共享读取的取消信号，权限、身份、筛选或页面生命周期变化时立即移除旧统计。
      signal.addEventListener('abort', () => {
        if (requestSequence === sequence) {
          clearWarehouseCounts()
        }
      }, { once: true })

      // 上层总数不受所选仓库限制；两层统计独立完成，某个仓库失败不能拖住上层计数。
      const globalResponse = api.statusCounts(globalFilters, signal)
      void Promise.allSettled(values.map(async (value) => {
        const response = await api.statusCounts({ ...globalFilters, destinationWarehouseValue: value }, signal)
        return { value, items: response.data.items }
      })).then((results) => {
        if (signal.aborted || !enabled.value || requestEpoch !== epoch.value || requestSequence !== sequence) {
          return
        }
        // 失败仓库保持未知，不把请求失败误显示为零；其他仓库的有效结果仍可使用。
        warehouseCounts.value = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
        warehouseCountsError.value = results.some(result => result.status === 'rejected')
      })
      return globalResponse
    },
  }, orders)

  watch(() => JSON.stringify([...new Set(warehouseValues.value)]), () => {
    if (enabled.value) {
      void state.loadCounts()
    }
  }, { flush: 'sync' })
  onScopeDispose(clearWarehouseCounts)

  return { ...state, warehouseCounts, warehouseCountsError }
}
