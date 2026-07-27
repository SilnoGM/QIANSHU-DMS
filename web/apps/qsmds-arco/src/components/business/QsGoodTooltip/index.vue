<script setup lang="ts">
import type { QsGoodTooltipProps } from './types'
import { useMediaQuery } from '@vueuse/core'
import { computed, toRefs } from 'vue'
import QsGoodTooltipContent from './QsGoodTooltipContent.vue'

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
  imageFit,
  imageSrc,
} = toRefs(props)

const isNarrowViewport = useMediaQuery('(max-width: 639px)')
const resolvedSide = computed(() => {
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
      <QsGoodTooltipContent
        :image-src="imageSrc"
        :image-alt="imageAlt"
        :image-fit="imageFit"
      >
        <!-- 命名插槽在包装器内继续保留兜底，避免空插槽转发吞掉内容层默认值。 -->
        <slot name="content">
          <span class="opacity-70">暂无产品信息</span>
        </slot>
      </QsGoodTooltipContent>
    </template>
  </FaTooltip>
</template>
