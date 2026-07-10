<script lang="ts" setup>
import type { YearPickerGridProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerGrid } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerGridProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerGrid
    data-slot="year-picker-grid"
    :class="cn('w-full border-collapse space-x-1', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearPickerGrid>
</template>
