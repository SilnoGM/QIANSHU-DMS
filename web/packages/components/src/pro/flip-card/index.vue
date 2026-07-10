<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '#utils'
import ScrollArea from '../../basic/scroll-area/index.vue'

defineOptions({
  name: 'BuiltInFlipCard',
})

const props = withDefaults(defineProps<{
  rotate?: 'x' | 'y'
  class?: HTMLAttributes['class']
}>(), {
  rotate: 'y',
})

const rotation = computed(() => ({
  x: ['group-hover/flipcard:[transform:rotateX(180deg)]', '[transform:rotateX(180deg)]'],
  y: ['group-hover/flipcard:[transform:rotateY(180deg)]', '[transform:rotateY(180deg)]'],
}[props.rotate]))
</script>

<template>
  <div :class="cn('group/flipcard h-72 w-56 [perspective:1000px]', props.class)">
    <div
      :class="cn(
        'relative h-full rounded-2xl transition-all duration-500 [transform-style:preserve-3d]',
        rotation[0],
      )"
    >
      <!-- 正面 -->
      <div class="border rounded-2xl bg-card size-full [backface-visibility:hidden] absolute overflow-hidden">
        <slot />
      </div>
      <!-- 背面 -->
      <div
        :class="cn(
          '[backface-visibility:hidden] absolute size-full overflow-hidden border rounded-2xl bg-card',
          rotation[1],
        )"
      >
        <ScrollArea :scrollbar="false" mask class="h-full">
          <slot name="back" />
        </ScrollArea>
      </div>
    </div>
  </div>
</template>
