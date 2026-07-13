<script lang="ts" setup>
import type { YearRangePickerGridProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerGrid } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearRangePickerGridProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerGrid
    data-slot="year-range-picker-grid"
    :class="cn('w-full border-collapse space-x-1', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearRangePickerGrid>
</template>
