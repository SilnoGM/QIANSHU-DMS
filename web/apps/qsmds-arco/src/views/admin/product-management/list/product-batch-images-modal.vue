<script setup lang="ts">
import type { ProductMediaSafeFailure } from '../media/product-media-common.logic'
import type { ProductMediaUploadReconciliationContext } from '../media/product-media-upload.logic'
import type {
  ProductBatchImageCardState,
  ProductBatchRunResult,
} from './product-batch-images.logic'
import type { ProductListItemViewModel } from './product-list.logic'

import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import productMediaApi from '../../../../api/modules/product-media'
import productsApi from '../../../../api/modules/products'
import {
  getProductMediaMutationFailure,
  MAX_PRODUCT_IMAGES,
} from '../media/product-media-common.logic'
import { reconcileProductMediaUploadResult } from '../media/product-media-upload.logic'
import ProductBatchImageCard from './product-batch-image-card.vue'
import {
  applyProductBatchLayoutFailure,
  applyProductBatchLayoutSuccess,
  applyProductBatchUploadFailure,
  applyProductBatchUploadSuccess,
  buildProductBatchLayoutPayload,
  buildProductBatchRunResult,
  createProductBatchImageCard,
  isProductBatchImageLimitReached,
  prepareProductBatchCardFile,
  removeProductBatchCardFile,
  resetProductBatchCardForRetry,
  setProductBatchCardPrimary,
  summarizeProductBatchCards,
} from './product-batch-images.logic'
import { adaptProductListItemDto } from './product-list.logic'

interface ProductBatchImagesModalProps {
  contentReadable?: boolean
  modelValue: boolean
  products: readonly ProductListItemViewModel[]
}

defineOptions({ name: 'ProductBatchImagesModal' })

const props = withDefaults(defineProps<ProductBatchImagesModalProps>(), {
  contentReadable: false,
})
const emit = defineEmits<{
  'closed': [changed: boolean]
  'finished': [result: ProductBatchRunResult]
  'update:modelValue': [value: boolean]
}>()

const toast = useQsToast()
const cards = ref<ProductBatchImageCardState[]>([])
const submitting = ref(false)
const runResult = ref<ProductBatchRunResult | null>(null)
const controller = shallowRef<AbortController | null>(null)
const files = new Map<string, File>()

const summary = computed(() => summarizeProductBatchCards(cards.value))
const hasRun = computed(() => runResult.value !== null)
const retryableCount = computed(() => summary.value.retryable)
const description = computed(() => (
  `已选 ${cards.value.length} 个产品；每张卡片只能选择一张图片，产品最多 ${MAX_PRODUCT_IMAGES} 张图片。未选择图片的产品将跳过。`
))
const footerSummary = computed(() => {
  const result = runResult.value
  if (result === null) {
    const parts = [
      `将上传 ${summary.value.ready} 个`,
      `跳过 ${summary.value.skipped} 个`,
    ]
    if (summary.value.blocked > 0) {
      parts.push(`已达上限 ${summary.value.blocked} 个`)
    }
    if (summary.value.setPrimary > 0) {
      parts.push(`${summary.value.setPrimary} 个设为主图`)
    }
    return parts.join(' · ')
  }
  const parts = [
    `成功 ${result.successfulProductIds.length}`,
    `失败 ${result.failedProductIds.length}`,
  ]
  if (result.unknownProductIds.length > 0) {
    parts.push(`结果未知 ${result.unknownProductIds.length}`)
  }
  if (summary.value.ready > 0) {
    parts.push(`待上传 ${summary.value.ready}`)
  }
  return parts.join(' · ')
})
const primaryActionLabel = computed(() => {
  if (!hasRun.value) {
    return '开始上传'
  }
  if (retryableCount.value > 0 && summary.value.ready > 0) {
    return `继续上传（${retryableCount.value + summary.value.ready}）`
  }
  if (retryableCount.value > 0) {
    return `重试失败项（${retryableCount.value}）`
  }
  if (summary.value.ready > 0) {
    return `上传新选择（${summary.value.ready}）`
  }
  return '关闭'
})
const hasPendingWork = computed(() => (
  summary.value.ready > 0 || retryableCount.value > 0
))
const showPrimaryAction = computed(() => !hasRun.value || hasPendingWork.value)

