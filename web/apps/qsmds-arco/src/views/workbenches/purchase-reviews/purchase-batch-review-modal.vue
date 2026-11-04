<script setup lang="ts">
import type { PurchaseBatchItemState } from './batch-review.logic'
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { QsGenericModalCloseReason } from '@/components/business/QsGenericModal/logic'

import Decimal from 'decimal.js'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildPurchaseOrderReviewRequest,
} from '../../operations/purchase-orders/purchase-order-detail.logic'
import {
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
} from '../../operations/purchase-orders/purchase-order-list.logic'
import {
  createPurchaseBatchItem,
  isPurchaseBatchAuthError,
  isPurchaseBatchImageStaleError,
  isPurchaseBatchRetryableError,
  PURCHASE_BATCH_REVIEW_DEFAULT_REASON,
  PURCHASE_BATCH_REVIEW_LIMIT,
  resolvePurchaseBatchActions,
  summarizePurchaseBatch,
} from './batch-review.logic'
import PurchaseBatchReviewCard from './purchase-batch-review-card.vue'
import { createPurchaseOrderBatchPreviewUrl } from './purchase-order-batch-preview'

defineOptions({ name: 'PurchaseBatchReviewModal' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  orders: readonly PurchaseOrderListItemDto[]
}>()
const emit = defineEmits<{
  'closed': []
  'update:modelValue': [value: boolean]
}>()
const { t } = useI18n()
const toast = useQsToast()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const items = ref<PurchaseBatchItemState[]>([])
const reason = ref(PURCHASE_BATCH_REVIEW_DEFAULT_REASON)
const running = ref<'generate' | 'preload' | 'review' | null>(null)
const stopRequested = ref(false)
const actionError = ref('')
const previewUrls = new Set<string>()
let controller: AbortController | null = null

class PurchaseBatchBlockedError extends Error {}

const summary = computed(() => summarizePurchaseBatch(items.value))
const actions = computed(() => resolvePurchaseBatchActions(summary.value, running.value !== null))
const busy = computed(() => running.value !== null)
const reviewAmount = computed(() => items.value
  .filter(item => item.status === 'ready' || item.status === 'review-failed')
  .reduce((total, item) => total.plus(new Decimal(item.detail?.purchaseTotalAmount ?? item.order.purchaseTotalAmount)), new Decimal(0))
  .toFixed(2))
const primaryLabel = computed(() => {
  if (running.value === 'preload') {
    return t('purchaseReview.batch.preload')
  }
  if (running.value === 'generate') {
    return t('purchaseReview.batch.generateProgress', { done: summary.value.processed, total: summary.value.active })
  }
  if (running.value === 'review') {
    return t('purchaseReview.batch.reviewProgress', { done: summary.value.approved, total: summary.value.reviewable })
  }
  if (actions.value.primary === 'generate') {
    return t('purchaseReview.batch.generate', { done: actions.value.primaryCompleted, total: actions.value.total })
  }
  if (actions.value.primary === 'retry') {
    return t('purchaseReview.batch.retry', { failed: actions.value.primaryFailed, total: actions.value.total })
  }
  if (actions.value.primary === 'regenerate') {
    return t('purchaseReview.batch.regenerate', { total: actions.value.total })
  }
  return ''
})
const confirmLabel = computed(() => {
  if (running.value === 'review') {
    return t('purchaseReview.batch.reviewProgress', { done: summary.value.approved, total: summary.value.reviewable })
  }
  if (summary.value.reviewFailed > 0) {
    return t('purchaseReview.batch.reviewRetry', { failed: summary.value.reviewFailed, total: summary.value.reviewable })
  }
  if (actions.value.confirmLabel === 'remaining') {
    return t('purchaseReview.batch.confirmRemaining', { count: actions.value.confirmCount })
  }
  return t('purchaseReview.batch.confirmAll', { count: actions.value.confirmCount })
})
const summaryText = computed(() => t('purchaseReview.batch.summary', {
  approved: summary.value.approved,
  failed: summary.value.failed,
  generated: summary.value.generated,
  loaded: summary.value.loaded,
  total: summary.value.active,
}))
const primaryDisabled = computed(() => busy.value || actions.value.primary === null)
const confirmDisabled = computed(() => busy.value || !actions.value.confirmEnabled)
const closeDisabled = computed(() => running.value === 'generate' || running.value === 'review')
const canStop = computed(() => running.value === 'generate' || running.value === 'review')
const stopLabel = computed(() => stopRequested.value
  ? t('purchaseReview.batch.stopping')
  : t('purchaseReview.batch.stop'))

function failureMessage(failure: unknown): string {
  const result = getPurchaseOrderApiFailure(failure)
  return result.requestId ? `${result.message}（requestId: ${result.requestId}）` : result.message
}

function toBatchError(failure: unknown) {
  const result = getPurchaseOrderApiFailure(failure)
  return {
    code: result.code ?? null,
    message: failureMessage(failure),
    retryable: isPurchaseBatchRetryableError(result.code),
  }
}

function revokePreview(item: PurchaseBatchItemState) {
  if (item.previewUrl !== null) {
    URL.revokeObjectURL(item.previewUrl)
    previewUrls.delete(item.previewUrl)
  }
  item.previewUrl = null
  item.previewLoaded = false
  item.previewError = null
}

function revokeAllPreviews() {
  for (const item of items.value) {
    revokePreview(item)
  }
  for (const url of previewUrls) {
    URL.revokeObjectURL(url)
  }
  previewUrls.clear()
}

async function loadPreview(item: PurchaseBatchItemState, signal: AbortSignal) {
  if (item.draft === null || item.previewUrl !== null) {
    return
  }
  item.previewError = null
  try {
    const response = await purchaseOrdersApi.getOrderImageDraftContent(item.order.id, item.draft.id, signal)
    if (signal.aborted || !visible.value) {
      return
    }
    const url = await createPurchaseOrderBatchPreviewUrl(response.data)
    if (signal.aborted || !visible.value) {
      URL.revokeObjectURL(url)
      return
    }
    item.previewUrl = url
    item.previewLoaded = false
    previewUrls.add(url)
  }
  catch (failure) {
    if (isPurchaseOrderAbortError(failure)) {
      return
    }
    item.previewLoaded = false
    item.previewError = t('purchaseReview.batch.imageLoadFailed')
  }
}

function handlePreviewLoad(item: PurchaseBatchItemState, url: string) {
  if (item.previewUrl === url) {
    item.previewLoaded = true
    item.previewError = null
  }
}

function handlePreviewError(item: PurchaseBatchItemState, url: string) {
  if (item.previewUrl !== url) {
    return
  }
  revokePreview(item)
  item.previewError = t('purchaseReview.batch.imageLoadFailed')
}

async function retryPreview(item: PurchaseBatchItemState) {
  if (busy.value) {
    return
  }
  item.previewError = null
  const current = new AbortController()
  controller = current
  running.value = 'preload'
  try {
    await loadPreview(item, current.signal)
  }
  finally {
    if (controller === current) {
      controller = null
      running.value = null
    }
  }
}

async function generateItem(
  item: PurchaseBatchItemState,
  regenerate: boolean,
  signal: AbortSignal,
) {
  let lastFailure: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const detailResponse = await purchaseOrdersApi.getById(item.order.id, signal)
      const detail = detailResponse.data
      if (detail.orderStatus !== 'PENDING_REVIEW') {
        throw new PurchaseBatchBlockedError(detail.orderStatus === 'CANCELLED'
          ? t('purchaseReview.batch.error.cancelled')
          : t('purchaseReview.batch.error.approved'))
      }
      const preparedResponse = await purchaseOrdersApi.prepareReviewShippingMarks(
        item.order.id,
        { expectedVersion: detail.version },
        signal,
      )
      const prepared = preparedResponse.data
      if (prepared.orderStatus !== 'PENDING_REVIEW') {
        throw new PurchaseBatchBlockedError(t('purchaseReview.batch.error.approved'))
      }
      const draftResponse = await purchaseOrdersApi.generateOrderImageDraft(
        item.order.id,
        { expectedVersion: prepared.version, regenerate },
        signal,
      )
      if (signal.aborted) {
        throw new DOMException('Purchase batch generation aborted', 'AbortError')
      }
      item.detail = prepared
      item.draft = draftResponse.data
      return
    }
    catch (failure) {
      if (isPurchaseOrderAbortError(failure) || failure instanceof PurchaseBatchBlockedError) {
        throw failure
      }
      const error = toBatchError(failure)
      if (attempt === 0 && error.code === 'PURCHASE_ORDER_STATE_CHANGED') {
        lastFailure = failure
        continue
      }
      throw failure
    }
  }
  throw lastFailure ?? new Error(t('purchaseReview.batch.error.notPending'))
}

