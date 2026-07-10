<script lang="ts" setup>
import type { MonthRangePickerHeaderProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerHeader, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthRangePickerHeaderProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerHeader
    data-slot="month-range-picker-header"
    :class="cn('flex justify-center pt-1 relative items-center w-full px-8', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthRangePickerHeader>
</template>