watch(() => props.modelValue, (value) => {
  if (value) {
    initialize()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  abortRun()
  revokeAllPreviews()
})

function initialize(): void {
  abortRun()
  revokeAllPreviews()
  files.clear()
  runResult.value = null
  submitting.value = false
  cards.value = props.products.map(createProductBatchImageCard)
}

function getCard(cardId: string): ProductBatchImageCardState | undefined {
  return cards.value.find(card => card.product.id === cardId)
}

function updateCard(
  cardId: string,
  updater: (card: ProductBatchImageCardState) => ProductBatchImageCardState,
): void {
  cards.value = cards.value.map(card => (
    card.product.id === cardId ? updater(card) : card
  ))
}

function revokePreview(cardId: string): void {
  const card = getCard(cardId)
  if (card?.previewUrl !== null && card?.previewUrl !== undefined) {
    URL.revokeObjectURL(card.previewUrl)
  }
}

function revokeAllPreviews(): void {
  for (const card of cards.value) {
    if (card.previewUrl !== null) {
      URL.revokeObjectURL(card.previewUrl)
    }
  }
}

function handleSelectFile(cardId: string, file: File): void {
  const card = getCard(cardId)
  if (card === undefined || submitting.value) {
    return
  }

  // 先校验再替换预览，避免无效文件把已选图片的 Object URL 提前释放。
  const prepared = prepareProductBatchCardFile(card, file, '')
  if (prepared.error !== null) {
    const selectionError = prepared.error.message
    updateCard(cardId, current => ({
      ...current,
      selectionError,
    }))
    return
  }

  const previewUrl = URL.createObjectURL(file)
  const previousPreviewUrl = card.previewUrl
  files.set(cardId, file)
  updateCard(cardId, () => ({
    ...prepared.card,
    previewUrl,
  }))
  if (previousPreviewUrl !== null) {
    URL.revokeObjectURL(previousPreviewUrl)
  }
}

function handleRemoveFile(cardId: string): void {
  if (submitting.value) {
    return
  }
  revokePreview(cardId)
  files.delete(cardId)
  updateCard(cardId, removeProductBatchCardFile)
}

function handlePrimaryChange(cardId: string, value: boolean): void {
  if (submitting.value) {
    return
  }
  updateCard(cardId, current => setProductBatchCardPrimary(current, value))
}

function canProcessCard(
  card: ProductBatchImageCardState,
  cardIds?: ReadonlySet<string>,
): boolean {
  if (cardIds !== undefined && !cardIds.has(card.product.id)) {
    return false
  }
  if (
    card.phase === 'success'
    || card.phase === 'unknown'
    || card.phase === 'uploading'
    || card.phase === 'reconciling'
    || card.phase === 'setting-primary'
  ) {
    return false
  }
  // 主图失败时图片已经上传成功，即使产品此刻已到 20 张也仍可重试设主图。
  if (card.phase === 'main-failed') {
    return card.uploadedMediaId !== null
  }
  if (isProductBatchImageLimitReached(card.product)) {
    return false
  }
  return card.file !== null
}

async function startRun(cardIds?: ReadonlySet<string>): Promise<void> {
  if (submitting.value) {
    return
  }

  const targetIds = new Set(
    cards.value
      .filter(card => canProcessCard(card, cardIds))
      .map(card => card.product.id),
  )
  if (targetIds.size === 0) {
    return
  }

  cards.value = cards.value.map(card => (
    targetIds.has(card.product.id)
      ? resetProductBatchCardForRetry(card)
      : card
  ))

  const runController = new AbortController()
  controller.value = runController
  submitting.value = true
  runResult.value = null

  try {
    for (const cardId of targetIds) {
      if (runController.signal.aborted) {
        break
      }
      const card = getCard(cardId)
      if (card === undefined) {
        continue
      }
      if (card.phase === 'setting-primary' && card.uploadedMediaId !== null) {
        await runLayout(cardId, card.product, card.uploadedMediaId, runController.signal)
      }
      else {
        await runUpload(cardId, runController.signal)
      }
    }
  }
  finally {
    submitting.value = false
    controller.value = null
  }

  const result = buildProductBatchRunResult(cards.value)
  runResult.value = result
  emit('finished', result)

  if (result.failedProductIds.length === 0 && result.unknownProductIds.length === 0) {
    toast.success('批量图片上传完成', {
      description: `已为 ${result.uploadedCount} 个产品上传图片，其中 ${result.primarySetCount} 个设为主图`,
    })
    await nextTick()
    emit('update:modelValue', false)
  }
}

async function runUpload(cardId: string, signal: AbortSignal): Promise<void> {
  const card = getCard(cardId)
  const file = files.get(cardId)
  if (card === undefined) {
    return
  }
  if (file === undefined) {
    updateCard(cardId, current => applyProductBatchUploadFailure(current, {
      code: 'MEDIA_CONTENT_INVALID',
      message: '图片文件已失效，请重新选择',
      outcome: 'known',
      requestId: undefined,
    }))
    return
  }

  const context: ProductMediaUploadReconciliationContext = {
    existingMediaIds: [
      ...card.product.media.images.map(item => item.id),
      ...card.product.media.videos.map(item => item.id),
    ],
    expectedVersion: card.product.version,
    kind: 'IMAGE',
    originalFilename: file.name,
    sizeBytes: file.size,
  }

  updateCard(cardId, current => ({
    ...current,
    failure: null,
    phase: 'uploading',
    progress: 0,
    selectionError: null,
  }))

  try {
    const response = await productMediaApi.upload(card.product.id, {
      expectedVersion: String(card.product.version),
      file,
      kind: 'IMAGE',
    }, {
      onUploadProgress(event) {
        const progress = resolveUploadProgress(event.loaded, event.total ?? file.size)
        updateCard(cardId, current => current.phase === 'uploading'
          ? { ...current, progress }
          : current)
      },
      signal,
      submissionFilename: file.name,
    })
    if (signal.aborted) {
      return
    }

    const product = adaptProductListItemDto(response.data.product)
    const current = getCard(cardId)
    if (current === undefined) {
      return
    }
    const updated = applyProductBatchUploadSuccess(
      current,
      product,
      response.data.media.id,
    )
    updateCard(cardId, () => updated)
    if (updated.phase === 'setting-primary') {
      await runLayout(cardId, product, response.data.media.id, signal)
    }
  }
  catch (error) {
    if (signal.aborted) {
      updateCard(cardId, current => applyProductBatchUploadFailure(
        current,
        cancelledFailure(),
      ))
      return
    }
    const failure = getProductMediaMutationFailure(error)
    if (failure.outcome === 'unknown') {
      await reconcileUpload(cardId, context, failure, signal)
      return
    }
    if (failure.outcome === 'conflict') {
      await refreshAfterConflict(cardId, failure, signal)
      return
    }
    updateCard(cardId, current => applyProductBatchUploadFailure(current, failure))
  }
}

async function reconcileUpload(
  cardId: string,
  context: ProductMediaUploadReconciliationContext,
  failure: ProductMediaSafeFailure,
  signal: AbortSignal,
): Promise<void> {
  updateCard(cardId, current => ({
    ...current,
    failure,
    phase: 'reconciling',
  }))

  try {
    const response = await productsApi.getById(cardId, signal)
    if (signal.aborted) {
      return
    }
    const reconciled = reconcileProductMediaUploadResult(context, response.data)
    if (reconciled.outcome !== 'success') {
      updateCard(cardId, current => applyProductBatchUploadFailure(current, {
        ...failure,
        message: '上传结果未知，请关闭后在产品列表确认实际结果',
        outcome: 'unknown',
      }))
      return
    }

    const product = adaptProductListItemDto(response.data)
    const current = getCard(cardId)
    if (current === undefined) {
      return
    }
    const updated = applyProductBatchUploadSuccess(
      current,
      product,
      reconciled.media.id,
    )
    updateCard(cardId, () => updated)
    if (updated.phase === 'setting-primary') {
      await runLayout(cardId, product, reconciled.media.id, signal)
    }
  }
  catch {
    if (signal.aborted) {
      return
    }
    updateCard(cardId, current => applyProductBatchUploadFailure(current, {
      ...failure,
      message: '上传结果未知，请关闭后在产品列表确认实际结果',
      outcome: 'unknown',
    }))
  }
}

async function refreshAfterConflict(
  cardId: string,
  failure: ProductMediaSafeFailure,
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await productsApi.getById(cardId, signal)
    if (signal.aborted) {
      return
    }
    const product = adaptProductListItemDto(response.data)
    updateCard(cardId, current => applyProductBatchUploadFailure({
      ...current,
      product,
    }, {
      ...failure,
      message: '产品资料已更新，请确认最新图片后重试',
    }))
  }
  catch {
    if (!signal.aborted) {
      updateCard(cardId, current => applyProductBatchUploadFailure(current, failure))
    }
  }
}

