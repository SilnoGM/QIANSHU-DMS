<script setup lang="ts">
import type { ProductMediaItemDto } from '../../../../api/generated/types.gen'
import type { ProductVideoPreviewFailure } from './product-media-common.logic'

import { mediaPosterUrl } from '@/utils/media-variant'
import { resolveProductVideoPreviewFailure } from './product-media-common.logic'
import {
  formatProductMediaBytes,
  formatProductMediaDuration,
} from './product-media-view.logic'

interface ProductVideoBoardProps {
  authEpoch: number
  contentUrls: Readonly<Record<string, string | null>>
  detachLocked: boolean
  editable: boolean
  items: readonly ProductMediaItemDto[]
  locked: boolean
}

interface VideoActionMenuItem {
  disabled?: boolean
  handle: () => void
  icon: string
  label: string
  variant?: 'default' | 'destructive'
}

defineOptions({ name: 'ProductVideoBoard' })

const props = defineProps<ProductVideoBoardProps>()
const emit = defineEmits<{
  detach: [item: ProductMediaItemDto]
  move: [productMediaId: string, targetIndex: number]
  preview: [item: ProductMediaItemDto]
}>()

const draggedId = ref<string | null>(null)
const previewFailures = reactive<Record<string, ProductVideoPreviewFailure>>({})

function clearPreviewFailures(): void {
  for (const productMediaId of Object.keys(previewFailures)) {
    delete previewFailures[productMediaId]
  }
}

function previewFailureTitle(failure: ProductVideoPreviewFailure): string {
  return failure === 'capability' ? '当前浏览器不支持此视频' : '视频加载失败'
}

function previewFailureDescription(failure: ProductVideoPreviewFailure): string {
  return failure === 'capability'
    ? '可以下载原文件后使用本地播放器查看。'
    : '请检查网络后重试，或直接下载原文件。'
}

function handleVideoError(event: Event, productMediaId: string): void {
  const video = event.currentTarget as HTMLVideoElement
  const failure = resolveProductVideoPreviewFailure(video.error?.code)
  if (failure === null) {
    delete previewFailures[productMediaId]
    return
  }
  previewFailures[productMediaId] = failure
}

watch(
  [
    () => props.authEpoch,
    () => props.items.map(item => item.id).join('\0'),
    () => props.items.map(item => props.contentUrls[item.id] ?? '').join('\0'),
  ],
  clearPreviewFailures,
)

function canMove(index: number, offset: -1 | 1): boolean {
  return props.editable
    && !props.locked
    && index + offset >= 0
    && index + offset < props.items.length
}

function move(item: ProductMediaItemDto, index: number, offset: -1 | 1): void {
  if (canMove(index, offset)) {
    emit('move', item.id, index + offset)
  }
}

/**
 * 视频与图片使用同一低频操作模型：卡片只保留一个明确的更多入口，
 * 排序和解除仍由既有领域事件处理，避免视觉收敛意外改变业务状态。
 */
function videoActionItems(
  item: ProductMediaItemDto,
  index: number,
): VideoActionMenuItem[][] {
  return [
    [
      {
        disabled: !canMove(index, -1),
        handle: () => move(item, index, -1),
        icon: 'i-lucide:arrow-left',
        label: '前移',
      },
      {
        disabled: !canMove(index, 1),
        handle: () => move(item, index, 1),
        icon: 'i-lucide:arrow-right',
        label: '后移',
      },
    ],
    [
      {
        disabled: props.detachLocked,
        handle: () => emit('detach', item),
        icon: 'i-lucide:trash-2',
        label: '解除视频',
        variant: 'destructive',
      },
    ],
  ]
}

