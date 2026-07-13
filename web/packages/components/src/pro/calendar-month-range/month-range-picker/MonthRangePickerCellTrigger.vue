<script lang="ts" setup>
import type { MonthRangePickerCellTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerCellTrigger, useForwardProps } from 'reka-ui'
import { cn } from '#utils'
import { buttonVariants } from '../../../basic/button/button'

const props = withDefaults(defineProps<MonthRangePickerCellTriggerProps & { class?: HTMLAttributes['class'] }>(), {
  as: 'button',
})

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerCellTrigger
    data-slot="month-range-picker-cell-trigger"
    :class="cn(
      buttonVariants({ variant: 'ghost' }),
      'h-9 w-full min-w-16 p-0 font-normal data-[selected]:opacity-100',
      '[&[data-today]:not([data-selected])]:bg-accent [&[data-today]:not([data-selected])]:text-accent-foreground',
      // Selection Start
      'data-[selection-start]:bg-primary data-[selection-start]:text-primary-foreground [&[data-selection-start]:hover]:bg-primary data-[selection-start]:hover:text-primary-foreground data-[selection-start]:focus:bg-primary data-[selection-start]:focus:text-primary-foreground',
      // Selection End
      'data-[selection-end]:bg-primary data-[selection-end]:text-primary-foreground [&[data-selection-end]:hover]:bg-primary data-[selection-end]:hover:text-primary-foreground data-[selection-end]:focus:bg-primary data-[selection-end]:focus:text-primary-foreground',
      // Disabled
      'disabled:pointer-events-auto data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground data-[disabled]:opacity-50',
      // Unavailable
      'data-[unavailable]:cursor-not-allowed data-[unavailable]:text-muted-foreground data-[unavailable]:opacity-50 data-[unavailable]:line-through',
      props.class,
    )"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerCellTrigger>
</template>
