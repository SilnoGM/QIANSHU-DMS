<script lang="ts" setup>
import type { YearPickerHeaderProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerHeader } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<YearPickerHeaderProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerHeader
    data-slot="year-picker-header"
    :class="cn('flex justify-center pt-1 relative items-center w-full px-8', props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </YearPickerHeader>
</template>
