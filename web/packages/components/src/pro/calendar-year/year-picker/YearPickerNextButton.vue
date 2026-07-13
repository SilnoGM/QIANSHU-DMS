<script lang="ts" setup>
import type { YearPickerNextProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronRight } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardProps, YearPickerNext } from 'reka-ui'
import { cn } from '#utils'
import { Button } from '../../../basic/button/button'

const props = defineProps<YearPickerNextProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <YearPickerNext
    v-bind="forwardedProps"
    as-child
    data-slot="year-picker-next-button"
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
  </YearPickerNext>
</template>
