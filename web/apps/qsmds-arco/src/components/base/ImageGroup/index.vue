<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type {
  ImageGroupEntry,
  ImageGroupErrorEvent,
  ImageGroupItem,
  ImageGroupPreviewEvent,
  ImageGroupProps,
  NormalizedImageGroupItem,
} from './types'
import { useFaImagePreview } from '@fantastic-admin/components'
import { computed, nextTick, ref, watch } from 'vue'
import {
  createImageGroupEntries,
  normalizeImageGroupItems,
  resolveImageGroupMaxCount,
  resolveImageGroupOverlap,
  resolveImageGroupRadius,
  resolveImageGroupSize,
  resolveImageGroupStateKey,
  resolveImageGroupTooltip,
  retainImageGroupStateKeys,
} from './logic'

defineOptions({ name: 'ImageGroup' })

const props = withDefaults(defineProps<ImageGroupProps>(), {
  fit: 'cover',
  maxCount: 4,
  overlap: undefined,
  preview: true,
  radius: 'md',
  size: 'md',
  tooltip: true,
  tooltipDelay: 300,
})

const emit = defineEmits<{
  imageError: [payload: ImageGroupErrorEvent]
  preview: [payload: ImageGroupPreviewEvent]
}>()

defineSlots<{
  empty: () => unknown
  error: (props: { index: number, item: ImageGroupItem }) => unknown
  tooltip: (props: { index: number, item: ImageGroupItem, total: number }) => unknown
}>()

const imagePreview = useFaImagePreview()
const loadedKeys = ref(new Set<string>())
const failedKeys = ref(new Set<string>())
const focusedEntryIndex = ref(0)
const triggerElements = ref<HTMLElement[]>([])

const normalizedItems = computed(() => normalizeImageGroupItems(props.items))
const resolvedSize = computed(() => resolveImageGroupSize(props.size))
const resolvedMaxCount = computed(() => resolveImageGroupMaxCount(props.maxCount))
const resolvedOverlap = computed(() => resolveImageGroupOverlap(
  props.overlap,
  resolvedSize.value,
))
const resolvedRadius = computed(() => resolveImageGroupRadius(props.radius))
const entries = computed(() => createImageGroupEntries(
  normalizedItems.value,
  resolvedMaxCount.value,
))
const previewSources = computed(() => normalizedItems.value.map(
  ({ item }) => item.previewSrc || item.src,
))
const groupAriaLabel = computed(() => `图片组，共 ${normalizedItems.value.length} 张`)
const fitClass = computed(() => props.fit === 'contain' ? 'object-contain' : 'object-cover')
const groupStyle = computed<CSSProperties>(() => ({
  '--qs-image-group-top-layer': String(entries.value.length + 1),
}))

watch(
  () => props.items,
  () => {
    // 查询刷新可能返回新的数组实例，但 URL 未变化的缓存图片不会再次触发 load。
    // 仅清除已移除或同 key 换 URL 的状态，避免缩略图永久停留在透明 loading 态。
    loadedKeys.value = retainImageGroupStateKeys(loadedKeys.value, normalizedItems.value)
    failedKeys.value = retainImageGroupStateKeys(failedKeys.value, normalizedItems.value)
    focusedEntryIndex.value = 0
    triggerElements.value = []
  },
  { deep: true },
)

function isImageLoaded(image: NormalizedImageGroupItem): boolean {
  return loadedKeys.value.has(resolveImageGroupStateKey(image))
}

function isImageFailed(image: NormalizedImageGroupItem): boolean {
  return failedKeys.value.has(resolveImageGroupStateKey(image))
}

function getImageState(image: NormalizedImageGroupItem): 'error' | 'loaded' | 'loading' {
  if (isImageFailed(image)) {
    return 'error'
  }
  return isImageLoaded(image) ? 'loaded' : 'loading'
}

function getEntryStyle(displayIndex: number): CSSProperties {
  const style: CSSProperties & Record<string, string | undefined> = {
    borderRadius: resolvedRadius.value.style,
    height: `${resolvedSize.value}px`,
    marginInlineStart: displayIndex === 0 ? undefined : `-${resolvedOverlap.value}px`,
    width: `${resolvedSize.value}px`,
  }
  style['--qs-image-group-index'] = String(displayIndex + 1)
  return style
}