async function runLayout(
  cardId: string,
  product: ProductListItemViewModel,
  mediaId: string,
  signal: AbortSignal,
  allowRetry = true,
): Promise<void> {
  updateCard(cardId, current => ({
    ...current,
    failure: null,
    phase: 'setting-primary',
    progress: 100,
  }))

  try {
    const response = await productMediaApi.updateLayout(
      product.id,
      buildProductBatchLayoutPayload(product, mediaId),
      signal,
    )
    if (signal.aborted) {
      return
    }
    const updated = adaptProductListItemDto(response.data)
    updateCard(cardId, current => applyProductBatchLayoutSuccess(current, updated))
  }
  catch (error) {
    if (signal.aborted) {
      updateCard(cardId, current => applyProductBatchLayoutFailure(
        current,
        cancelledFailure(),
      ))
      return
    }

    const failure = getProductMediaMutationFailure(error)
    if (allowRetry && (failure.outcome === 'unknown' || failure.outcome === 'conflict')) {
      const reconciled = await reconcileLayout(cardId, mediaId, signal)
      if (reconciled === 'success') {
        return
      }
      if (reconciled !== null) {
        await runLayout(cardId, reconciled, mediaId, signal, false)
        return
      }
    }
    updateCard(cardId, current => applyProductBatchLayoutFailure(current, failure))
  }
}

