<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInMarquee',
})

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    reverse?: boolean
    pauseOnHover?: boolean
    vertical?: boolean
    repeat?: number
  }>(),
  {
    reverse: false,
    pauseOnHover: false,
    vertical: false,
    repeat: 4,
  },
)
</script>

<template>
  <div
    :class="cn(
      'group/marquee flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]',
      vertical ? 'flex-col mask-t-from-80% mask-b-from-80%' : 'flex-row rtl:justify-end mask-l-from-80% mask-r-from-80%',
      props.class,
    )"
  >
    <div
      v-for="index in repeat"
      :key="index"
      :class="cn(
        'flex shrink-0 justify-around [gap:var(--gap)]',
        vertical ? 'animate-marquee-vertical flex-col' : 'animate-marquee flex-row',
        pauseOnHover ? 'group-hover/marquee:[animation-play-state:paused]' : '',
      )"
      :style="{
        animationDirection: reverse ? 'reverse' : 'normal',
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.animate-marquee {
  animation: marquee var(--duration) linear infinite;
  animation-direction: reverse;
}

.animate-marquee-vertical {
  animation: marquee-vertical var(--duration) linear infinite;
}

@keyframes marquee {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(calc(-100% - var(--gap)));
  }
}

@keyframes marquee-vertical {
  from {
    transform: translateY(0);
  }

  to {
    transform: translateY(calc(-100% - var(--gap)));
  }
}
</style>
