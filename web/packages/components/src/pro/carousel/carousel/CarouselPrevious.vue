<script setup lang="ts">
import type { ButtonVariants } from '../../../basic/button/button'
import type { WithClassAsProps } from './interface'
import { ArrowLeft } from '@lucide/vue'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'
import { useCarousel } from './useCarousel'

const props = withDefaults(defineProps<{
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
}
& WithClassAsProps>(), {
  variant: 'outline',
  size: 'icon',
})

const { orientation, canScrollPrev, scrollPrev } = useCarousel()
</script>

<template>
  <Button
    data-slot="carousel-previous"
    :disabled="!canScrollPrev"
    :class="cn(
      'absolute size-8 rounded-full',
      orientation === 'horizontal'
        ? 'top-1/2 -start-12 -translate-y-1/2'
        : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
      props.class,
    )"
    :variant="variant"
    :size="size"
    @click="scrollPrev"
  >
    <slot>
      <ArrowLeft class="rtl:rotate-180" />
      <span class="sr-only">Previous Slide</span>
    </slot>
  </Button>
</template>
