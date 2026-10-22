<script setup lang="ts">
import type { ProductBatchImageCardState } from './product-batch-images.logic'

import { useFileDrop } from '@fantastic-admin/components'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import { MAX_PRODUCT_IMAGES } from '../media/product-media-common.logic'
import { formatProductMediaBytes } from '../media/product-media-view.logic'
import {
  buildProductBatchCurrentImageItems,
  isProductBatchImageLimitReached,
} from './product-batch-images.logic'

interface ProductBatchImageCardProps {
  card: ProductBatchImageCardState
  contentReadable: boolean
  submitting: boolean
}

defineOptions({ name: 'ProductBatchImageCard' })

const props = defineProps<ProductBatchImageCardProps>()
const emit = defineEmits<{
  primaryChange: [value: boolean]
  removeFile: []
  retryPrimary: []
  retryUpload: []
  selectFile: [file: File]
}>()

const inputRef = ref<HTMLInputElement>()
const inputId = computed(() => `product-batch-image-${props.card.product.id}`)
const hintId = computed(() => `${inputId.value}-hint`)

const currentImageItems = computed(() => buildProductBatchCurrentImageItems(
  props.card.product,
  props.contentReadable,
))
const imageCount = computed(() => props.card.product.media.images.length)
const hasMainImage = computed(() => props.card.product.media.mainImage !== null)
const limitReached = computed(() => isProductBatchImageLimitReached(props.card.product))
const isBusy = computed(() => (
  props.card.phase === 'uploading'
  || props.card.phase === 'reconciling'
  || props.card.phase === 'setting-primary'
))
const isSuccess = computed(() => props.card.phase === 'success')
const isUnknown = computed(() => props.card.phase === 'unknown')
const isMainFailed = computed(() => props.card.phase === 'main-failed')
const isFailed = computed(() => props.card.phase === 'failed')
const canChooseFile = computed(() => (
  !props.submitting
  && !isBusy.value
  && !isSuccess.value
  && !isUnknown.value
  && !isMainFailed.value
  && !limitReached.value
))
const canRemoveFile = computed(() => (
  !props.submitting
  && props.card.file !== null
  && !isBusy.value
  && !isSuccess.value
  && !isUnknown.value
  && !isMainFailed.value
))
const primaryDisabled = computed(() => (
  props.submitting
  || props.card.file === null
  || isBusy.value
  || isSuccess.value
  || isUnknown.value
  || isMainFailed.value
))
const fileSizeLabel = computed(() => props.card.file === null
  ? ''
  : formatProductMediaBytes(String(props.card.file.size)))
