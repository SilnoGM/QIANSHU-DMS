<script setup lang="ts">
import type { CarouselEmits, CarouselProps, WithClassAsProps } from './interface'
import { useTextDirection } from '@vueuse/core'
import { cn } from '#utils'
import { useProvideCarousel } from './useCarousel'

const props = withDefaults(defineProps<CarouselProps & WithClassAsProps>(), {
  orientation: 'horizontal',
})

const emits = defineEmits<CarouselEmits>()

const dir = useTextDirection({
  observe: true,
})

const { canScrollNext, canScrollPrev, carouselApi, carouselRef, orientation, scrollNext, scrollPrev } = useProvideCarousel(props, emits)

defineExpose({
  canScrollNext,
  canScrollPrev,
  carouselApi,
  carouselRef,
  orientation,
  scrollNext,
  scrollPrev,
})

function onKeyDown(event: KeyboardEvent) {
  const isRtl = dir.value === 'rtl'
  const prevKey = props.orientation === 'vertical' ? 'ArrowUp' : (isRtl ? 'ArrowRight' : 'ArrowLeft')
  const nextKey = props.orientation === 'vertical' ? 'ArrowDown' : (isRtl ? 'ArrowLeft' : 'ArrowRight')

  if (event.key === prevKey) {
    event.preventDefault()
    scrollPrev()

    return
  }

  if (event.key === nextKey) {
    event.preventDefault()
    scrollNext()
  }
}
</script>

<template>
  <div
    data-slot="carousel"
    :class="cn('relative', props.class)"
    role="region"
    aria-roledescription="carousel"
    tabindex="0"
    @keydown="onKeyDown"
  >
    <slot :can-scroll-next :can-scroll-prev :carousel-api :carousel-ref :orientation :scroll-next :scroll-prev />
  </div>
</template>
