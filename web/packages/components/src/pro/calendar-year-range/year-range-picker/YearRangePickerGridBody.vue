<script lang="ts" setup>
import type { YearRangePickerGridBodyProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerGridBody } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearRangePickerGridBodyProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerGridBody
    data-slot="year-range-picker-grid-body"
    :class="cn(props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearRangePickerGridBody>
</template>
