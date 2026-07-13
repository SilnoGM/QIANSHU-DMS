<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInTextHighlight',
})

const props = withDefaults(defineProps<{
  delay?: number
  duration?: number
  from?: 'left' | 'right' | 'top' | 'bottom'
  textEndColor?: string
  class?: HTMLAttributes['class']
}>(), {
  delay: 0,
  duration: 2000,
  from: 'left',
  textEndColor: 'inherit',
})

const delayMs = computed(() => `${props.delay}ms`)
const durationMs = computed(() => `${props.duration}ms`)
</script>

<template>
  <span :data-from="props.from" :class="cn('inline-block px-1 pb-1', props.class)"><slot /></span>
</template>

<style scoped>
@keyframes background-expand-left {
  0% {
    background-size: 0% 100%;
  }

  100% {
    background-size: 100% 100%;
  }
}

@keyframes background-expand-right {
  0% {
    background-size: 0% 100%;
  }

  100% {
    background-size: 100% 100%;
  }
}

@keyframes background-expand-top {
  0% {
    background-size: 100% 0%;
  }

  100% {
    background-size: 100% 100%;
  }
}

@keyframes background-expand-bottom {
  0% {
    background-size: 100% 0%;
  }

  100% {
    background-size: 100% 100%;
  }
}

@keyframes text-color-change {
  0% {
    color: inherit;
  }

  100% {
    color: v-bind(textEndColor);
  }
}

span {
  background-repeat: no-repeat;
  animation-duration: v-bind(durationMs), v-bind(durationMs);
  animation-timing-function: ease-in-out, ease-in-out;
  animation-delay: v-bind(delayMs), v-bind(delayMs);
  animation-fill-mode: forwards, forwards;
}

span[data-from="left"] {
  background-position: left center;
  background-size: 0% 100%;
  animation-name: background-expand-left, text-color-change;
}

span[data-from="right"] {
  background-position: right center;
  background-size: 0% 100%;
  animation-name: background-expand-right, text-color-change;
}

span[data-from="top"] {
  background-position: center top;
  background-size: 100% 0%;
  animation-name: background-expand-top, text-color-change;
}

span[data-from="bottom"] {
  background-position: center bottom;
  background-size: 100% 0%;
  animation-name: background-expand-bottom, text-color-change;
}
</style>
