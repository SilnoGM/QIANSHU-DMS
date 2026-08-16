<script setup lang="ts">
import type { FileItem } from '@fantastic-admin/components'
import type { ProductMediaUploadQueueItem } from './product-media-upload.logic'
import type { ProductMediaSelectionFeedback } from './product-media-view.logic'

import {
  formatProductMediaBytes,
  getProductMediaProgressPercent,
} from './product-media-view.logic'

interface ProductMediaUploadQueueProps {
  editable: boolean
  locked: boolean
  queue: readonly ProductMediaUploadQueueItem[]
  selectionErrors: readonly ProductMediaSelectionFeedback[]
}

defineOptions({ name: 'ProductMediaUploadQueue' })

const props = defineProps<ProductMediaUploadQueueProps>()
const emit = defineEmits<{
  cancel: [queueId: string]
  filesSelected: [files: File[]]
  retry: [queueId: string]
}>()

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const uploadPrimitiveItems = ref<FileItem[]>([])

function phaseLabel(item: ProductMediaUploadQueueItem): string {
  const labels: Record<ProductMediaUploadQueueItem['phase'], string> = {
    conflict: '版本冲突',
    failed: '上传失败',
    finalizing: '服务端验证中',
    queued: '等待上传',
    reconciling: '正在确认结果',
    unknown: '结果未知',
    uploading: '正在上传',
  }
  return labels[item.phase]
}

function phaseIcon(item: ProductMediaUploadQueueItem): string {
  if (item.phase === 'failed' || item.phase === 'conflict' || item.phase === 'unknown') {
    return 'i-lucide:circle-alert'
  }
  if (item.phase === 'queued') {
    return 'i-lucide:clock-3'
  }
  if (item.phase === 'uploading' || item.phase === 'finalizing' || item.phase === 'reconciling') {
    return 'i-lucide:loader-circle'
  }
  return 'i-lucide:upload'
}

function canCancel(item: ProductMediaUploadQueueItem): boolean {
  return item.phase === 'queued'
    || item.phase === 'uploading'
    || item.phase === 'failed'
}

function selectFiles(files: FileList | null): void {
  if (!props.editable || props.locked || files === null) {
    return
  }
  const selected = [...files].filter(file => file instanceof File)
  if (selected.length > 0) {
    emit('filesSelected', selected)
  }
}

function handleInput(event: Event): void {
  const input = event.target as HTMLInputElement
  selectFiles(input.files)
  input.value = ''
}

function openFilePicker(): void {
  if (props.editable && !props.locked) {
    inputRef.value?.click()
  }
}

/**
 * 复用 FaFileUpload 的拖放、粘贴和文件选择能力，但在 beforeUpload 阶段把
 * File 交回 Product 领域队列并返回 false，避免共享组件自行发起无版本写入。
 */
function interceptPrimitiveFile(file: File): false {
  if (props.editable && !props.locked) {
    emit('filesSelected', [file])
  }
  return false
}

function focusFirstError(): boolean {
  const target = rootRef.value?.querySelector<HTMLElement>(
    '[data-selection-error], [data-queue-error]',
  )
  target?.focus()
  return target !== null && target !== undefined
}

function focusUpload(): void {
  inputRef.value?.focus()
}

defineExpose({ focusFirstError, focusUpload })
</script>

