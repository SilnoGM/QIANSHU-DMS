<script lang="ts" setup>
import type { YearRangePickerHeadingProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerHeading } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearRangePickerHeadingProps & { class?: HTMLAttributes['class'] }>()

defineSlots<{
  default: (props: { headingValue: string }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerHeading
    v-slot="{ headingValue }"
    data-slot="year-range-picker-heading"
    :class="cn('text-sm font-medium', props.class)"
    v-bind="forwardedProps"
  >
    <slot :heading-value>
      {{ headingValue }}
    </slot>
  </YearRangePickerHeading>
</template>
