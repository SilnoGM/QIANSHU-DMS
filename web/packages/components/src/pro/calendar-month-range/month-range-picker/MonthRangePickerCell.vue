<script lang="ts" setup>
import type { MonthRangePickerCellProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerCell, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerCellProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerCell
    data-slot="month-range-picker-cell"
    :class="cn('relative p-0 text-center text-sm focus-within:relative focus-within:z-20 flex-1 [&:has([data-selected])]:bg-accent [&:has([data-highlighted])]:bg-accent first:[&:has([data-selected])]:rounded-l-md last:[&:has([data-selected])]:rounded-r-md first:[&:has([data-highlighted])]:rounded-l-md last:[&:has([data-highlighted])]:rounded-r-md [&:has([data-selection-start])]:rounded-l-md [&:has([data-selection-end])]:rounded-r-md [&:has([data-highlighted-start])]:rounded-l-md [&:has([data-highlighted-end])]:rounded-r-md', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerCell>
</template>
