<script setup lang="ts">
import type { ProductMediaItemDto } from '../../../../api/generated/types.gen'

import { formatProductMediaBytes } from './product-media-view.logic'

interface ProductImageBoardProps {
  contentUrls: Readonly<Record<string, string | null>>
  detachLocked: boolean
  editable: boolean
  items: readonly ProductMediaItemDto[]
  locked: boolean
  primaryImageId: string | null
}

defineOptions({ name: 'ProductImageBoard' })

const props = defineProps<ProductImageBoardProps>()
const emit = defineEmits<{
  detach: [item: ProductMediaItemDto]
  move: [productMediaId: string, targetIndex: number]
  preview: [item: ProductMediaItemDto]
  primary: [productMediaId: string]
}>()

const draggedId = ref<string | null>(null)

function mediaAspectRatio(item: ProductMediaItemDto): string {
  return item.width > 0 && item.height > 0
    ? `${item.width} / ${item.height}`
    : '4 / 3'
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
  <section aria-labelledby="product-media-images-title" class="min-w-0">
    <div class="mb-3 flex flex-wrap gap-3 items-end justify-between">
      <div>
        <h3 id="product-media-images-title" class="text-base font-semibold m-0">
          产品图片
        </h3>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          拖拽可快速调整；键盘用户可使用前移和后移按钮。
        </p>
      </div>
      <span class="qs-type-meta">{{ items.length }} / 20 张</span>
    </div>

    <FaEmpty
      v-if="items.length === 0"
      icon="i-lucide:image-off"
      title="暂无产品图片"
      description="上传第一张图片后，可将其设置为产品主图。"
      class="py-10 border rounded-lg border-dashed"
    />

    <div
      v-else
      class="product-image-grid gap-3 grid grid-cols-1 min-w-0 2xl:grid-cols-4 sm:grid-cols-2 xl:grid-cols-3"
      role="list"
      aria-label="产品图片排序"
    >
      <article
        v-for="(item, index) in items"
        :key="item.id"
        :data-media-id="item.id"
        class="product-media-card border rounded-lg bg-card min-w-0 transition-transform overflow-hidden"
        :class="{
          'ring-2 ring-primary': item.id === primaryImageId,
          'opacity-70': draggedId === item.id,
        }"
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
          <img
            v-if="contentUrls[item.id]"
            :src="contentUrls[item.id]!"
            :alt="item.originalFilename"
            class="h-full w-full object-contain"
            loading="lazy"
          >
          <div v-else class="text-sm text-muted-foreground p-5 text-center">
            <FaIcon name="i-lucide:image-off" class="mx-auto mb-2 size-6" aria-hidden="true" />
            当前身份不可读取图片内容
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
              <span>{{ formatProductMediaBytes(item.sizeBytes) }}</span>
            </div>
          </div>

          <FaButton
            v-if="editable"
            variant="outline"
            class="min-h-11 w-full justify-center"
            :aria-pressed="item.id === primaryImageId"
            :disabled="locked || item.id === primaryImageId"
            @click="emit('primary', item.id)"
          >
            <FaIcon name="i-lucide:star" class="shrink-0 size-4" aria-hidden="true" />
            <span>{{ item.id === primaryImageId ? '当前主图' : '设为主图' }}</span>
          </FaButton>

          <div class="gap-2 grid grid-cols-2">
            <FaButton
              variant="outline"
              class="min-h-11"
              :disabled="contentUrls[item.id] === null"
              :aria-label="`预览图片 ${item.originalFilename}`"
              @click="emit('preview', item)"
            >
              <FaIcon name="i-lucide:scan-search" class="shrink-0 size-4" aria-hidden="true" />
              <span>预览图片</span>
            </FaButton>
            <FaButton
              v-if="editable"
              variant="outline"
              class="min-h-11"
              :disabled="!canMove(index, -1)"
              :aria-label="`前移图片 ${item.originalFilename}`"
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
              :aria-label="`后移图片 ${item.originalFilename}`"
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
              :aria-label="`解除图片 ${item.originalFilename}`"
              data-focus-anchor
              @click="emit('detach', item)"
            >
              <FaIcon name="i-lucide:trash-2" class="shrink-0 size-4" aria-hidden="true" />
              <span>解除图片</span>
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