function getTooltipImageStyle(): CSSProperties {
  return {
    borderRadius: resolvedRadius.value.style,
  }
}

function setTriggerElement(value: unknown, index: number) {
  const componentElement = value && typeof value === 'object' && '$el' in value
    ? (value as { $el?: unknown }).$el
    : undefined
  const element = value instanceof HTMLElement
    ? value
    : componentElement instanceof HTMLElement
      ? componentElement
      : undefined

  if (element) {
    triggerElements.value[index] = element
  }
}

/**
 * Vue 模板 ref 同时可能返回原生元素或组件实例。使用稳定的回调工厂把 unknown
 * 收敛到 HTMLElement，避免模板内联 lambda 丢失参数类型。
 */
function getTriggerRef(index: number): (value: unknown) => void {
  return value => setTriggerElement(value, index)
}

function handleImageLoad(image: NormalizedImageGroupItem) {
  const nextLoadedKeys = new Set(loadedKeys.value)
  nextLoadedKeys.add(resolveImageGroupStateKey(image))
  loadedKeys.value = nextLoadedKeys
}

function handleImageError(image: ImageGroupEntry & { type: 'image' }) {
  const nextFailedKeys = new Set(failedKeys.value)
  nextFailedKeys.add(resolveImageGroupStateKey(image.image))
  failedKeys.value = nextFailedKeys
  emit('imageError', {
    index: image.image.index,
    item: image.image.item,
  })
}

function openPreview(index: number) {
  if (!props.preview) {
    return
  }

  const image = normalizedItems.value[index]
  if (!image || isImageFailed(image)) {
    return
  }

  imagePreview.open(previewSources.value, index)
  emit('preview', {
    index,
    item: image.item,
  })
}

function handleEntryClick(entry: ImageGroupEntry) {
  if (entry.type === 'overflow') {
    openPreview(entry.previewIndex)
    return
  }
  openPreview(entry.image.index)
}

async function focusEntry(index: number) {
  if (!entries.value.length) {
    return
  }
  const normalizedIndex = (index + entries.value.length) % entries.value.length
  focusedEntryIndex.value = normalizedIndex
  await nextTick()
  triggerElements.value[normalizedIndex]?.focus()
}

function handleTriggerKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    void focusEntry(index - 1)
  }
  else if (event.key === 'ArrowRight') {
    event.preventDefault()
    void focusEntry(index + 1)
  }
  else if (event.key === 'Home') {
    event.preventDefault()
    void focusEntry(0)
  }
  else if (event.key === 'End') {
    event.preventDefault()
    void focusEntry(entries.value.length - 1)
  }
}

function getTriggerAriaLabel(entry: ImageGroupEntry): string {
  if (entry.type === 'overflow') {
    return `查看其余 ${entry.hiddenCount} 张图片`
  }
  const tooltip = resolveImageGroupTooltip(entry.image.item, entry.image.index)
  return props.preview ? `预览${tooltip}` : tooltip
}
</script>

