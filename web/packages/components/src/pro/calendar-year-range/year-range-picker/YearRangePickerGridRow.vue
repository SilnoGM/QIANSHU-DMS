<script lang="ts" setup>
import type { YearRangePickerGridRowProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerGridRow } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearRangePickerGridRowProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerGridRow
    data-slot="year-range-picker-grid-row"
    :class="cn('flex', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearRangePickerGridRow>
</template>
