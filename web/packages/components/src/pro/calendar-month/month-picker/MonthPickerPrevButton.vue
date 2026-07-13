<script lang="ts" setup>
import type { MonthPickerPrevProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerPrev, useForwardProps } from 'reka-ui'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'

const props = defineProps<MonthPickerPrevProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerPrev
    v-bind="forwardedProps"
    as-child
    data-slot="month-picker-prev-button"
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
  </MonthPickerPrev>
</template>
