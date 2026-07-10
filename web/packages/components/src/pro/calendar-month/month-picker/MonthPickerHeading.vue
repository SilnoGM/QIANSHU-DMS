<script lang="ts" setup>
import type { MonthPickerHeadingProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerHeading, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerHeadingProps & { class?: HTMLAttributes['class'] }>()

defineSlots<{
  default: (props: { headingValue: string }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerHeading
    v-slot="{ headingValue }"
    data-slot="month-picker-heading"
    :class="cn('text-sm font-medium', props.class)"
    v-bind="forwardedProps"
  >
    <slot :heading-value>
      {{ headingValue }}
    </slot>
  </MonthPickerHeading>
</template>
