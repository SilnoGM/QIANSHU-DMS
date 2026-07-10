<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { YearRangePickerRootEmits, YearRangePickerRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardPropsEmits, YearRangePickerRoot } from 'reka-ui'
import { cn } from '#utils'
import { YearRangePickerCell, YearRangePickerCellTrigger, YearRangePickerGrid, YearRangePickerGridBody, YearRangePickerGridRow, YearRangePickerHeader, YearRangePickerHeading, YearRangePickerNextButton, YearRangePickerPrevButton } from '.'

const props = withDefaults(defineProps<YearRangePickerRootProps & { class?: HTMLAttributes['class'] }>(), {
  modelValue: undefined,
})

const emits = defineEmits<YearRangePickerRootEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <YearRangePickerRoot
    v-slot="{ grid, date }"
    v-bind="forwarded"
    data-slot="year-range-picker"
    :class="cn('p-3', props.class)"
  >
    <YearRangePickerHeader class="px-0 pt-0 gap-3 justify-between">
      <YearRangePickerPrevButton />

      <div class="flex flex-1 min-w-0 justify-center">
        <slot name="heading" :date="date">
          <YearRangePickerHeading />
        </slot>
      </div>

      <YearRangePickerNextButton />
    </YearRangePickerHeader>

    <YearRangePickerGrid class="mt-4">
      <YearRangePickerGridBody>
        <YearRangePickerGridRow v-for="(years, index) in grid.rows" :key="`year-range-row-${index}`" class="mt-2 w-full">
          <YearRangePickerCell
            v-for="year in years"
            :key="year.toString()"
            :date="year"
          >
            <YearRangePickerCellTrigger :year="year" />
          </YearRangePickerCell>
        </YearRangePickerGridRow>
      </YearRangePickerGridBody>
    </YearRangePickerGrid>
  </YearRangePickerRoot>
</template>
