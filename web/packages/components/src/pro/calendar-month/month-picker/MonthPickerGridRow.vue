<script lang="ts" setup>
import type { MonthPickerGridRowProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerGridRow, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerGridRowProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerGridRow
    data-slot="month-picker-grid-row"
    :class="cn('flex', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerGridRow>
</template>
