<script lang="ts" setup>
import type { MonthRangePickerGridProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerGrid, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerGridProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerGrid
    data-slot="month-range-picker-grid"
    :class="cn('w-full border-collapse space-x-1', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerGrid>
</template>