const currentImageIcon = computed(() => (
  !props.contentReadable && (hasMainImage.value || imageCount.value > 0)
    ? 'i-lucide:shield-alert'
    : 'i-lucide:image-off'
))
const currentImageLabel = computed(() => {
  if (!props.contentReadable) {
    return '无权读取当前图片'
  }
  if (hasMainImage.value) {
    return `当前主图 · 共 ${imageCount.value} 张图片`
  }
  if (imageCount.value > 0) {
    return `当前首图（未设主图）· 共 ${imageCount.value} 张图片`
  }
  return '暂无图片'
})
const statusText = computed(() => {
  switch (props.card.phase) {
    case 'uploading':
      return `上传中 ${props.card.progress}%`
    case 'reconciling':
      return '正在确认上传结果'
    case 'setting-primary':
      return '正在设置主图'
    case 'success':
      return props.card.setAsPrimary ? '已完成（已设为主图）' : '已完成'
    case 'failed':
      return '上传失败'
    case 'main-failed':
      return '图片已上传，主图未设置'
    case 'unknown':
      return '上传结果未知'
    default:
      return props.card.file === null ? '待选择图片' : '待上传'
  }
})
const tagText = computed(() => {
  if (props.card.phase === 'main-failed') {
    return '主图未设置'
  }
  if (props.card.phase === 'success' && props.card.setAsPrimary) {
    return '已完成 · 主图'
  }
  return statusText.value
})
const statusClass = computed(() => {
  if (isSuccess.value) {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (isFailed.value || isUnknown.value) {
    return 'border-destructive/30 bg-destructive/5 text-destructive'
  }
  if (isMainFailed.value) {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (isBusy.value) {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  return 'border-border bg-muted text-muted-foreground'
})
const progressLabel = computed(() => `${props.card.product.name} ${statusText.value}`)
const {
  handlers: fileDropHandlers,
  isDragging: fileDragging,
} = useFileDrop({
  disabled: computed(() => !canChooseFile.value),
  onFiles: (files) => {
    const file = files[0]
    if (file !== undefined) {
      emit('selectFile', file)
    }
  },
})

function openFilePicker(): void {
  if (!canChooseFile.value) {
    return
  }
  inputRef.value?.click()
}

function handleInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  // 允许用户再次选择同一个文件；清空后 change 才会继续触发。
  input.value = ''
  if (file !== undefined) {
    emit('selectFile', file)
  }
}

function handlePrimaryChange(value: unknown): void {
  if (typeof value === 'boolean') {
    emit('primaryChange', value)
  }
}
</script>

<template>
  <article class="p-4 border border-border rounded-xl bg-background gap-3 grid min-w-0">
    <header class="flex gap-3 min-w-0 items-start">
      <div class="rounded-lg bg-muted/40 flex shrink-0 size-16 items-center justify-center overflow-hidden">
        <ImageGroup
          v-if="currentImageItems.length > 0"
          :items="currentImageItems"
          :max-count="1"
          radius="lg"
          :size="64"
        />
        <FaIcon v-else :name="currentImageIcon" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-sm font-semibold m-0 break-words">
          {{ card.product.name }}
        </h3>
        <p class="qs-type-meta font-mono m-0 mt-1 break-all">
          {{ card.product.productNo }}
        </p>
        <p class="qs-type-meta m-0 mt-1">
          {{ currentImageLabel }}
        </p>
      </div>
      <FaTag variant="outline" class="qs-type-status-tag shrink-0 max-w-36 truncate" :class="statusClass">
        {{ tagText }}
      </FaTag>
    </header>

    <div
      v-bind="fileDropHandlers"
      class="p-2 rounded-lg gap-2 grid min-w-0 transition-shadow duration-150"
      :class="fileDragging ? 'ring-2 ring-primary/40 ring-offset-2 bg-primary/5' : ''"
    >
      <input
        :id="inputId"
        ref="inputRef"
        type="file"
        :accept="IMAGE_ONLY_ACCEPT"
        class="sr-only"
        :disabled="!canChooseFile"
        :aria-describedby="hintId"
        @change="handleInput"
      >
      <p :id="hintId" class="sr-only">
        仅支持 JPEG、PNG、WebP，单张不超过 10 MiB
      </p>

      <p v-if="limitReached" class="text-xs text-destructive m-0">
        图片已达上限（{{ MAX_PRODUCT_IMAGES }} 张），请先在编辑页解除图片
      </p>

      <template v-else-if="card.file !== null">
        <div class="p-2 border border-border rounded-lg flex gap-2 min-w-0 items-center">
          <img
            v-if="card.previewUrl !== null"
            :src="card.previewUrl"
            alt=""
            class="rounded-md shrink-0 size-12 object-cover"
          >
          <div class="flex-1 min-w-0">
            <p class="text-xs m-0 truncate">
              {{ card.file.name }}
            </p>
            <p class="qs-type-meta m-0 mt-0.5">
              {{ fileSizeLabel }}
            </p>
          </div>
          <FaButton
            v-if="canChooseFile"
            type="button"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            @click="openFilePicker"
          >
            更换
          </FaButton>
          <FaButton
            v-if="canRemoveFile"
            type="button"
            variant="ghost"
            size="icon"
            class="shrink-0 size-11 sm:size-8"
            aria-label="移除已选图片"
            @click="emit('removeFile')"
          >
            <FaIcon name="i-lucide:trash-2" class="size-4" />
          </FaButton>
        </div>
      </template>

      <button
        v-else
        type="button"
        class="px-3 py-4 border border-border rounded-lg border-dashed bg-muted/20 flex-col-center gap-1 w-full transition-colors hover:bg-muted/40 disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="!canChooseFile"
        @click="openFilePicker"
      >
        <FaIcon name="i-lucide:image-plus" class="text-muted-foreground" aria-hidden="true" />
        <span class="text-sm font-medium">选择或拖入图片</span>
        <span class="qs-type-meta">JPEG / PNG / WebP，单张不超过 10 MiB</span>
      </button>

      <p v-if="card.selectionError !== null" class="text-xs text-destructive m-0" role="alert">
        {{ card.selectionError }}
      </p>
    </div>

    <div class="gap-1 grid">
      <FaCheckbox
        :model-value="card.setAsPrimary"
        :disabled="primaryDisabled"
        @update:model-value="handlePrimaryChange"
      >
        设置为主图
      </FaCheckbox>
      <p class="qs-type-meta m-0 pl-6">
        {{ hasMainImage ? '勾选将替换当前主图' : '该产品当前没有主图' }}
      </p>
    </div>

    <div v-if="isBusy" class="gap-1 grid">
      <div
        class="rounded-full bg-muted h-1.5 overflow-hidden"
        role="progressbar"
        :aria-label="progressLabel"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="card.progress"
      >
        <div class="bg-primary h-full transition-[width]" :style="{ width: `${card.progress}%` }" />
      </div>
      <span class="qs-type-meta" aria-live="polite">{{ statusText }}</span>
    </div>

    <div
      v-if="card.failure !== null && (isFailed || isMainFailed || isUnknown)"
      class="gap-2 grid"
      role="alert"
    >
      <p class="text-xs m-0" :class="isMainFailed ? 'text-amber-700 dark:text-amber-300' : 'text-destructive'">
        {{ card.failure.message }}
      </p>
      <code v-if="card.failure.requestId !== undefined" class="text-[11px] text-muted-foreground font-mono break-all">
        requestId: {{ card.failure.requestId }}
      </code>
      <div v-if="isFailed || isMainFailed" class="flex flex-wrap gap-2">
        <FaButton
          v-if="isFailed"
          type="button"
          variant="outline"
          size="sm"
          class="min-h-11 sm:min-h-8"
          :disabled="submitting"
          @click="emit('retryUpload')"
        >
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
          重试上传
        </FaButton>
        <FaButton
          v-if="isMainFailed"
          type="button"
          variant="outline"
          size="sm"
          class="min-h-11 sm:min-h-8"
          :disabled="submitting"
          @click="emit('retryPrimary')"
        >
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
          重试设置主图
        </FaButton>
      </div>
      <p v-else class="qs-type-meta m-0">
        为避免重复写入，结果未知时不提供重试；关闭后在产品列表确认实际结果。
      </p>
    </div>
  </article>
</template>