async function startGeneration(mode: 'generate' | 'regenerate' | 'retry') {
  if (busy.value) {
    return
  }
  const targets = items.value.filter((item) => {
    if (mode === 'generate') {
      return item.status === 'idle'
    }
    if (mode === 'retry') {
      return item.status === 'generate-failed'
    }
    return item.status === 'ready' || item.status === 'review-failed'
  })
  if (targets.length === 0) {
    return
  }
  actionError.value = ''
  stopRequested.value = false
  const current = new AbortController()
  controller = current
  running.value = 'generate'
  try {
    for (const item of targets) {
      if (current.signal.aborted || stopRequested.value || !visible.value) {
        break
      }
      item.status = 'generating'
      item.error = null
      item.note = null
      if (mode === 'regenerate') {
        revokePreview(item)
      }
      try {
        await generateItem(item, mode === 'regenerate', current.signal)
        if (current.signal.aborted || !visible.value) {
          break
        }
        item.status = 'ready'
        item.error = null
        item.previewLoaded = false
        await loadPreview(item, current.signal)
      }
      catch (failure) {
        if (isPurchaseOrderAbortError(failure)) {
          break
        }
        if (failure instanceof PurchaseBatchBlockedError) {
          item.status = 'blocked'
          item.note = failure.message
          item.error = null
          continue
        }
        const error = toBatchError(failure)
        item.status = 'generate-failed'
        item.error = error
        if (isPurchaseBatchAuthError(error.code)) {
          actionError.value = error.message
          break
        }
      }
    }
  }
  finally {
    if (controller === current) {
      controller = null
      running.value = null
      stopRequested.value = false
    }
  }
}

