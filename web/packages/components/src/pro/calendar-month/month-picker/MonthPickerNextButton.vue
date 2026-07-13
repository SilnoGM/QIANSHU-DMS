<script lang="ts" setup>
import type { MonthPickerNextProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronRight } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerNext, useForwardProps } from 'reka-ui'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'

const props = defineProps<MonthPickerNextProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <MonthPickerNext
    v-bind="forwardedProps"
    as-child
    data-slot="month-picker-next-button"
  >
    <Button
      variant="outline"
      size="icon-sm"
      :class="cn('bg-transparent p-0 opacity-50 hover:opacity-100', props.class)"
    >
      <slot>
        <ChevronRight class="size-4" />
      </slot>
    </Button>
  </MonthPickerNext>
</template>
