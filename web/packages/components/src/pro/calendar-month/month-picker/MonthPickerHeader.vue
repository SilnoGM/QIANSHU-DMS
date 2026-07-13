<script lang="ts" setup>
import type { MonthPickerHeaderProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerHeader, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerHeaderProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerHeader
    data-slot="month-picker-header"
    :class="cn('flex justify-center pt-1 relative items-center w-full px-8', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerHeader>
</template>