async function resolveReviewConflict(
  item: PurchaseBatchItemState,
  error: ReturnType<typeof toBatchError>,
  signal: AbortSignal,
) {
  try {
    const response = await purchaseOrdersApi.getById(item.order.id, signal)
    if (signal.aborted) {
      return
    }
    const latest = response.data
    if (latest.orderStatus === 'CONFIRMED' || latest.orderStatus === 'COMPLETED') {
      item.status = 'approved'
      item.detail = latest
      item.error = null
      item.note = t('purchaseReview.batch.note.reviewed')
      return
    }
    if (latest.orderStatus === 'CANCELLED') {
      item.status = 'blocked'
      item.detail = latest
      item.error = null
      item.note = t('purchaseReview.batch.note.cancelled')
      revokePreview(item)
      return
    }
    item.status = 'idle'
    item.detail = latest
    item.draft = null
    item.error = { ...error, message: t('purchaseReview.batch.error.stale') }
    revokePreview(item)
  }
  catch (failure) {
    if (isPurchaseOrderAbortError(failure)) {
      return
    }
    item.status = 'review-failed'
    item.error = toBatchError(failure)
  }
}

async function confirmAll() {
  if (busy.value || !actions.value.confirmEnabled) {
    return
  }
  const targets = items.value.filter(item => item.status === 'ready' || item.status === 'review-failed')
  if (targets.length === 0) {
    return
  }
  actionError.value = ''
  stopRequested.value = false
  const current = new AbortController()
  controller = current
  running.value = 'review'
  try {
    for (const item of targets) {
      if (current.signal.aborted || stopRequested.value || !visible.value) {
        break
      }
      if (item.draft === null) {
        item.status = 'idle'
        continue
      }
      const detail = item.detail ?? {
        id: item.order.id,
        orderStatus: 'PENDING_REVIEW' as const,
        version: item.draft.orderVersion,
      }
      const request = buildPurchaseOrderReviewRequest(detail, reason.value, item.draft)
      if (!request.valid) {
        item.status = 'review-failed'
        item.error = { code: null, message: request.fieldError, retryable: false }
        continue
      }
      item.status = 'reviewing'
      item.error = null
      try {
        const response = await purchaseOrdersApi.review(item.order.id, request.request, current.signal)
        if (current.signal.aborted || !visible.value) {
          break
        }
        item.status = 'approved'
        item.detail = response.data as PurchaseOrderDetailDto
        item.error = null
        item.note = null
      }
      catch (failure) {
        if (isPurchaseOrderAbortError(failure)) {
          break
        }
        const error = toBatchError(failure)
        if (isPurchaseBatchAuthError(error.code)) {
          item.status = 'review-failed'
          item.error = error
          actionError.value = error.message
          break
        }
        if (error.code === 'PURCHASE_ORDER_STATE_CHANGED') {
          await resolveReviewConflict(item, error, current.signal)
          continue
        }
        if (isPurchaseBatchImageStaleError(error.code)) {
          item.status = 'idle'
          item.draft = null
          item.error = { ...error, message: t('purchaseReview.batch.error.stale') }
          revokePreview(item)
          continue
        }
        item.status = 'review-failed'
        item.error = error
      }
    }
  }
  finally {
    if (controller === current) {
      controller = null
      running.value = null
      stopRequested.value = false
    }
  }
}

