import type { Ref } from 'vue'
import type { PurchasePayableOrderDto } from '../../../api/generated/types.gen'
import type { PurchasePayableSelection } from './purchase-payments.logic'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'

interface DetailReader {
  get: (id: string, signal: AbortSignal) => Promise<{ data: PurchasePayableOrderDto }>
}

export function usePurchasePayableDetail(
  id: Readonly<Ref<string>>,
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  api: DetailReader = purchaseOrderPayablesApi,
) {
  const selection = shallowRef<PurchasePayableSelection | null>(null)
  const loading = ref(false)
  const invalid = ref(false)
  const error = ref('')
  let controller: AbortController | null = null

  function applyOrder(order: PurchasePayableOrderDto) {
    const item = order.items.find(item => item.id === id.value)
    selection.value = item ? { order, item } : null
    invalid.value = !item
  }

  async function load() {
    controller?.abort()
    controller = null
    selection.value = null
    error.value = ''
    invalid.value = false
    loading.value = false
    if (!enabled.value) {
      return
    }
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id.value)) {
      invalid.value = true
      return
    }
    const request = new AbortController()
    const requestId = id.value
    const requestEpoch = epoch.value
    controller = request
    loading.value = true
    // 深链可以跨账号、跨款项重用；每次身份或路由变化都废弃之前的异步结果。
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === requestEpoch && id.value === requestId
    try {
      const response = await api.get(requestId, request.signal)
      if (current()) {
        applyOrder(response.data)
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
  watch([id, enabled, epoch], () => {
    void load()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => controller?.abort())
  return { selection, loading, invalid, error, load, applyOrder }
}