<template>
  <section ref="rootRef" aria-labelledby="product-media-upload-title" class="min-w-0">
    <div class="mb-3">
      <h3 id="product-media-upload-title" class="text-base font-semibold m-0">
        上传队列
      </h3>
      <p class="text-sm text-muted-foreground m-0 mt-1">
        文件按顺序上传，避免多个写入争用同一产品版本。
      </p>
    </div>

    <div v-if="editable" class="gap-3 grid">
      <div>
        <label for="product-media-upload-input" class="text-sm font-medium mb-2 block">
          选择图片或视频
        </label>
        <input
          id="product-media-upload-input"
          ref="inputRef"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.webm"
          multiple
          class="sr-only"
          :disabled="locked"
          aria-describedby="product-media-upload-help"
          @change="handleInput"
        >
        <FaButton
          variant="outline"
          class="min-h-11 w-full"
          :disabled="locked"
          @click="openFilePicker"
        >
          <FaIcon name="i-lucide:folder-up" aria-hidden="true" />浏览本机文件
        </FaButton>
      </div>

      <FaFileUpload
        v-model="uploadPrimitiveItems"
        :disabled="locked"
        :before-upload="interceptPrimitiveFile"
        :max="25"
        multiple
        description="拖放图片或视频到这里，或点击选择文件"
      >
        <FaIcon name="i-lucide:upload-cloud" class="text-muted-foreground mb-2 size-6" aria-hidden="true" />
        <strong class="text-sm">拖放文件到这里</strong>
        <p id="product-media-upload-help" class="text-xs text-muted-foreground m-0 mt-1">
          支持 JPEG、PNG、WebP 图片和 MP4、MOV、M4V、WebM 视频
        </p>
      </FaFileUpload>
    </div>

    <div
      v-if="selectionErrors.length > 0"
      class="mt-3 gap-2 grid"
      role="alert"
      aria-label="未加入上传队列的文件"
    >
      <div
        v-for="error in selectionErrors"
        :key="error.id"
        data-selection-error
        tabindex="-1"
        class="p-3 outline-none border border-destructive/50 rounded-lg bg-destructive/5 focus:ring-2 focus:ring-destructive"
      >
        <strong class="text-sm break-all">{{ error.filename }}</strong>
        <p class="text-sm text-destructive m-0 mt-1">
          {{ error.message }}
        </p>
      </div>
    </div>

    <FaEmpty
      v-if="queue.length === 0"
      icon="i-lucide:list-checks"
      title="上传队列为空"
      description="选择文件后会在这里展示真实上传进度。"
      class="mt-3 py-8 border rounded-lg border-dashed"
    />

    <ol v-else class="m-0 mt-3 p-0 list-none gap-3 grid">
      <li
        v-for="item in queue"
        :key="item.id"
        :data-queue-error="['failed', 'conflict', 'unknown'].includes(item.phase) || undefined"
        tabindex="-1"
        :aria-labelledby="`product-media-queue-title-${item.id}`"
        class="p-3 outline-none border rounded-lg bg-card focus:ring-2 focus:ring-primary"
      >
        <div class="flex gap-3 min-w-0 items-start">
          <div class="rounded-md bg-muted flex shrink-0 size-12 items-center justify-center overflow-hidden">
            <img
              v-if="item.kind === 'IMAGE'"
              :src="item.previewUrl"
              alt=""
              class="h-full w-full object-contain"
            >
            <FaIcon v-else name="i-lucide:video" class="text-muted-foreground size-5" aria-hidden="true" />
          </div>

          <div class="flex-1 min-w-0">
            <strong
              :id="`product-media-queue-title-${item.id}`"
              class="text-sm block truncate"
              :title="item.originalFilename"
            >
              {{ item.originalFilename }}
            </strong>
            <div class="qs-type-meta mt-1 flex gap-2 items-center">
              <FaIcon
                :name="phaseIcon(item)"
                :class="{ 'animate-spin': ['uploading', 'finalizing', 'reconciling'].includes(item.phase) }"
                aria-hidden="true"
              />
              <span>{{ phaseLabel(item) }}</span>
              <span>{{ formatProductMediaBytes(String(item.totalBytes)) }}</span>
            </div>
          </div>
        </div>

        <div v-if="item.phase === 'uploading' || item.phase === 'finalizing'" class="mt-3">
          <FaProgress
            :model-value="getProductMediaProgressPercent(item.loadedBytes, item.totalBytes)"
            :aria-label="`${item.originalFilename} 上传进度`"
          />
          <div class="qs-type-meta mt-1 flex justify-between">
            <span>{{ formatProductMediaBytes(String(item.loadedBytes)) }} / {{ formatProductMediaBytes(String(item.totalBytes)) }}</span>
            <span>{{ getProductMediaProgressPercent(item.loadedBytes, item.totalBytes) }}%</span>
          </div>
        </div>

        <p v-if="item.failure" class="text-sm text-destructive m-0 mt-3">
          {{ item.failure.message }}
          <code v-if="item.failure.requestId" class="qs-type-meta ms-1 break-all">requestId: {{ item.failure.requestId }}</code>
        </p>

        <div v-if="editable && (canCancel(item) || item.phase === 'failed')" class="mt-3 flex flex-wrap gap-2">
          <FaButton
            v-if="item.phase === 'failed'"
            variant="outline"
            class="min-h-11"
            :aria-label="`重试上传 ${item.originalFilename}`"
            @click="emit('retry', item.id)"
          >
            <FaIcon name="i-lucide:rotate-cw" class="shrink-0 size-4" aria-hidden="true" />
            <span>重试上传</span>
          </FaButton>
          <FaButton
            v-if="canCancel(item)"
            variant="outline"
            class="min-h-11"
            :aria-label="`取消上传 ${item.originalFilename}`"
            @click="emit('cancel', item.id)"
          >
            <FaIcon name="i-lucide:x" class="shrink-0 size-4" aria-hidden="true" />
            <span>取消上传</span>
          </FaButton>
        </div>
      </li>
    </ol>

    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      <template v-for="item in queue" :key="item.id">
        {{ item.originalFilename }}：{{ phaseLabel(item) }}。
      </template>
    </div>
  </section>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  :deep(.animate-spin) {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
