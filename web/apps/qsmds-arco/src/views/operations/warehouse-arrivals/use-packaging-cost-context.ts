import type { Ref } from 'vue'
import type { PackagingCostShipmentContextDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import packagingCostsApi from '../../../api/modules/packaging-costs'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'

/** 归属人只读取关联销售单的出单人，不能用货件操作人或登录账号兜底。 */
export function usePackagingCostContext(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  partId: Readonly<Ref<string | null>>,
  api: Pick<typeof packagingCostsApi, 'shipmentContext'> = packagingCostsApi,
) {
  const context = shallowRef<PackagingCostShipmentContextDto | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  const unavailableReason = computed(() => context.value?.unavailableReason ?? null)
  const eligible = computed(() => enabled.value && !!partId.value && !loading.value && !error.value && context.value?.eligible === true && context.value.owner !== null)

  function clear(): void {
    controller?.abort()
    controller = null
    context.value = null
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
      const response = await api.shipmentContext(id, request.signal)
      if (current()) {
        context.value = response.data
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
  return { context, loading, error, eligible, unavailableReason, reload }
}