function runPrimary() {
  if (busy.value) {
    return
  }
  if (actions.value.primary === 'generate') {
    void startGeneration('generate')
  }
  else if (actions.value.primary === 'retry') {
    void startGeneration('retry')
  }
  else if (actions.value.primary === 'regenerate') {
    void startGeneration('regenerate')
  }
}

function stop() {
  if (running.value === 'generate' || running.value === 'review') {
    stopRequested.value = true
  }
}

function handleBeforeClose(reason: QsGenericModalCloseReason): boolean {
  // 身份变化由页面把弹窗关掉，属于程序化关闭；必须允许中止并让位给重新登录。
  if (reason === 'programmatic') {
    controller?.abort()
    return true
  }
  if (running.value === 'preload') {
    controller?.abort()
    return true
  }
  if (busy.value) {
    toast.warning(t('purchaseReview.batch.busyClose'))
    return false
  }
  return true
}

function cleanup() {
  controller?.abort()
  controller = null
  revokeAllPreviews()
  items.value = []
  running.value = null
  stopRequested.value = false
  actionError.value = ''
}

async function initialize() {
  cleanup()
  const orders = props.orders.slice(0, PURCHASE_BATCH_REVIEW_LIMIT)
  items.value = orders.map(createPurchaseBatchItem)
  if (items.value.length === 0) {
    return
  }
  const current = new AbortController()
  controller = current
  running.value = 'preload'
  try {
    for (const item of items.value) {
      if (current.signal.aborted || !visible.value) {
        break
      }
      if (item.order.orderStatus !== 'PENDING_REVIEW') {
        item.status = 'blocked'
        item.note = t('purchaseReview.batch.error.notPending')
        continue
      }
      // 图片必须先生成基础唛头；列表快照没有唛头时不可能已有图片草稿。
      if (item.order.shippingMarkText === null) {
        continue
      }
      try {
        const response = await purchaseOrdersApi.orderImageDraft(item.order.id, current.signal)
        if (current.signal.aborted || !visible.value) {
          break
        }
        const draft = response.data.draft
        if (draft?.isCurrent) {
          item.status = 'ready'
          item.draft = draft
          await loadPreview(item, current.signal)
        }
      }
      catch (failure) {
        if (isPurchaseOrderAbortError(failure)) {
          break
        }
        const error = toBatchError(failure)
        if (isPurchaseBatchAuthError(error.code)) {
          actionError.value = error.message
          break
        }
        // 读取已有草稿失败不阻塞重新生成，生成阶段会重新校验。
      }
    }
  }
  finally {
    if (controller === current) {
      controller = null
      running.value = null
    }
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    void initialize()
  }
}, { immediate: true })
onBeforeUnmount(cleanup)