<template>
  <span v-if="!normalizedItems.length" data-slot="image-group-empty" class="text-muted-foreground">
    <slot name="empty">
      —
    </slot>
  </span>

  <div
    v-else
    data-slot="image-group"
    role="group"
    :aria-label="groupAriaLabel"
    :style="groupStyle"
    class="qs-image-group align-middle inline-flex items-center isolate"
  >
    <FaTooltip
      v-for="(entry, displayIndex) in entries"
      :key="entry.type === 'image' ? entry.image.key : 'image-group-overflow'"
      :delay="tooltipDelay"
      :disabled="!tooltip"
      side="top"
      align="center"
    >
      <component
        :is="preview ? 'button' : 'span'"
        :ref="getTriggerRef(displayIndex)"
        :type="preview ? 'button' : undefined"
        :tabindex="focusedEntryIndex === displayIndex ? 0 : -1"
        :aria-label="getTriggerAriaLabel(entry)"
        :class="resolvedRadius.className"
        :style="getEntryStyle(displayIndex)"
        class="qs-image-group__item"
        :data-image-state="entry.type === 'image' ? getImageState(entry.image) : 'overflow'"
        @click.stop="handleEntryClick(entry)"
        @focus="focusedEntryIndex = displayIndex"
        @keydown="handleTriggerKeydown($event, displayIndex)"
      >
        <template v-if="entry.type === 'image'">
          <img
            :src="entry.image.item.src"
            :alt="entry.image.item.alt ?? ''"
            loading="lazy"
            decoding="async"
            data-image-state="loaded"
            class="size-full transition-opacity duration-180"
            :class="[
              fitClass,
              isImageLoaded(entry.image) && !isImageFailed(entry.image)
                ? 'opacity-100'
                : 'opacity-0',
            ]"
            @load="handleImageLoad(entry.image)"
            @error="handleImageError(entry)"
          >

          <span
            v-if="isImageFailed(entry.image)"
            data-image-state="error"
            class="text-muted-foreground bg-muted/35 flex-center inset-0 absolute"
          >
            <slot
              name="error"
              :item="entry.image.item"
              :index="entry.image.index"
            >
              <FaIcon name="i-lucide:image-off" class="size-[42%]" aria-hidden="true" />
            </slot>
          </span>
          <span
            v-else-if="!isImageLoaded(entry.image)"
            data-image-state="loading"
            class="bg-muted/45 inset-0 absolute animate-pulse"
            aria-hidden="true"
          />
        </template>

        <span
          v-else
          class="qs-type-meta text-foreground bg-muted/75 flex-center size-full tabular-nums"
        >
          +{{ entry.hiddenCount }}
        </span>
      </component>

      <template #content>
        <template v-if="entry.type === 'image'">
          <slot
            name="tooltip"
            :item="entry.image.item"
            :index="entry.image.index"
            :total="normalizedItems.length"
          >
            <div class="w-44">
              <div
                class="border border-background/15 bg-background aspect-square overflow-hidden"
                :class="resolvedRadius.className"
                :style="getTooltipImageStyle()"
              >
                <img
                  v-if="!isImageFailed(entry.image)"
                  :src="entry.image.item.src"
                  alt=""
                  decoding="async"
                  class="size-full"
                  :class="fitClass"
                >
                <div v-else class="text-muted-foreground bg-muted flex-center size-full">
                  <FaIcon name="i-lucide:image-off" class="size-8" aria-hidden="true" />
                </div>
              </div>
              <div class="mt-2 flex gap-2 min-w-0 items-center justify-between">
                <span class="truncate">
                  {{ isImageFailed(entry.image)
                    ? '图片加载失败'
                    : resolveImageGroupTooltip(entry.image.item, entry.image.index) }}
                </span>
                <span class="opacity-65 shrink-0 tabular-nums">
                  {{ entry.image.index + 1 }}/{{ normalizedItems.length }}
                </span>
              </div>
            </div>
          </slot>
        </template>
        <span v-else>还有 {{ entry.hiddenCount }} 张图片</span>
      </template>
    </FaTooltip>
  </div>
</template>

<style scoped>
.qs-image-group__item {
  position: relative;
  z-index: var(--qs-image-group-index);
  display: grid;
  flex: none;
  place-items: center;
  padding: 0;
  overflow: hidden;
  font: inherit;
  color: inherit;
  cursor: pointer;
  outline: none;
  background: oklch(var(--muted));
  border: 1px solid oklch(var(--border));
  box-shadow: 0 0 0 2px oklch(var(--background));
  transform: translateY(0);
  transform-origin: center;
  transition:
    color 160ms ease-out,
    background-color 160ms ease-out,
    border-color 160ms ease-out,
    box-shadow 160ms ease-out,
    opacity 160ms ease-out,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-image-group__item:hover,
.qs-image-group__item:focus-visible {
  z-index: var(--qs-image-group-top-layer);
  transform: translateY(-2px);
}

.qs-image-group__item:focus-visible {
  box-shadow:
    0 0 0 2px oklch(var(--background)),
    0 0 0 4px oklch(var(--ring) / 48%);
}

.qs-image-group__item:active {
  transform: translateY(-1px) scale(0.98);
}

.qs-image-group__item[data-image-state="error"] {
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .qs-image-group__item,
  .qs-image-group__item :deep(img) {
    transition-duration: 0.01ms !important;
  }
}
</style>
