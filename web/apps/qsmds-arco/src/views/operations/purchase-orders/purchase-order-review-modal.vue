<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildPurchaseOrderReviewRequest } from './purchase-order-detail.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'
import { hasPurchaseOrderShippingMarks } from './purchase-order-shipping-mark.logic'

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
const reason = ref('')
const error = ref('')
const loading = ref(false)
const submitting = ref(false)
let loadController: AbortController | null = null
let mutationController: AbortController | null = null

const canReview = computed(() => auth('purchase-orders:read') && auth('purchase-orders:review'))
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const canConfirm = computed(() => canReview.value && !loading.value && !submitting.value && detail.value?.orderStatus === 'PENDING_REVIEW')

function reset(): void {
  loadController?.abort()
  mutationController?.abort()
  loadController = null
  mutationController = null
  loading.value = false
  submitting.value = false
  detail.value = null
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
  try {
    const response = await purchaseOrdersApi.getById(orderId, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== orderId || !visible.value || !canReview.value) {
      return
    }
    detail.value = response.data
    if (response.data.orderStatus !== 'PENDING_REVIEW') {
      error.value = t('purchaseOrderList.review.statusChanged')
      emit('detailUpdated', response.data)
    }
    else if (previousFailure) {
      error.value = `${previousFailure}。${t('purchaseOrderList.review.reconfirm')}`
    }
  }
  catch (failure) {
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(failure)) {
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
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(failure)) {
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
    :title="t('purchaseOrderList.review.title')"
    :description="t('purchaseOrderList.review.description')"
    size="md"
    :loading="loading"
    :submitting="submitting"
  >
    <div data-testid="purchase-order-review-confirmation" class="space-y-4">
      <FaAlert v-if="error" :title="t('purchaseOrderList.review.failed')" :description="error" variant="destructive">
        <template #actions>
          <FaButton type="button" variant="outline" size="sm" :disabled="loading || submitting || !canReview" @click="loadDetail()">
            {{ t('purchaseOrderList.review.reload') }}
          </FaButton>
        </template>
      </FaAlert>
      <dl v-if="detail" class="text-sm m-0 p-4 border border-border rounded-xl bg-muted/15 gap-x-5 gap-y-4 grid sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderList.review.orderNo') }}
          </dt>
          <dd class="font-mono m-0 mt-1 break-words">
            {{ detail.orderNo }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderList.review.supplier') }}
          </dt>
          <dd class="font-medium m-0 mt-1 break-words">
            {{ detail.supplier.label }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderList.review.amount') }}
          </dt>
          <dd class="font-semibold m-0 mt-1">
            <AmountDisplay :value="detail.purchaseTotalAmount" :currency="detail.currencyCode" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderList.review.products') }}
          </dt>
          <dd class="m-0 mt-1 tabular-nums">
            {{ t('purchaseOrderList.review.quantity', { lines: detail.lines.length, quantity: detail.lineSummary.totalQuantity }) }}
          </dd>
        </div>
        <div class="sm:col-span-2" data-testid="purchase-order-review-shipping-mark">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderList.review.shippingMark') }}
          </dt>
          <dd class="leading-6 m-0 mt-1">
            {{ hasPurchaseOrderShippingMarks(detail) ? t('purchaseOrderList.review.preserveShippingMarks') : t('purchaseOrderList.review.generateShippingMark', { count: detail.parts.length }) }}
          </dd>
        </div>
      </dl>
      <label class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseOrderList.review.reason') }}</span>
        <FaTextarea v-model="reason" maxlength="500" :disabled="loading || submitting || !canReview" input-class="min-h-20" />
      </label>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="submitting" @click="visible = false">
        {{ t('purchaseOrderList.review.cancel') }}
      </FaButton>
      <FaButton type="button" class="min-h-11 sm:min-h-9" :disabled="!canConfirm" :loading="submitting" @click="submit">
        {{ t('purchaseOrderList.review.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
