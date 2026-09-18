import type { Ref } from 'vue'
import type { PackagingPaymentProfileDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import api from '../../../api/modules/payment-recipients'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'

/** 固定厂商仅引用管理员配置；切换厂商和账号后不沿用上次加载的收款码。 */
export function usePackagingVendorProfile(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  vendor: Readonly<Ref<string | null>>,
  client: Pick<typeof api, 'getPackagingProfile'> = api,
) {
  const profile = shallowRef<PackagingPaymentProfileDto | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  function reset() {
    controller?.abort()
    controller = null
    profile.value = null
    loading.value = false
    error.value = ''
  }
  const ready = computed(() => enabled.value && vendor.value === 'CHENGXIN' && !loading.value && !error.value
    && Boolean(profile.value?.accounts.some(account => ['ALIPAY', 'WECHAT'].includes(account.paymentMethod) && account.qrMediaAssetId)))
  async function reload() {
    reset()
    if (!enabled.value || vendor.value !== 'CHENGXIN') {
      return
    }
    const request = controller = new AbortController()
    const requestEpoch = epoch.value
    const current = () => controller === request && !request.signal.aborted && enabled.value && vendor.value === 'CHENGXIN' && epoch.value === requestEpoch
    loading.value = true
    try {
      const result = await client.getPackagingProfile('CHENGXIN', request.signal)
      if (current()) {
        profile.value = result.data
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
  watch([enabled, epoch, vendor], () => {
    void reload()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(reset)
  return { profile, loading, error, ready, reload }
}
