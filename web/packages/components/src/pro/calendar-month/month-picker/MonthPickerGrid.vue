<script lang="ts" setup>
import type { MonthPickerGridProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerGrid, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerGridProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerGrid
    data-slot="month-picker-grid"
    :class="cn('w-full border-collapse space-x-1', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerGrid>
</template>
