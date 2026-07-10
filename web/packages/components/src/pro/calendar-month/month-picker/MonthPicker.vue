<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { MonthPickerRootEmits, MonthPickerRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { MonthPickerRoot, useForwardPropsEmits } from 'reka-ui'
import { cn } from '#utils'
import { MonthPickerCell, MonthPickerCellTrigger, MonthPickerGrid, MonthPickerGridBody, MonthPickerGridRow, MonthPickerHeader, MonthPickerHeading, MonthPickerNextButton, MonthPickerPrevButton } from '.'

type MonthPickerValue = DateValue | DateValue[]
type MonthPickerProps = Omit<MonthPickerRootProps, 'modelValue' | 'defaultValue'> & {
  modelValue?: MonthPickerValue | null
  defaultValue?: MonthPickerValue
  class?: HTMLAttributes['class']
}

type MonthPickerEmits = Omit<MonthPickerRootEmits, 'update:modelValue'> & {
  'update:modelValue': [date: MonthPickerValue | undefined]
}

const props = withDefaults(defineProps<MonthPickerProps>(), {
  modelValue: undefined,
})

const emits = defineEmits<MonthPickerEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits) as object
</script>

<template>
  <MonthPickerRoot
    v-slot="{ grid, date }"
    v-bind="forwarded"
    data-slot="month-picker"
    :class="cn('p-3', props.class)"
  >
    <MonthPickerHeader class="px-0 pt-0 gap-3 justify-between">
      <MonthPickerPrevButton />

      <div class="flex flex-1 min-w-0 justify-center">
        <slot name="heading" :date="date">
          <MonthPickerHeading />
        </slot>
      </div>

      <MonthPickerNextButton />
    </MonthPickerHeader>

    <MonthPickerGrid class="mt-4">
      <MonthPickerGridBody>
        <MonthPickerGridRow v-for="(months, index) in grid.rows" :key="`month-row-${index}`" class="mt-2 w-full">
          <MonthPickerCell
            v-for="month in months"
            :key="month.toString()"
            :date="month"
          >
            <MonthPickerCellTrigger :month="month" />
          </MonthPickerCell>
        </MonthPickerGridRow>
      </MonthPickerGridBody>
    </MonthPickerGrid>
  </MonthPickerRoot>
</template>
