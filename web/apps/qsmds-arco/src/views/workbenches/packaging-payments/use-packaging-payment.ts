import type { Ref } from 'vue'
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import packagingCostsApi from '../../../api/modules/packaging-costs'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'

export function usePackagingPayment(
  enabled: Readonly<Ref<boolean>>,
  canPay: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  requestId: Readonly<Ref<string | null>>,
  api: Pick<typeof packagingCostsApi, 'detail' | 'pay'> = packagingCostsApi,
) {
  const detail = shallowRef<PackagingCostRequestDto | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const loadError = ref('')
  const actionError = ref('')
  let controller: AbortController | null = null
  let payment: AbortController | null = null
  const payable = computed(() => enabled.value && canPay.value && !loading.value && !loadError.value && !busy.value && detail.value?.status === 'PENDING_PAYMENT')

  async function load() {
    controller?.abort()
    if (!enabled.value || !requestId.value) {
      detail.value = null
      loading.value = false
      return
    }
    const request = new AbortController()
    const id = requestId.value
    const requestEpoch = epoch.value
    controller = request
    loading.value = true
    loadError.value = ''
    const current = () => controller === request && !request.signal.aborted && enabled.value && requestId.value === id && epoch.value === requestEpoch
    try {
      const result = await api.detail(id, request.signal)
      if (current()) {
        detail.value = result.data
      }
    }
    catch (failure) {
      if (current()) {
        loadError.value = getPurchaseOrderApiFailure(failure).message
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }

  async function confirm(): Promise<boolean> {
    if (!payable.value || !detail.value) {
      return false
    }
    const record = detail.value
    const requestEpoch = epoch.value
    const request = new AbortController()
    payment = request
    busy.value = true
    actionError.value = ''
    const current = () => payment === request && !request.signal.aborted && enabled.value && canPay.value && epoch.value === requestEpoch && requestId.value === record.id
    try {
      const result = await api.pay(record.id, { expectedVersion: record.version }, request.signal)
      if (!current()) {
        return false
      }
      detail.value = result.data
      return true
    }
    catch (failure) {
      if (current()) {
        actionError.value = getPurchaseOrderApiFailure(failure).message
        // 并发付款、网络中断均先查询服务端事实，避免继续确认旧状态。
        await load()
      }
      return false
    }
    finally {
      if (payment === request) {
        busy.value = false
        payment = null
      }
    }
  }
  function reset() {
    controller?.abort()
    payment?.abort()
    controller = null
    payment = null
    detail.value = null
    loading.value = false
    busy.value = false
    loadError.value = ''
    actionError.value = ''
  }
  watch([enabled, epoch, requestId], () => {
    reset()
    void load()
  }, { immediate: true, flush: 'sync' })
  watch(canPay, (value) => {
    if (!value) {
      payment?.abort()
      busy.value = false
    }
  }, { flush: 'sync' })
  onScopeDispose(reset)
  return { detail, loading, busy, loadError, actionError, payable, load, confirm }
}
