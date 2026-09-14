<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PurchaseOrderDetailActions from './purchase-order-detail-actions.vue'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

const props = defineProps<{
  active: boolean
  currencies: readonly CurrencyDescriptor[]
}>()
const emit = defineEmits<{
  detailUpdated: [detail: PurchaseOrderDetailDto]
  stale: []
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loadingOrderId = ref<string | null>(null)
const busy = ref(false)
const actionsRef = useTemplateRef<InstanceType<typeof PurchaseOrderDetailActions>>('actionsRef')
const canOpen = computed(() => props.active && auth('purchase-orders:read') && auth('purchase-orders:payment'))
let controller: AbortController | null = null

function reset(): void {
  controller?.abort()
  controller = null
  actionsRef.value?.cancelPendingRequests()
  detail.value = null
  loadingOrderId.value = null
  busy.value = false
}

/** 列表只选择目标订单；付款状态、金额和表单始终使用最新详情与抽屉共用的实现。 */
async function open(orderId: string): Promise<void> {
  if (!canOpen.value || loadingOrderId.value !== null || busy.value) {
    return
  }
  reset()
  const request = new AbortController()
  controller = request
  const epoch = account.authEpoch
  loadingOrderId.value = orderId
  const isCurrent = () => !request.signal.aborted && controller === request && epoch === account.authEpoch && canOpen.value
  try {
    const response = await purchaseOrdersApi.getById(orderId, request.signal)
    if (!isCurrent()) {
      return
    }
    if (response.data.orderStatus !== 'CONFIRMED' || response.data.paymentStatus === 'PAID') {
      toast.warning(t('purchaseOrderList.payment.unavailable'))
      emit('stale')
      return
    }
    detail.value = response.data
    await nextTick()
    if (isCurrent()) {
      actionsRef.value?.openPaymentDialog()
    }
  }
  catch (error) {
    if (isCurrent() && !isPurchaseOrderAbortError(error)) {
      const failure = getPurchaseOrderApiFailure(error)
      toast.error(failure.requestId ? `${failure.message}（requestId: ${failure.requestId}）` : failure.message)
    }
  }
  finally {
    if (controller === request) {
      controller = null
      loadingOrderId.value = null
    }
  }
}

function applyUpdatedDetail(updated: PurchaseOrderDetailDto): void {
  detail.value = updated
  emit('detailUpdated', updated)
}

// 离开待付款视图、身份或权限变化时卸载付款表单，取消旧请求和临时凭证预览。
watch(() => [props.active, account.authEpoch, canOpen.value] as const, reset)
onDeactivated(reset)
onBeforeUnmount(reset)

defineExpose({ open, loadingOrderId })
</script>

<template>
  <PurchaseOrderDetailActions
    v-if="detail"
    ref="actionsRef"
    :detail="detail"
    :currencies="currencies"
    @busy-change="busy = $event"
    @detail-updated="applyUpdatedDetail"
  />
</template>
