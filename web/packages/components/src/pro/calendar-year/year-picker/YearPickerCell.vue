<script lang="ts" setup>
import type { YearPickerCellProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerCell } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerCellProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerCell
    data-slot="year-picker-cell"
    :class="cn('relative p-0 text-center text-sm focus-within:relative focus-within:z-20 flex-1 [&:has([data-selected])]:rounded-md [&:has([data-selected])]:bg-accent', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearPickerCell>
</template>
