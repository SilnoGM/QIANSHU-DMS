<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { YearPickerRootEmits, YearPickerRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { useForwardPropsEmits, YearPickerRoot } from 'reka-ui'
import { cn } from '#utils'
import { YearPickerCell, YearPickerCellTrigger, YearPickerGrid, YearPickerGridBody, YearPickerGridRow, YearPickerHeader, YearPickerHeading, YearPickerNextButton, YearPickerPrevButton } from '.'

type YearPickerValue = DateValue | DateValue[]
type YearPickerProps = Omit<YearPickerRootProps, 'modelValue' | 'defaultValue'> & {
  modelValue?: YearPickerValue | null
  defaultValue?: YearPickerValue
  class?: HTMLAttributes['class']
}

type YearPickerEmits = Omit<YearPickerRootEmits, 'update:modelValue'> & {
  'update:modelValue': [date: YearPickerValue | undefined]
}

const props = withDefaults(defineProps<YearPickerProps>(), {
  modelValue: undefined,
})

const emits = defineEmits<YearPickerEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits) as object
</script>

<template>
  <YearPickerRoot
    v-slot="{ grid, date }"
    v-bind="forwarded"
    data-slot="year-picker"
    :class="cn('p-3', props.class)"
  >
    <YearPickerHeader class="px-0 pt-0 gap-3 justify-between">
      <YearPickerPrevButton />

      <div class="flex flex-1 min-w-0 justify-center">
        <slot name="heading" :date="date">
          <YearPickerHeading />
        </slot>
      </div>

      <YearPickerNextButton />
    </YearPickerHeader>

    <YearPickerGrid class="mt-4">
      <YearPickerGridBody>
        <YearPickerGridRow v-for="(years, index) in grid.rows" :key="`year-row-${index}`" class="mt-2 w-full">
          <YearPickerCell
            v-for="year in years"
            :key="year.toString()"
            :date="year"
          >
            <YearPickerCellTrigger :year="year" />
          </YearPickerCell>
        </YearPickerGridRow>
      </YearPickerGridBody>
    </YearPickerGrid>
  </YearPickerRoot>
</template>
