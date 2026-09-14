<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderReviewContextDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import OrderParts from '@/components/business/QsPurchaseOrderDrawer/OrderParts.vue'
import { buildPurchaseOrderReviewRequest } from './purchase-order-detail.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'
import PurchaseOrderReviewDetails from './purchase-order-review-details.vue'
import PurchaseOrderReviewSummary from './purchase-order-review-summary.vue'

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  orderId: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'detailUpdated': [detail: PurchaseOrderDetailDto]
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const reviewContext = shallowRef<PurchaseOrderReviewContextDto | null>(null)
const reason = ref('')
const error = ref('')
const loading = ref(false)
const submitting = ref(false)
let loadController: AbortController | null = null
let mutationController: AbortController | null = null

const canReview = computed(() => auth('purchase-orders:read') && auth('purchase-orders:review'))
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const canConfirm = computed(() => canReview.value && !loading.value && !submitting.value && detail.value?.orderStatus === 'PENDING_REVIEW' && reviewContext.value?.available === true)
const terminalNotice = computed(() => {
  if (detail.value?.orderStatus === 'CANCELLED') {
    return t('purchaseReview.recovery.cancelled')
  }
  if (detail.value?.orderStatus === 'CONFIRMED' || detail.value?.orderStatus === 'COMPLETED') {
    return t('purchaseReview.recovery.approved')
  }
  return ''
})

function reset(): void {
  loadController?.abort()
  mutationController?.abort()
  loadController = null
  mutationController = null
  loading.value = false
  submitting.value = false
  detail.value = null
  reviewContext.value = null
  reason.value = ''
  error.value = ''
}

function failureMessage(failure: unknown): string {
  const result = getPurchaseOrderApiFailure(failure)
  return result.requestId ? `${result.message}（requestId: ${result.requestId}）` : result.message
}

/** 打开与失败恢复均重取详情；列表快照不作为审核版本或确认摘要的依据。 */
async function loadDetail(previousFailure = ''): Promise<void> {
  const orderId = props.orderId
  if (!visible.value || orderId === null || !canReview.value) {
    return
  }
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  const epoch = account.authEpoch
  loading.value = true
  error.value = previousFailure
  detail.value = null
  reviewContext.value = null
  try {
    const response = await purchaseOrdersApi.getById(orderId, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== orderId || !visible.value || !canReview.value) {
      return
    }
    detail.value = response.data
    if (response.data.orderStatus !== 'PENDING_REVIEW') {
      // 未知提交结果只报告当前事实，不把其他审核人的操作宣称为本次成功。
      error.value = ''
      emit('detailUpdated', response.data)
      return
    }
    const contextResponse = await purchaseOrdersApi.reviewContext(orderId, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== orderId || !visible.value || !canReview.value) {
      return
    }
    reviewContext.value = contextResponse.data
    error.value = !contextResponse.data.available
      ? contextResponse.data.message || t('purchaseReview.recovery.unavailable')
      : previousFailure ? `${previousFailure}。${t('purchaseReview.recovery.pending')}` : ''
  }
  catch (failure) {
    if (!controller.signal.aborted && epoch === account.authEpoch && props.orderId === orderId && visible.value && !isPurchaseOrderAbortError(failure)) {
      error.value = [previousFailure, failureMessage(failure)].filter(Boolean).join('。')
    }
  }
  finally {
    if (loadController === controller) {
      loadController = null
      loading.value = false
    }
  }
}

async function submit(): Promise<void> {
  const current = detail.value
  if (!canConfirm.value || current === null) {
    return
  }
  const result = buildPurchaseOrderReviewRequest(current, reason.value)
  if (!result.valid) {
    error.value = result.fieldError
    return
  }
  const controller = new AbortController()
  mutationController = controller
  const epoch = account.authEpoch
  submitting.value = true
  error.value = ''
  try {
    const response = await purchaseOrdersApi.review(current.id, result.request, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== current.id || !visible.value || !canReview.value) {
      return
    }
    emit('detailUpdated', response.data)
    toast.success(t('purchaseOrderList.review.success'))
    // 先解除关闭守卫，再关闭；避免 QsGenericModal 拒绝回写并重新打开。
    submitting.value = false
    visible.value = false
  }
  catch (failure) {
    if (!controller.signal.aborted && epoch === account.authEpoch && props.orderId === current.id && visible.value && !isPurchaseOrderAbortError(failure)) {
      // 版本冲突或未知提交结果一律重新查询；保留说明，要求核对新摘要后再次确认。
      await loadDetail(failureMessage(failure))
    }
  }
  finally {
    if (mutationController === controller) {
      mutationController = null
      submitting.value = false
    }
  }
}

watch(() => [props.modelValue, props.orderId] as const, ([open]) => {
  reset()
  if (open) {
    void loadDetail()
  }
}, { immediate: true })
watch(() => [account.authEpoch, canReview.value] as const, () => {
  reset()
  visible.value = false
})
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="terminalNotice ? t('purchaseReview.detailTitle') : t('purchaseOrderList.review.title')"
    :description="terminalNotice ? undefined : t('purchaseOrderList.review.description')"
    size="xl"
    :loading="loading"
    :submitting="submitting"
  >
    <div data-testid="purchase-order-review-confirmation" class="flex flex-col gap-4">
      <FaAlert v-if="terminalNotice" :title="terminalNotice" :class="detail?.orderStatus !== 'CANCELLED' ? 'border-primary/30 bg-primary/5 text-primary' : ''" />
      <FaAlert v-if="error" :title="t('purchaseReview.recovery.checkRequired')" variant="destructive">
        <template #description>
          <p class="m-0 whitespace-pre-wrap">
            {{ error }}
          </p>
          <FaButton type="button" variant="outline" size="sm" class="mt-3" :disabled="loading || submitting || !canReview" @click="loadDetail()">
            <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchaseOrderList.review.reload') }}
          </FaButton>
        </template>
      </FaAlert>
      <PurchaseOrderReviewSummary v-if="detail && terminalNotice" :summary="detail.reviewSummary" />
      <PurchaseOrderReviewDetails v-if="detail" :detail="detail" :currencies="currencies" />
      <template v-if="detail">
        <OrderParts :detail="detail" />
        <p v-if="detail.parts.length === 0" class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchaseOrderList.review.noParts') }}
        </p>
      </template>
      <label v-if="detail?.orderStatus === 'PENDING_REVIEW'" class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseOrderList.review.reason') }}</span>
        <FaTextarea v-model="reason" maxlength="500" :disabled="loading || submitting || !canReview" input-class="min-h-20" />
      </label>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="submitting" @click="visible = false">
        {{ t('purchaseOrderList.review.cancel') }}
      </FaButton>
      <FaButton v-if="detail?.orderStatus === 'PENDING_REVIEW'" type="button" class="min-h-11 sm:min-h-9" :disabled="!canConfirm" :loading="submitting" @click="submit">
        {{ t('purchaseOrderList.review.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
