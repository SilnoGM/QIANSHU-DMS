<script setup lang="ts">
import type { Transition } from 'motion-v'
import type { CSSProperties, HTMLAttributes } from 'vue'
import { Motion } from 'motion-v'
import { computed } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInTextShiny',
})

const props = withDefaults(defineProps<{
  duration?: number
  delay?: number
  class?: HTMLAttributes['class']
}>(), {
  duration: 1.5,
  delay: 1.5,
})

const shimmerStyle = computed<CSSProperties>(() => ({
  WebkitTextFillColor: 'transparent',
  backgroundColor: 'currentColor',
  backgroundImage: 'linear-gradient(to right, currentColor 0%, var(--shimmer-contrast) 40%, var(--shimmer-contrast) 60%, currentColor 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '50% 200%',
}))

const shimmerTransition = computed<Transition>(() => ({
  duration: props.duration,
  delay: props.delay,
  repeat: Infinity,
  repeatDelay: 1.5,
  ease: 'linear',
}))
</script>

<template>
  <Motion
    as="span"
    :class="cn(
      'inline-block [--shimmer-contrast:rgba(255,255,255,0.6)] dark:[--shimmer-contrast:rgba(0,0,0,0.5)]',
      props.class,
    )"
    :style="shimmerStyle"
    :initial="{ backgroundPositionX: '250%' }"
    :animate="{ backgroundPositionX: ['-100%', '250%'] }"
    :transition="shimmerTransition"
  >
    <slot />
  </Motion>
</template>
