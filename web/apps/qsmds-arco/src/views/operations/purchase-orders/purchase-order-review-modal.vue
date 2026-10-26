<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderReviewContextDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import OrderParts from '@/components/business/QsPurchaseOrderDrawer/OrderParts.vue'
import { buildPurchaseOrderCopyText } from './purchase-order-copy.logic'
import { buildPurchaseOrderRejectRequest, buildPurchaseOrderReviewRequest } from './purchase-order-detail.logic'
import { copyPurchaseOrderImageToClipboard } from './purchase-order-image-copy.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'
import PurchaseOrderReviewDetails from './purchase-order-review-details.vue'
import PurchaseOrderReviewImage from './purchase-order-review-image.vue'
import PurchaseOrderReviewSummary from './purchase-order-review-summary.vue'
import { usePurchaseOrderImageCopy } from './use-purchase-order-image-copy'
import { usePurchaseOrderImageGeneration } from './use-purchase-order-image-generation'

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
const copying = ref(false)
const copyInfoVisible = ref(false)
const rejectVisible = ref(false)
const rejectReason = ref('')
const rejectReasonError = ref('')
const rejectError = ref('')
const rejecting = ref(false)
let copySequence = 0
let loadController: AbortController | null = null
let mutationController: AbortController | null = null
let rejectController: AbortController | null = null

const canReview = computed(() => auth('purchase-orders:read') && auth('purchase-orders:review'))
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const image = usePurchaseOrderImageGeneration({
  detail,
  orderId: computed(() => props.orderId),
  enabled: computed(() => visible.value && canReview.value),
  epoch: computed(() => account.authEpoch),
})
const busy = computed(() => submitting.value || rejecting.value || image.generating.value)
const canCopy = computed(() => visible.value && canReview.value && !loading.value && !busy.value && !copying.value && detail.value !== null && detail.value.id === props.orderId)
const copyText = computed(() => detail.value === null ? '' : buildPurchaseOrderCopyText(detail.value, t))
const copyDescription = computed(() => detail.value === null ? undefined : `${detail.value.orderNo} · ${detail.value.supplier.label}`)
const canCopyText = computed(() => copyInfoVisible.value && canCopy.value && copyText.value.length > 0)
const draftCurrent = computed(() => {
  const draft = image.draft.value
  const current = detail.value
  return draft !== null && current !== null && draft.isCurrent && draft.orderVersion === current.version
})
const copyImageHint = computed(() => {
  if (detail.value === null) {
    return ''
  }
  if (image.draft.value === null) {
    return detail.value.orderStatus === 'PENDING_REVIEW'
      ? t('purchaseReview.copy.imageMissing')
      : t('purchaseReview.copy.imageUnavailable')
  }
  if (!draftCurrent.value) {
    return t('purchaseReview.copy.imageStale')
  }
  if (image.imageFailed.value || image.previewUrl.value === null) {
    return t('purchaseReview.copy.imageLoadFailed')
  }
  if (!image.imageLoaded.value) {
    return t('purchaseReview.image.loading')
  }
  return ''
})
const imageCopy = usePurchaseOrderImageCopy({
  busy,
  canReview,
  copyInfoVisible,
  detail,
  draft: image.draft,
  epoch: computed(() => account.authEpoch),
  imageReady: image.ready,
  loading,
  orderId: computed(() => props.orderId),
  previewBlob: image.previewBlob,
  previewUrl: image.previewUrl,
  visible,
}, {
  copy: copyPurchaseOrderImageToClipboard,
  onFailure: key => toast.error(t(key)),
  onSuccess: () => toast.success(t('purchaseReview.copy.imageSuccess')),
})
const canGenerate = computed(() => canReview.value && !loading.value && !busy.value && detail.value?.orderStatus === 'PENDING_REVIEW' && reviewContext.value?.available === true)
const canConfirm = computed(() => canGenerate.value && image.ready.value)
const canReject = computed(() => (
  visible.value
  && canReview.value
  && !loading.value
  && !busy.value
  && detail.value?.orderStatus === 'PENDING_REVIEW'
  && detail.value.id === props.orderId
))
const generationStep = ref(0)
const terminalNotice = computed(() => {
  if (detail.value?.rejection !== null && detail.value?.rejection !== undefined) {
    return t('purchaseReview.recovery.rejected')
  }
  if (detail.value?.orderStatus === 'CANCELLED') {
    return t('purchaseReview.recovery.cancelled')
  }
  if (detail.value?.orderStatus === 'CONFIRMED' || detail.value?.orderStatus === 'COMPLETED') {
    return t('purchaseReview.recovery.approved')
  }
  return ''
})

