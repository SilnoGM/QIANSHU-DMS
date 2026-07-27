<script setup lang="ts">
import type { QsGoodTooltipContentProps } from './types'
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'QsGoodTooltipContent' })

const props = withDefaults(defineProps<QsGoodTooltipContentProps>(), {
  imageAlt: '',
  imageFit: 'cover',
  imageSrc: null,
})

defineSlots<{
  default?: () => unknown
}>()

const imageFailed = ref(false)
const hasImageSource = computed(() => (
  typeof props.imageSrc === 'string'
  && props.imageSrc.trim().length > 0
))
const imageFitClass = computed(() => (
  props.imageFit === 'contain' ? 'object-contain' : 'object-cover'
))

watch(
  () => props.imageSrc,
  () => {
    // 同一内容实例切换到另一件产品后，不能沿用上一张图片的加载失败状态。
    imageFailed.value = false
  },
)

function handleImageError() {
  imageFailed.value = true
}
</script>

<template>
  <div
    data-slot="good-tooltip-content"
    class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] max-w-[calc(100vw-3rem)] w-80 items-start"
  >
    <div
      data-slot="good-tooltip-image"
      class="border border-background/15 rounded-md bg-background size-18 overflow-hidden"
    >
      <img
        v-if="hasImageSource && !imageFailed"
        :src="props.imageSrc ?? undefined"
        :alt="props.imageAlt"
        loading="lazy"
        decoding="async"
        class="size-full"
        :class="imageFitClass"
        @error="handleImageError"
      >
      <div
        v-else
        data-slot="good-tooltip-image-fallback"
        role="img"
        :aria-label="props.imageAlt || '暂无产品图片'"
        class="text-background/65 bg-background/10 flex-center size-full"
      >
        <FaIcon name="i-lucide:image-off" class="size-6" aria-hidden="true" />
      </div>
    </div>

    <div
      data-slot="good-tooltip-info"
      class="min-w-0 self-center"
    >
      <slot>
        <span class="opacity-70">暂无产品信息</span>
      </slot>
    </div>
  </div>
</template>
