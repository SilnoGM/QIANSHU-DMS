<script lang="ts" setup>
import type { YearPickerGridRowProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerGridRow } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerGridRowProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerGridRow
    data-slot="year-picker-grid-row"
    :class="cn('flex', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearPickerGridRow>
</template>