function handleClosed() {
  // 关闭动画期间重新打开时不能清掉新会话。
  if (props.modelValue) {
    return
  }
  cleanup()
  emit('closed')
}
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('purchaseReview.batch.title')"
    :description="t('purchaseReview.batch.description', { count: items.length, limit: PURCHASE_BATCH_REVIEW_LIMIT })"
    size="3xl"
    :before-close="handleBeforeClose"
    @closed="handleClosed"
  >
    <div data-testid="purchase-batch-review-modal" class="flex flex-col gap-4">
      <FaAlert :title="t('purchaseReview.batch.warning')" class="text-amber-800 border-amber-500/30 bg-amber-500/5" />
      <label class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseReview.batch.reason') }}</span>
        <FaTextarea
          v-model="reason"
          maxlength="500"
          :disabled="busy"
          :placeholder="t('purchaseReview.batch.reasonPlaceholder')"
          input-class="min-h-20"
        />
      </label>
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-center justify-between">
        <span class="qs-type-meta text-muted-foreground">{{ summaryText }}</span>
        <span v-if="summary.blocked > 0" class="qs-type-meta text-amber-700">
          {{ t('purchaseReview.batch.blocked', { count: summary.blocked }) }}
        </span>
      </div>
      <p v-if="actionError" class="qs-type-meta text-destructive m-0" role="alert">
        {{ actionError }}
      </p>
      <p v-if="actions.remainingPreview > 0" class="qs-type-meta text-muted-foreground m-0">
        {{ t('purchaseReview.batch.imagesRemaining', { count: actions.remainingPreview }) }}
      </p>
      <FaEmpty
        v-if="items.length === 0"
        icon="i-lucide:inbox"
        :title="t('purchaseReview.batch.empty')"
        class="py-10"
      />
      <div v-else class="gap-3 grid sm:grid-cols-2 xl:grid-cols-3">
        <PurchaseBatchReviewCard
          v-for="item in items"
          :key="item.order.id"
          :item="item"
          :currencies="currencies"
          @preview-load="url => handlePreviewLoad(item, url)"
          @preview-error="url => handlePreviewError(item, url)"
          @retry-preview="retryPreview(item)"
        />
      </div>
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-2 w-full items-center justify-end">
        <span v-if="actions.confirmCount > 0" class="qs-type-meta text-muted-foreground flex gap-1 items-center sm:mr-auto">
          {{ t('purchaseReview.batch.totalAmount') }}
          <AmountDisplay :value="reviewAmount" currency="CNY" :currencies="currencies" />
        </span>
        <FaButton
          v-if="canStop"
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="stopRequested"
          @click="stop"
        >
          {{ stopLabel }}
        </FaButton>
        <FaButton
          v-if="primaryLabel"
          type="button"
          variant="outline"
          data-testid="purchase-batch-generate"
          class="min-h-11 sm:min-h-9"
          :disabled="primaryDisabled"
          @click="runPrimary"
        >
          {{ primaryLabel }}
        </FaButton>
        <FaButton
          type="button"
          data-testid="purchase-batch-confirm"
          class="min-h-11 sm:min-h-9"
          :disabled="confirmDisabled"
          @click="confirmAll"
        >
          {{ confirmLabel }}
        </FaButton>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="closeDisabled"
          @click="visible = false"
        >
          {{ t('purchaseReview.batch.close') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
