<script lang="ts" setup>
import type { MonthRangePickerGridBodyProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerGridBody, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerGridBodyProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerGridBody
    data-slot="month-range-picker-grid-body"
    :class="cn(props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerGridBody>
</template>
