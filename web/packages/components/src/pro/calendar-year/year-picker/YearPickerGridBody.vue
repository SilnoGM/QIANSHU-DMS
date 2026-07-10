<script lang="ts" setup>
import type { YearPickerGridBodyProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerGridBody } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerGridBodyProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerGridBody
    data-slot="year-picker-grid-body"
    :class="cn(props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearPickerGridBody>
</template>
