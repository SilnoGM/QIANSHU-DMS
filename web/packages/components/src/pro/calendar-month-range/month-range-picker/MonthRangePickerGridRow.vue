<script lang="ts" setup>
import type { MonthRangePickerGridRowProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerGridRow, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerGridRowProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerGridRow
    data-slot="month-range-picker-grid-row"
    :class="cn('flex', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerGridRow>
</template>
