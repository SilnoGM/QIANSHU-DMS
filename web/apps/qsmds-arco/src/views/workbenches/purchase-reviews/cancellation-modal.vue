<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from '../../operations/purchase-orders/purchase-order-list.logic'
import { buildPurchaseCancellationText, purchaseCancellationBlockReason } from './cancellation.logic'

const props = defineProps<{ modelValue: boolean, orderId: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean], 'cancelled': [detail: PurchaseOrderDetailDto] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loading = ref(false)
const submitting = ref(false)
const copying = ref(false)
const completed = ref(false)
const loadError = ref('')
const actionError = ref('')
let controller: AbortController | null = null
let sequence = 0
const canReview = computed(() => auth('purchase-orders:read') && auth('purchase-orders:review'))
const busy = computed(() => submitting.value || copying.value)
const blockReason = computed(() => detail.value ? purchaseCancellationBlockReason(detail.value) : null)
const copyText = computed(() => detail.value ? buildPurchaseCancellationText(detail.value, t) : '')
const canConfirm = computed(() => props.modelValue && canReview.value && !loading.value && !busy.value && !completed.value && detail.value?.id === props.orderId && detail.value !== null && blockReason.value === null)

function reset(): void {
  sequence++
  controller?.abort()
  controller = null
  detail.value = null
  loading.value = false
  submitting.value = false
  copying.value = false
  completed.value = false
  loadError.value = ''
  actionError.value = ''
}
function setVisible(value: boolean): void {
  if (!busy.value) {
    emit('update:modelValue', value)
  }
}
async function loadDetail(): Promise<void> {
  reset()
  if (!props.modelValue || !props.orderId || !canReview.value) {
    return
  }
  const request = new AbortController()
  controller = request
  const id = props.orderId
  const epoch = account.authEpoch
  loading.value = true
  try {
    const response = await purchaseOrdersApi.getById(id, request.signal)
    if (!request.signal.aborted && epoch === account.authEpoch && canReview.value && props.modelValue && props.orderId === id) {
      detail.value = response.data
    }
  }
  catch (failure) {
    if (!request.signal.aborted && epoch === account.authEpoch && !isPurchaseOrderAbortError(failure)) {
      loadError.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
      loading.value = false
    }
  }
}
async function copyCancelledInfo(): Promise<void> {
  if (!props.modelValue || !completed.value || !detail.value || detail.value.id !== props.orderId || !canReview.value || copying.value) {
    return
  }
  const attempt = sequence
  const epoch = account.authEpoch
  const id = props.orderId
  const current = () => attempt === sequence && epoch === account.authEpoch && props.orderId === id && props.modelValue && canReview.value
  copying.value = true
  try {
    await navigator.clipboard.writeText(copyText.value)
    if (current()) {
      toast.success(t('purchaseReview.cancellation.success'))
      copying.value = false
      emit('update:modelValue', false)
    }
  }
  catch {
    if (current()) {
      // 已取消与复制失败是两个独立结果；重试只写剪贴板，不能再次取消订单。
      actionError.value = t('purchaseReview.cancellation.copyFailed')
      toast.warning(actionError.value)
    }
  }
  finally {
    if (attempt === sequence) {
      copying.value = false
    }
  }
}
async function submit(): Promise<void> {
  if (!canConfirm.value || !detail.value) {
    return
  }
  const id = detail.value.id
  const epoch = account.authEpoch
  const attempt = sequence
  const request = new AbortController()
  controller = request
  const current = () => !request.signal.aborted && attempt === sequence && epoch === account.authEpoch && props.modelValue && props.orderId === id && canReview.value
  submitting.value = true
  actionError.value = ''
  try {
    const response = await purchaseOrdersApi.updateOrderStatus(id, { toStatus: 'CANCELLED' }, request.signal)
    if (!current()) {
      return
    }
    detail.value = response.data
    completed.value = true
    emit('cancelled', response.data)
    submitting.value = false
    await copyCancelledInfo()
  }
  catch (failure) {
    if (current() && !isPurchaseOrderAbortError(failure)) {
      actionError.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
      submitting.value = false
    }
  }
}
watch(() => [props.modelValue, props.orderId, account.authEpoch, canReview.value] as const, () => {
  void loadDetail()
}, { immediate: true })
onDeactivated(reset)
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal :model-value="modelValue" :title="t('purchaseReview.cancellation.title')" :description="t('purchaseReview.cancellation.description')" size="md" :loading="loading" :error="loadError || undefined" :submitting="busy" @update:model-value="setVisible">
    <template #header-leading>
      <FaIcon name="i-lucide:circle-x" class="text-destructive size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="loadDetail">
        {{ t('purchaseReview.retry') }}
      </FaButton>
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" :variant="completed ? 'default' : 'destructive'" />
      <FaAlert v-else-if="!completed && blockReason" :description="t(`purchaseReview.cancellation.${blockReason}`)" variant="destructive" />
      <pre v-if="detail" class="qs-type-body text-foreground m-0 p-4 border border-border rounded-lg bg-muted/20 whitespace-pre-wrap break-words">{{ copyText }}</pre>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="busy" @click="setVisible(false)">
        {{ t(completed ? 'purchaseReview.cancellation.close' : 'purchaseReview.cancellation.back') }}
      </FaButton>
      <FaButton v-if="completed" type="button" :loading="copying" @click="copyCancelledInfo">
        {{ t('purchaseReview.cancellation.retryCopy') }}
      </FaButton>
      <FaButton v-else type="button" variant="destructive" :disabled="!canConfirm" :loading="submitting" @click="submit">
        {{ t('purchaseReview.cancellation.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