function reset(): void {
  copySequence += 1
  copying.value = false
  imageCopy.reset()
  copyInfoVisible.value = false
  rejectController?.abort()
  rejectController = null
  rejectVisible.value = false
  rejectReason.value = ''
  rejectReasonError.value = ''
  rejectError.value = ''
  rejecting.value = false
  image.reset()
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

function openCopyInfo(): void {
  if (!canCopy.value) {
    return
  }
  copyInfoVisible.value = true
}

async function copyPurchaseInfo(): Promise<void> {
  const current = detail.value
  if (!canCopy.value || current === null) {
    return
  }
  const sequence = ++copySequence
  const epoch = account.authEpoch
  const isCurrent = () => sequence === copySequence && epoch === account.authEpoch && visible.value && canReview.value && props.orderId === current.id
  copying.value = true
  try {
    await navigator.clipboard.writeText(copyText.value)
    if (isCurrent()) {
      toast.success(t('purchaseReview.copy.success'))
    }
  }
  catch {
    if (isCurrent()) {
      toast.error(t('purchaseReview.copy.failed'))
    }
  }
  finally {
    // 剪贴板请求不可取消；关闭或切换弹窗后，其迟到结果不能回写新弹窗状态。
    if (sequence === copySequence) {
      copying.value = false
    }
  }
}

function markCopyImageLoaded(): void {
  const url = image.previewUrl.value
  if (url !== null) {
    image.markLoaded(url)
  }
}

function markCopyImageFailed(): void {
  const url = image.previewUrl.value
  if (url !== null) {
    image.markFailed(url)
  }
}

function openCopyImagePreview(event: KeyboardEvent): void {
  if (image.imageLoaded.value && event.currentTarget instanceof HTMLElement) {
    event.currentTarget.querySelector('img')?.click()
  }
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
  // 重取详情会清空图片预览；先收起复制弹窗，避免展示一半文本、一半空图片。
  copyInfoVisible.value = false
  loadController?.abort()
  image.reset()
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
    await image.restore(response.data, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== orderId || !visible.value || !canReview.value) {
      return
    }
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

function generateImage(regenerate: boolean): void {
  if (!canGenerate.value) {
    return
  }
  error.value = ''
  generationStep.value = 0
  image.start(regenerate, [
    t('purchaseReview.image.steps.detail'),
    t('purchaseReview.image.steps.marks'),
    t('purchaseReview.image.steps.image'),
  ])
}

async function generationFailed(failure: unknown): Promise<void> {
  if (image.fail(failure)) {
    // 派号或渲染的未知结果必须重取草稿和版本，保留已完成的服务端阶段。
    await loadDetail(failureMessage(failure))
  }
}

async function submit(): Promise<void> {
  const current = detail.value
  if (!canConfirm.value || current === null) {
    return
  }
  const result = buildPurchaseOrderReviewRequest(current, reason.value, image.draft.value)
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

function openRejectDialog(): void {
  if (!canReject.value) {
    return
  }
  rejectReason.value = ''
  rejectReasonError.value = ''
  rejectError.value = ''
  rejectVisible.value = true
}

function closeRejectDialog(value: boolean): void {
  if (rejecting.value) {
    return
  }
  rejectVisible.value = value
  if (!value) {
    rejectReason.value = ''
    rejectReasonError.value = ''
    rejectError.value = ''
  }
}

async function submitReject(): Promise<void> {
  const current = detail.value
  if (!canReject.value || current === null || rejecting.value) {
    return
  }
  const result = buildPurchaseOrderRejectRequest(current, rejectReason.value)
  if (!result.valid) {
    rejectReasonError.value = result.fieldError
    return
  }
  rejectReasonError.value = ''
  rejectError.value = ''
  const controller = new AbortController()
  rejectController = controller
  const epoch = account.authEpoch
  rejecting.value = true
  try {
    const response = await purchaseOrdersApi.reject(current.id, result.request, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch || props.orderId !== current.id || !visible.value || !canReview.value) {
      return
    }
    emit('detailUpdated', response.data)
    toast.success(t('purchaseReview.reject.success'))
    rejecting.value = false
    rejectVisible.value = false
    visible.value = false
  }
  catch (failure) {
    if (!controller.signal.aborted && epoch === account.authEpoch && props.orderId === current.id && visible.value && !isPurchaseOrderAbortError(failure)) {
      // 驳回与审核互斥；冲突时关闭驳回弹窗并重新读取，让主弹窗展示最新终态。
      rejectVisible.value = false
      await loadDetail(failureMessage(failure))
    }
  }
  finally {
    if (rejectController === controller) {
      rejectController = null
      rejecting.value = false
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
    :submitting="busy"
  >
    <div data-testid="purchase-order-review-confirmation" class="flex flex-col gap-4">
      <FaAlert v-if="terminalNotice" :title="terminalNotice" :class="detail?.orderStatus !== 'CANCELLED' ? 'border-primary/30 bg-primary/5 text-primary' : ''" />
      <FaAlert v-if="error" :title="t('purchaseReview.recovery.checkRequired')" variant="destructive">
        <template #description>
          <p class="m-0 whitespace-pre-wrap">
            {{ error }}
          </p>
          <FaButton type="button" variant="outline" size="sm" class="mt-3" :disabled="loading || busy || !canReview" @click="loadDetail()">
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
      <PurchaseOrderReviewImage
        v-if="detail?.orderStatus === 'PENDING_REVIEW'"
        :draft="image.draft.value"
        :preview-url="image.previewUrl.value"
        :image-loaded="image.imageLoaded.value"
        :image-failed="image.imageFailed.value"
        :busy="loading || busy"
        :can-generate="canGenerate"
        @generate="generateImage"
        @image-load="image.markLoaded"
        @image-error="image.markFailed"
      />
      <span v-if="image.generating.value" class="sr-only" role="status">{{ image.steps.value[generationStep]?.text }}</span>
      <label v-if="detail?.orderStatus === 'PENDING_REVIEW'" class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseOrderList.review.reason') }}</span>
        <FaTextarea v-model="reason" maxlength="500" :disabled="loading || busy || !canReview" input-class="min-h-20" />
      </label>
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-2 w-full items-center justify-end">
        <FaButton
          v-if="detail?.orderStatus === 'PENDING_REVIEW'"
          type="button"
          variant="outline"
          data-testid="purchase-order-review-footer-generate"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :disabled="!canGenerate"
          @click="generateImage(image.draft.value !== null)"
        >
          <FaIcon :name="image.draft.value ? 'i-lucide:refresh-cw' : 'i-lucide:image-plus'" aria-hidden="true" />
          {{ t(image.draft.value ? 'purchaseReview.image.regenerate' : 'purchaseReview.image.generate') }}
        </FaButton>
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:mr-auto sm:min-h-9 sm:w-auto" :disabled="!canCopy" @click="openCopyInfo">
          <FaIcon name="i-lucide:copy" aria-hidden="true" />
          {{ t('purchaseReview.copy.label') }}
        </FaButton>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="busy" @click="visible = false">
          {{ t('purchaseReview.image.close') }}
        </FaButton>
        <FaButton v-if="detail?.orderStatus === 'PENDING_REVIEW'" type="button" variant="outline" class="text-destructive min-h-11 sm:min-h-9" :disabled="!canReject" @click="openRejectDialog">
          {{ t('purchaseReview.reject.action') }}
        </FaButton>
        <FaButton v-if="detail?.orderStatus === 'PENDING_REVIEW'" type="button" class="min-h-11 sm:min-h-9" :disabled="!canConfirm" :loading="submitting" @click="submit">
          {{ t('purchaseOrderList.review.confirm') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
  <QsGenericModal
    v-model="copyInfoVisible"
    :title="t('purchaseReview.copy.title')"
    :description="copyDescription"
    size="2xl"
  >
    <div data-testid="purchase-order-copy-info" class="gap-4 grid md:grid-cols-2 md:h-[60vh] md:max-h-[40rem]">
      <section class="p-3 border border-border/70 rounded-xl bg-muted/15 flex flex-col gap-2 min-h-0">
        <h3 class="qs-type-body-medium m-0">
          {{ t('purchaseReview.copy.textTitle') }}
        </h3>
        <div
          tabindex="0"
          role="region"
          :aria-label="t('purchaseReview.copy.textTitle')"
          class="text-sm m-0 p-3 rounded-lg bg-background/60 h-[36vh] min-h-0 whitespace-pre-wrap [overflow-wrap:anywhere] overflow-auto md:flex-1 md:h-auto"
          v-text="copyText"
        />
      </section>
      <section class="p-3 border border-border/70 rounded-xl bg-muted/15 flex flex-col gap-2 min-h-0">
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <h3 class="qs-type-body-medium m-0">
            {{ t('purchaseReview.image.title') }}
          </h3>
          <FaTag v-if="image.draft.value" variant="outline" :class="draftCurrent ? 'border-primary/30 bg-primary/5 text-primary' : 'border-destructive/30 bg-destructive/5 text-destructive'">
            {{ t(draftCurrent ? 'purchaseReview.image.ready' : 'purchaseReview.image.outdated') }}
          </FaTag>
        </div>
        <div class="p-2 rounded-lg bg-white flex h-[46vh] min-h-0 items-center justify-center overflow-hidden md:flex-1 md:h-auto">
          <FaImagePreview
            v-if="image.previewUrl.value"
            :key="image.previewUrl.value"
            :src="image.previewUrl.value"
            :aria-label="t('purchaseReview.image.preview')"
            :aria-disabled="!image.imageLoaded.value"
            role="button"
            tabindex="0"
            class="h-auto max-h-[40vh] max-w-full w-auto object-contain md:max-h-[48vh] sm:max-h-[44vh]"
            @load="markCopyImageLoaded"
            @error="markCopyImageFailed"
            @keydown.enter.prevent="openCopyImagePreview"
            @keydown.space.prevent="openCopyImagePreview"
          />
          <p v-else class="qs-type-meta text-muted-foreground m-0 p-4 text-center">
            {{ copyImageHint }}
          </p>
        </div>
        <p v-if="image.previewUrl.value && copyImageHint" class="qs-type-meta m-0" :class="image.imageFailed.value ? 'text-destructive' : 'text-muted-foreground'">
          {{ copyImageHint }}
        </p>
      </section>
    </div>
    <template #footer>
      <div class="gap-2 grid w-full md:gap-4 md:grid-cols-2">
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9" :disabled="!canCopyText" :loading="copying" @click="copyPurchaseInfo">
          <FaIcon name="i-lucide:copy" aria-hidden="true" />
          {{ t('purchaseReview.copy.copyText') }}
        </FaButton>
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9" :disabled="!imageCopy.canCopy.value" :loading="imageCopy.copying.value" @click="imageCopy.copy">
          <FaIcon name="i-lucide:image" aria-hidden="true" />
          {{ t('purchaseReview.copy.copyImage') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
  <QsGenericModal
    :model-value="rejectVisible"
    :title="t('purchaseReview.reject.title')"
    :description="t('purchaseReview.reject.description')"
    size="sm"
    :submitting="rejecting"
    @update:model-value="closeRejectDialog"
  >
    <div class="space-y-4">
      <FaAlert v-if="rejectError" :description="rejectError" variant="destructive" />
      <div>
        <label for="purchase-order-reject-reason" class="text-sm font-medium">
          {{ t('purchaseReview.reject.reason') }} <span class="text-destructive" aria-hidden="true">*</span>
        </label>
        <FaTextarea
          id="purchase-order-reject-reason"
          v-model="rejectReason"
          class="mt-2"
          :rows="3"
          :maxlength="500"
          :placeholder="t('purchaseReview.reject.placeholder')"
          :disabled="rejecting"
        />
        <p v-if="rejectReasonError" class="text-xs text-destructive m-0 mt-1">
          {{ rejectReasonError }}
        </p>
      </div>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="rejecting" @click="closeRejectDialog(false)">
        {{ t('purchaseReview.reject.back') }}
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="rejecting" :disabled="rejecting" @click="submitReject">
        {{ t('purchaseReview.reject.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
  <FaMultiStepLoader
    :loading="image.generating.value"
    :steps="image.steps.value"
    prevent-close
    @state-change="generationStep = $event"
    @complete="image.complete"
    @error="generationFailed"
  />
</template>
