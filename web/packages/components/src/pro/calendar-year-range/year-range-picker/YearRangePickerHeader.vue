<script lang="ts" setup>
import type { YearRangePickerHeaderProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerHeader } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearRangePickerHeaderProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerHeader
    data-slot="year-range-picker-header"
    :class="cn('flex justify-center pt-1 relative items-center w-full px-8', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearRangePickerHeader>
</template>
