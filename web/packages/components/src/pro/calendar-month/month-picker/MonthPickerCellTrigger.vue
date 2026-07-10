<script lang="ts" setup>
import type { MonthPickerCellTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerCellTrigger, useForwardProps } from 'reka-ui'
import { cn } from '#utils'
import { buttonVariants } from '../../../basic/button/button'

const props = withDefaults(defineProps<MonthPickerCellTriggerProps & { class?: HTMLAttributes['class'] }>(), {
  as: 'button',
})

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerCellTrigger
    data-slot="month-picker-cell-trigger"
    :class="cn(
      buttonVariants({ variant: 'ghost' }),
      'h-9 w-full min-w-16 p-0 font-normal aria-selected:opacity-100 cursor-default',
      '[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground',
      // Selected
      'data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:opacity-100 [&[data-selected]:hover]:bg-primary data-[selected]:hover:text-primary-foreground data-[selected]:focus:bg-primary data-[selected]:focus:text-primary-foreground',
      // Disabled
      'disabled:pointer-events-auto data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground data-[disabled]:opacity-50',
      // Unavailable
      'data-[unavailable]:cursor-not-allowed data-[unavailable]:text-muted-foreground data-[unavailable]:opacity-50 data-[unavailable]:line-through',
      props.class,
    )"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerCellTrigger>
</template>
