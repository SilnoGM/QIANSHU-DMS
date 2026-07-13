<script lang="ts" setup>
import type { MonthPickerGridBodyProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerGridBody, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<MonthPickerGridBodyProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerGridBody
    data-slot="month-picker-grid-body"
    :class="cn(props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </MonthPickerGridBody>
</template>
