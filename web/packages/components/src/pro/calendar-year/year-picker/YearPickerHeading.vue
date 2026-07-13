<script lang="ts" setup>
import type { YearPickerHeadingProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerHeading } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerHeadingProps & { class?: HTMLAttributes['class'] }>()

defineSlots<{
  default: (props: { headingValue: string }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerHeading
    v-slot="{ headingValue }"
    data-slot="year-picker-heading"
    :class="cn('text-sm font-medium', props.class)"
    v-bind="forwardedProps"
  >
    <slot :heading-value>
      {{ headingValue }}
    </slot>
  </YearPickerHeading>
</template>
