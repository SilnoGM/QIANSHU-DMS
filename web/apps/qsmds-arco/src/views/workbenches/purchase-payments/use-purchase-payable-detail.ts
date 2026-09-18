import type { Ref } from 'vue'
import type { PurchasePayableOrderDto } from '../../../api/generated/types.gen'
import type { PurchasePayableSelection } from './purchase-payments.logic'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import { canPayPurchasePayable } from './purchase-payments.logic'

interface DetailReader {
  getByOrder: (id: string, signal: AbortSignal) => Promise<{ data: PurchasePayableOrderDto }>
  get: (id: string, signal: AbortSignal) => Promise<{ data: PurchasePayableOrderDto }>
}

export function usePurchasePayableDetail(
  target: Readonly<Ref<{ id: string, kind: 'payable' | 'order' }>>,
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  api: DetailReader = purchaseOrderPayablesApi,
) {
  const order = shallowRef<PurchasePayableOrderDto | null>(null)
  const selection = shallowRef<PurchasePayableSelection | null>(null)
  const loading = ref(false)
  const invalid = ref(false)
  const error = ref('')
  let controller: AbortController | null = null

  function applyOrder(updated: PurchasePayableOrderDto) {
    const byOrder = target.value.kind === 'order'
    const currentId = byOrder ? selection.value?.item.id : target.value.id
    const item = updated.items.find(item => item.id === currentId)
      ?? (byOrder ? updated.items.find(canPayPurchasePayable) ?? updated.items[0] : undefined)
    const matches = item && (!byOrder || updated.id === target.value.id)
    order.value = matches ? updated : null
    selection.value = matches ? { order: updated, item } : null
    invalid.value = !matches
  }

  function selectPayable(id: string) {
    const item = order.value?.items.find(item => item.id === id)
    if (enabled.value && target.value.kind === 'order' && order.value && item) {
      selection.value = { order: order.value, item }
    }
  }

  async function load() {
    controller?.abort()
    controller = null
    selection.value = null
    order.value = null
    error.value = ''
    invalid.value = false
    loading.value = false
    if (!enabled.value) {
      return
    }
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(target.value.id)) {
      invalid.value = true
      return
    }
    const request = new AbortController()
    const requestTarget = target.value
    const requestEpoch = epoch.value
    controller = request
    loading.value = true
    // 深链可以跨账号、跨款项重用；每次身份或路由变化都废弃之前的异步结果。
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === requestEpoch && target.value === requestTarget
    try {
      const response = await (requestTarget.kind === 'order' ? api.getByOrder : api.get)(requestTarget.id, request.signal)
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
  watch([target, enabled, epoch], () => {
    void load()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => controller?.abort())
  return { order, selection, loading, invalid, error, load, applyOrder, selectPayable }
}