/**
 * 布局 PUT 是显式目标状态，重复提交安全；但必须先 GET 确认主图是否已提交，
 * 并用最新 version/图片集合重试，避免覆盖并发修改。
 */
async function reconcileLayout(
  cardId: string,
  mediaId: string,
  signal: AbortSignal,
): Promise<'success' | ProductListItemViewModel | null> {
  try {
    const response = await productsApi.getById(cardId, signal)
    if (signal.aborted) {
      return null
    }
    const product = adaptProductListItemDto(response.data)
    const media = product.media.images.find(item => item.id === mediaId)
    if (media === undefined) {
      return null
    }
    if (media.isPrimary) {
      updateCard(cardId, current => applyProductBatchLayoutSuccess({
        ...current,
        product,
      }, product))
      return 'success'
    }
    updateCard(cardId, current => ({ ...current, product }))
    return product
  }
  catch {
    return null
  }
}

function cancelledFailure(): ProductMediaSafeFailure {
  return Object.freeze({
    code: undefined,
    message: '操作已中断，请刷新产品列表确认实际结果',
    outcome: 'unknown',
    requestId: undefined,
  })
}

function resolveUploadProgress(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)))
}

function abortRun(): void {
  controller.value?.abort()
  controller.value = null
}

function closeModal(): void {
  if (submitting.value) {
    return
  }
  emit('update:modelValue', false)
}

function handleModelUpdate(value: boolean): void {
  if (!value && submitting.value) {
    return
  }
  emit('update:modelValue', value)
}

function handleClosed(): void {
  // 关闭动画结束前用户可能已经重新打开；此时不能清空新一轮的卡片状态。
  if (props.modelValue) {
    return
  }
  const changed = runResult.value !== null && runResult.value.uploadedCount > 0
  abortRun()
  revokeAllPreviews()
  files.clear()
  cards.value = []
  runResult.value = null
  submitting.value = false
  emit('closed', changed)
}

function retryCard(cardId: string): void {
  void startRun(new Set([cardId]))
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="批量设置图片"
    :description="description"
    size="2xl"
    fill-height
    :submitting="submitting"
    @closed="handleClosed"
    @update:model-value="handleModelUpdate"
  >
    <div class="pr-1 flex flex-1 flex-col gap-4 min-h-0 overflow-y-auto">
      <FaAlert
        v-if="runResult !== null && (runResult.failedProductIds.length > 0 || runResult.unknownProductIds.length > 0)"
        :variant="runResult.failedProductIds.length > 0 ? 'destructive' : undefined"
        :title="runResult.failedProductIds.length > 0 ? '部分产品未完成' : '部分产品结果未知'"
        :description="footerSummary"
        role="alert"
      />

      <div v-if="cards.length === 0" class="py-10 border border-border rounded-xl border-dashed flex-col-center">
        <FaIcon name="i-lucide:images" class="text-muted-foreground mb-2" aria-hidden="true" />
        <p class="text-sm text-muted-foreground m-0">
          未选择产品
        </p>
      </div>

      <div v-else class="gap-4 grid min-w-0 sm:grid-cols-2">
        <ProductBatchImageCard
          v-for="card in cards"
          :key="card.product.id"
          :card="card"
          :content-readable="contentReadable"
          :submitting="submitting"
          @remove-file="handleRemoveFile(card.product.id)"
          @retry-primary="retryCard(card.product.id)"
          @retry-upload="retryCard(card.product.id)"
          @select-file="file => handleSelectFile(card.product.id, file)"
          @primary-change="value => handlePrimaryChange(card.product.id, value)"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:justify-between">
        <p class="qs-type-meta m-0" aria-live="polite">
          {{ footerSummary }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <FaButton
            type="button"
            variant="outline"
            class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            :disabled="submitting"
            @click="closeModal"
          >
            {{ hasRun ? '关闭' : '取消' }}
          </FaButton>
          <FaButton
            v-if="showPrimaryAction"
            type="button"
            class="min-h-11 w-full sm:min-h-9 sm:w-auto"
            :disabled="submitting || (!hasRun && summary.ready === 0)"
            :loading="submitting"
            @click="startRun()"
          >
            {{ primaryActionLabel }}
          </FaButton>
        </div>
      </div>
    </template>
  </QsGenericModal>
</template>
