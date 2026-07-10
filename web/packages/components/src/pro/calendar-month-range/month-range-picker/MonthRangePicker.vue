<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { MonthRangePickerRootEmits, MonthRangePickerRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthRangePickerRoot, useForwardPropsEmits } from 'reka-ui'
import { cn } from '#utils'
import { MonthRangePickerCell, MonthRangePickerCellTrigger, MonthRangePickerGrid, MonthRangePickerGridBody, MonthRangePickerGridRow, MonthRangePickerHeader, MonthRangePickerHeading, MonthRangePickerNextButton, MonthRangePickerPrevButton } from '.'

const props = withDefaults(defineProps<MonthRangePickerRootProps & { class?: HTMLAttributes['class'] }>(), {
  modelValue: undefined,
})

const emits = defineEmits<MonthRangePickerRootEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <MonthRangePickerRoot
    v-slot="{ grid, date }"
    v-bind="forwarded"
    data-slot="month-range-picker"
    :class="cn('p-3', props.class)"
  >
    <MonthRangePickerHeader class="px-0 pt-0 gap-3 justify-between">
      <MonthRangePickerPrevButton />

      <div class="flex flex-1 min-w-0 justify-center">
        <slot name="heading" :date="date">
          <MonthRangePickerHeading />
        </slot>
      </div>

      <MonthRangePickerNextButton />
    </MonthRangePickerHeader>

    <MonthRangePickerGrid class="mt-4">
      <MonthRangePickerGridBody>
        <MonthRangePickerGridRow v-for="(months, index) in grid.rows" :key="`month-range-row-${index}`" class="mt-2 w-full">
          <MonthRangePickerCell
            v-for="month in months"
            :key="month.toString()"
            :date="month"
          >
            <MonthRangePickerCellTrigger :month="month" />
          </MonthRangePickerCell>
        </MonthRangePickerGridRow>
      </MonthRangePickerGridBody>
    </MonthRangePickerGrid>
  </MonthRangePickerRoot>
</template>
