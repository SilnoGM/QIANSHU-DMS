<script lang="ts" setup>
import type { MonthRangePickerPrevProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerPrev, useForwardProps } from 'reka-ui'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'

const props = defineProps<MonthRangePickerPrevProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthRangePickerPrev
    v-bind="forwardedProps"
    as-child
    data-slot="month-range-picker-prev-button"
  >
    <Button
      variant="outline"
      size="icon-sm"
      :class="cn('bg-transparent p-0 opacity-50 hover:opacity-100', props.class)"
    >
      <slot>
        <ChevronLeft class="size-4" />
      </slot>
    </Button>
  </MonthRangePickerPrev>
</template>
