<script setup lang="ts">
import type { ProductMediaItemDto } from '../../../../api/generated/types.gen'

import {
  formatProductMediaBytes,
  formatProductMediaDuration,
} from './product-media-view.logic'

interface ProductVideoBoardProps {
  contentUrls: Readonly<Record<string, string | null>>
  detachLocked: boolean
  editable: boolean
  items: readonly ProductMediaItemDto[]
  locked: boolean
}

defineOptions({ name: 'ProductVideoBoard' })

const props = defineProps<ProductVideoBoardProps>()
const emit = defineEmits<{
  detach: [item: ProductMediaItemDto]
  move: [productMediaId: string, targetIndex: number]
  preview: [item: ProductMediaItemDto]
}>()

const draggedId = ref<string | null>(null)

function mediaAspectRatio(item: ProductMediaItemDto): string {
  return item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : '16 / 9'
}

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
          视频保留原生播放控件，排序方式与图片一致。
        </p>
      </div>
      <span class="qs-type-meta">{{ items.length }} / 5 个</span>
    </div>

    <FaEmpty
      v-if="items.length === 0"
      icon="i-lucide:video-off"
      title="暂无产品视频"
      description="可上传 MP4 视频展示产品细节。"
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
          class="border-b bg-muted/40 flex w-full items-center justify-center overflow-hidden"
          :style="{ aspectRatio: mediaAspectRatio(item) }"
        >
          <video
            v-if="contentUrls[item.id]"
            :src="contentUrls[item.id]!"
            :aria-label="`播放视频 ${item.originalFilename}`"
            class="h-full w-full object-contain"
            controls
            preload="metadata"
          />
          <div v-else class="text-sm text-muted-foreground p-5 text-center">
            <FaIcon name="i-lucide:video-off" class="mx-auto mb-2 size-6" aria-hidden="true" />
            当前身份不可读取视频内容
          </div>
        </div>

        <div class="p-3 gap-3 grid">
          <div class="min-w-0">
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

          <div class="gap-2 grid grid-cols-2">
            <FaButton
              variant="outline"
              class="min-h-11"
              :disabled="contentUrls[item.id] === null"
              :aria-label="`预览视频 ${item.originalFilename}`"
              @click="emit('preview', item)"
            >
              <FaIcon name="i-lucide:play" class="shrink-0 size-4" aria-hidden="true" />
              <span>预览视频</span>
            </FaButton>
            <FaButton
              v-if="editable"
              variant="outline"
              class="min-h-11"
              :disabled="!canMove(index, -1)"
              :aria-label="`前移视频 ${item.originalFilename}`"
              @click="move(item, index, -1)"
            >
              <FaIcon name="i-lucide:arrow-left" class="shrink-0 size-4" aria-hidden="true" />
              <span>前移</span>
            </FaButton>
            <FaButton
              v-if="editable"
              variant="outline"
              class="min-h-11"
              :disabled="!canMove(index, 1)"
              :aria-label="`后移视频 ${item.originalFilename}`"
              @click="move(item, index, 1)"
            >
              <FaIcon name="i-lucide:arrow-right" class="shrink-0 size-4" aria-hidden="true" />
              <span>后移</span>
            </FaButton>
            <FaButton
              v-if="editable"
              variant="outline"
              class="min-h-11"
              :disabled="detachLocked"
              :aria-label="`解除视频 ${item.originalFilename}`"
              data-focus-anchor
              @click="emit('detach', item)"
            >
              <FaIcon name="i-lucide:trash-2" class="shrink-0 size-4" aria-hidden="true" />
              <span>解除视频</span>
            </FaButton>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .product-media-card {
    transition: none;
  }
}
</style>
