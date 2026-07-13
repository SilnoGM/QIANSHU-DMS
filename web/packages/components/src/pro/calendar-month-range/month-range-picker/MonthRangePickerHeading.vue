<script lang="ts" setup>
import type { MonthRangePickerHeadingProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerHeading, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerHeadingProps & { class?: HTMLAttributes['class'] }>()

defineSlots<{
  default: (props: { headingValue: string }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerHeading
    v-slot="{ headingValue }"
    data-slot="month-range-picker-heading"
    :class="cn('text-sm font-medium', props.class)"
    v-bind="forwardedProps"
  >
    <slot :heading-value>
      {{ headingValue }}
    </slot>
  </MonthRangePickerHeading>
</template>
