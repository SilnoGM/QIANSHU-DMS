<script lang="ts" setup>
import type { MonthPickerCellProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerCell, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerCellProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerCell
    data-slot="month-picker-cell"
    :class="cn('relative p-0 text-center text-sm focus-within:relative focus-within:z-20 flex-1 [&:has([data-selected])]:rounded-md [&:has([data-selected])]:bg-accent', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerCell>
</template>
