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

interface ImageActionMenuItem {
  disabled?: boolean
  handle: () => void
  icon: string
  label: string
  variant?: 'default' | 'destructive'
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

/**
 * 将低频图片管理动作收敛到同一个语义化菜单中。菜单仍保留禁用状态，
 * 因此键盘用户可以理解首尾位置、当前主图和提交锁定等业务边界。
 */
function imageActionItems(
  item: ProductMediaItemDto,
  index: number,
): ImageActionMenuItem[][] {
  const isPrimary = item.id === props.primaryImageId
  return [
    [
      {
        disabled: props.locked || isPrimary,
        handle: () => emit('primary', item.id),
        icon: 'i-lucide:star',
        label: isPrimary ? '当前主图' : '设为主图',
      },
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
        label: '解除图片',
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
  <section aria-labelledby="product-media-images-title" class="min-w-0">
    <div class="mb-3 flex flex-wrap gap-3 items-end justify-between">
      <div>
        <h3 id="product-media-images-title" class="text-base font-semibold m-0">
          产品图片
        </h3>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          拖拽可快速调整；也可通过更多操作设置主图和排序。
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
          class="border-b bg-muted/40 flex w-full items-center justify-center relative overflow-hidden"
          :style="{ aspectRatio: mediaAspectRatio(item) }"
        >
          <button
            v-if="contentUrls[item.id]"
            type="button"
            class="product-image-preview-trigger group p-0 border-0 bg-transparent h-full w-full cursor-zoom-in relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="`预览图片 ${item.originalFilename}`"
            @click="emit('preview', item)"
          >
            <img
              :src="contentUrls[item.id]!"
              :alt="item.originalFilename"
              class="h-full w-full object-contain"
              loading="lazy"
            >
            <span
              class="product-image-preview-overlay text-background bg-foreground/55 opacity-0 flex pointer-events-none items-center inset-0 justify-center absolute group-focus-visible:opacity-100 group-focus:opacity-100 group-hover:opacity-100"
              aria-hidden="true"
            >
              <span class="product-image-preview-indicator text-foreground rounded-full bg-background/90 flex size-11 shadow-sm items-center justify-center">
                <FaIcon name="i-lucide:eye" class="size-5" />
              </span>
            </span>
          </button>
          <div v-else class="text-sm text-muted-foreground p-5 text-center">
            <FaIcon name="i-lucide:image-off" class="mx-auto mb-2 size-6" aria-hidden="true" />
            当前身份不可读取图片内容
          </div>

          <span
            v-if="item.id === primaryImageId"
            class="text-xs text-primary-foreground font-medium px-2.5 py-1 rounded-full bg-primary inline-flex gap-1.5 pointer-events-none shadow-sm items-center left-2.5 top-2.5 absolute z-10"
          >
            <FaIcon name="i-lucide:star" class="size-3.5" aria-hidden="true" />
            主图
          </span>
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
              <span>{{ formatProductMediaBytes(item.sizeBytes) }}</span>
            </div>
          </div>

          <FaDropdown
            v-if="editable"
            :items="imageActionItems(item, index)"
            align="end"
          >
            <FaButton
              variant="ghost"
              size="icon"
              class="min-h-11 min-w-11"
              :aria-label="`更多图片操作 ${item.originalFilename}`"
              data-focus-anchor
            >
              <FaIcon name="i-lucide:ellipsis" class="size-5" aria-hidden="true" />
            </FaButton>
          </FaDropdown>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.product-image-preview-overlay {
  transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* 显式覆盖鼠标与键盘状态，避免构建工具对组合状态类的匹配差异。 */
.product-image-preview-trigger:hover .product-image-preview-overlay,
.product-image-preview-trigger:focus .product-image-preview-overlay,
.product-image-preview-trigger:focus-visible .product-image-preview-overlay {
  opacity: 1;
}

/* 触控设备没有 Hover，保留一个常驻的小眼睛作为可发现的预览入口。 */
@media (hover: none) {
  .product-image-preview-overlay {
    align-items: flex-end;
    justify-content: flex-end;
    padding: 0.75rem;
    background: transparent;
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .product-image-preview-overlay,
  .product-media-card {
    transition: none;
  }
}
</style>
