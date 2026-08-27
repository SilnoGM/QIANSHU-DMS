<script setup lang="ts">
import type { PopoverContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '#utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover'

defineOptions({
  name: 'BuiltInPopover',
})

const props = withDefaults(defineProps<{
  align?: PopoverContentProps['align']
  alignOffset?: PopoverContentProps['alignOffset']
  autoFocus?: boolean
  side?: PopoverContentProps['side']
  sideOffset?: PopoverContentProps['sideOffset']
  collisionPadding?: PopoverContentProps['collisionPadding']
  class?: HTMLAttributes['class']
}>(), {
  autoFocus: false,
})

function handleOpenAutoFocus(e: Event) {
  // 默认保持既有轻量提示行为；确认型 Popover 可显式允许焦点进入操作区。
  if (!props.autoFocus) {
    e.preventDefault()
  }
}

const open = defineModel<boolean>('open', {
  default: false,
})
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverContent :align :align-offset :side :side-offset :collision-padding :class="cn('z-2000 w-unset min-w-72', props.class)" @open-auto-focus="handleOpenAutoFocus">
      <slot name="panel" />
    </PopoverContent>
  </Popover>
</template>