function handleDragStart(event: DragEvent, item: ProductMediaItemDto): void {
  if (!props.editable || props.locked) {
    event.preventDefault()
    return
  }
  draggedId.value = item.id
  event.dataTransfer?.setData('text/plain', item.id)
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function handleDrop(event: DragEvent, targetIndex: number): void {
  event.preventDefault()
  if (!props.editable || props.locked) {
    return
  }
  const sourceId = draggedId.value ?? event.dataTransfer?.getData('text/plain')
  const sourceBelongsToBoard = typeof sourceId === 'string'
    && props.items.some(item => item.id === sourceId)
  if (
    typeof sourceId === 'string'
    && sourceBelongsToBoard
    && sourceId !== props.items[targetIndex]?.id
  ) {
    emit('move', sourceId, targetIndex)
  }
  draggedId.value = null
}
</script>

<template>
  <section aria-labelledby="product-media-videos-title" class="min-w-0">
    <div class="mb-3 flex flex-wrap gap-3 items-end justify-between">
      <div>
        <h3 id="product-media-videos-title" class="text-base font-semibold m-0">
          产品视频
        </h3>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          悬停或聚焦可快速预览；排序与解除收纳在更多操作中。
        </p>
      </div>
      <span class="qs-type-meta">{{ items.length }} / 5 个</span>
    </div>

    <FaEmpty
      v-if="items.length === 0"
      icon="i-lucide:video-off"
      title="暂无产品视频"
      description="可上传 MP4、MOV、M4V 或 WebM 视频展示产品细节。"
      class="py-10 border rounded-lg border-dashed"
    />

    <div v-else class="gap-3 grid min-w-0 md:grid-cols-2" role="list" aria-label="产品视频排序">
      <article
        v-for="(item, index) in items"
        :key="item.id"
        :data-media-id="item.id"
        class="product-media-card border rounded-lg bg-card min-w-0 transition-transform overflow-hidden"
        :class="{ 'opacity-70': draggedId === item.id }"
        role="listitem"
        :draggable="editable && !locked"
        @dragstart="handleDragStart($event, item)"
        @dragend="draggedId = null"
        @dragover.prevent
        @drop="handleDrop($event, index)"
      >
        <div
          class="border-b bg-muted/40 flex w-full aspect-video items-center justify-center relative overflow-hidden"
        >
          <button
            v-if="contentUrls[item.id] && previewFailures[item.id] === undefined"
            type="button"
            class="product-video-preview-trigger group p-0 border-0 bg-transparent h-full w-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="`预览视频 ${item.originalFilename}`"
            @click="emit('preview', item)"
          >
            <video
              :src="contentUrls[item.id]!"
              :poster="mediaPosterUrl(contentUrls[item.id])"
              class="h-full w-full object-contain"
              aria-hidden="true"
              muted
              playsinline
              preload="none"
              tabindex="-1"
              @error="handleVideoError($event, item.id)"
              @loadedmetadata="delete previewFailures[item.id]"
            />
            <span
              class="product-video-preview-overlay text-background bg-foreground/55 opacity-0 flex pointer-events-none items-center inset-0 justify-center absolute group-focus-visible:opacity-100 group-focus:opacity-100 group-hover:opacity-100"
              aria-hidden="true"
            >
              <span class="product-video-preview-indicator text-foreground rounded-full bg-background/90 flex size-11 shadow-sm items-center justify-center">
                <FaIcon name="i-lucide:play" class="ml-0.5 size-5" />
              </span>
            </span>
          </button>
          <div
            v-else-if="contentUrls[item.id] && previewFailures[item.id]"
            class="text-sm p-5 text-center gap-2 grid place-items-center"
            role="status"
          >
            <FaIcon name="i-lucide:circle-alert" class="text-muted-foreground size-6" aria-hidden="true" />
            <strong>{{ previewFailureTitle(previewFailures[item.id]!) }}</strong>
            <p class="text-muted-foreground m-0">
              {{ previewFailureDescription(previewFailures[item.id]!) }}
            </p>
            <a
              :href="contentUrls[item.id]!"
              download
              :aria-label="`下载视频 ${item.originalFilename}`"
              class="text-sm font-medium px-3 border rounded-md inline-flex gap-2 min-h-11 items-center focus-visible:outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FaIcon name="i-lucide:download" class="shrink-0 size-4" aria-hidden="true" />
              <span>下载原视频</span>
            </a>
          </div>
          <div v-else class="text-sm text-muted-foreground p-5 text-center">
            <FaIcon name="i-lucide:video-off" class="mx-auto mb-2 size-6" aria-hidden="true" />
            当前身份不可读取视频内容
          </div>
        </div>

        <div class="p-3 flex gap-2 min-w-0 items-start justify-between">
          <div class="pt-1 min-w-0">
            <div class="flex gap-2 items-center">
              <span class="qs-type-meta shrink-0">#{{ index + 1 }}</span>
              <strong class="text-sm truncate" :title="item.originalFilename">
                {{ item.originalFilename }}
              </strong>
            </div>
            <div class="qs-type-meta mt-1 flex flex-wrap gap-x-2 gap-y-1">
              <span>{{ item.width }} × {{ item.height }}</span>
              <span>{{ formatProductMediaDuration(item.durationMs) }}</span>
              <span>{{ formatProductMediaBytes(item.sizeBytes) }}</span>
            </div>
          </div>

          <FaDropdown
            v-if="editable"
            :items="videoActionItems(item, index)"
            align="end"
          >
            <FaButton
              variant="ghost"
              size="icon"
              class="min-h-11 min-w-11"
              :aria-label="`更多视频操作 ${item.originalFilename}`"
              data-focus-anchor
            >
              <FaIcon name="i-lucide:ellipsis-vertical" class="size-5" aria-hidden="true" />
            </FaButton>
          </FaDropdown>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.product-video-preview-overlay {
  transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* 显式覆盖鼠标与键盘状态，确保预览入口和图片卡片具有相同的可发现性。 */
.product-video-preview-trigger:hover .product-video-preview-overlay,
.product-video-preview-trigger:focus .product-video-preview-overlay,
.product-video-preview-trigger:focus-visible .product-video-preview-overlay {
  opacity: 1;
}

/* 触控设备没有 Hover，右下角常驻播放入口，同时避免遮挡视频主体。 */
@media (hover: none) {
  .product-video-preview-overlay {
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0.75rem;
    background: transparent;
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .product-video-preview-overlay,
  .product-media-card {
    transition: none;
  }
}
</style>
