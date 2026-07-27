<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { computed, ref, toRefs, watch } from 'vue'

type GoodTooltipAlign = 'center' | 'end' | 'start'
type GoodTooltipImageFit = 'contain' | 'cover'
type GoodTooltipSide = 'bottom' | 'left' | 'right' | 'top'

interface QsGoodTooltipProps {
  align?: GoodTooltipAlign
  delay?: number
  disabled?: boolean
  imageAlt?: string
  imageFit?: GoodTooltipImageFit
  imageSrc?: string | null
  side?: GoodTooltipSide
}

defineOptions({ name: 'QsGoodTooltip' })

const props = withDefaults(defineProps<QsGoodTooltipProps>(), {
  align: 'center',
  delay: 300,
  disabled: false,
  imageAlt: '',
  imageFit: 'cover',
  imageSrc: null,
  side: 'top',
})

defineSlots<{
  content: () => unknown
  default: () => unknown
}>()

const {
  align,
  delay,
  disabled,
  imageAlt,
  imageSrc,
} = toRefs(props)

const isNarrowViewport = useMediaQuery('(max-width: 639px)')
const imageFailed = ref(false)
const hasImageSource = computed(() => (
  typeof props.imageSrc === 'string'
  && props.imageSrc.trim().length > 0
))
const imageFitClass = computed(() => (
  props.imageFit === 'contain' ? 'object-contain' : 'object-cover'
))
const resolvedSide = computed<GoodTooltipSide>(() => {
  // 窄屏没有足够的横向空间容纳产品卡片。Reka 只会优先翻转到相反侧，
  // 因此 left / right 在两侧都不足时需要主动降级为 top，避免浮层越出视口。
  if (
    isNarrowViewport.value
    && (props.side === 'left' || props.side === 'right')
  ) {
    return 'top'
  }
  return props.side
})

watch(
  () => props.imageSrc,
  () => {
    // 产品切换后必须清除上一张图片的失败状态，否则新地址会继续显示旧占位。
    imageFailed.value = false
  },
)

function handleImageError() {
  imageFailed.value = true
}
</script>

<template>
  <FaTooltip
    :delay="delay"
    :side="resolvedSide"
    :align="align"
    :disabled="disabled"
  >
    <slot />

    <template #content>
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
            :src="imageSrc ?? undefined"
            :alt="imageAlt"
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
            :aria-label="imageAlt || '暂无产品图片'"
            class="text-background/65 bg-background/10 flex-center size-full"
          >
            <FaIcon name="i-lucide:image-off" class="size-6" aria-hidden="true" />
          </div>
        </div>

        <div
          data-slot="good-tooltip-info"
          class="min-w-0 self-center"
        >
          <slot name="content">
            <span class="opacity-70">暂无产品信息</span>
          </slot>
        </div>
      </div>
    </template>
  </FaTooltip>
</template>
