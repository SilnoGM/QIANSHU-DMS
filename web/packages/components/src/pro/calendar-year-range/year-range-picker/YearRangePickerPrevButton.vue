<script lang="ts" setup>
import type { YearRangePickerPrevProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearRangePickerPrev } from 'reka-ui'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'

const props = defineProps<YearRangePickerPrevProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearRangePickerPrev
    v-bind="forwardedProps"
    as-child
    data-slot="year-range-picker-prev-button"
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
  </YearRangePickerPrev>
</template>
