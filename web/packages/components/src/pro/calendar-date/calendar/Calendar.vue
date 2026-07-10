<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { CalendarRootEmits, CalendarRootProps } from 'reka-ui'
import type { HTMLAttributes, Ref } from 'vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { reactiveOmit, useVModel } from '@vueuse/core'
import { CalendarRoot, useForwardPropsEmits } from 'reka-ui'
import { cn } from '#utils'
import { CalendarCell, CalendarCellTrigger, CalendarGrid, CalendarGridBody, CalendarGridHead, CalendarGridRow, CalendarHeadCell, CalendarHeader, CalendarHeading, CalendarNextButton, CalendarPrevButton } from '.'

type CalendarValue = DateValue | DateValue[]
type CalendarProps = Omit<CalendarRootProps, 'modelValue' | 'defaultValue'> & {
  modelValue?: CalendarValue | null
  defaultValue?: CalendarValue
  class?: HTMLAttributes['class']
}

type CalendarEmits = Omit<CalendarRootEmits, 'update:modelValue'> & {
  'update:modelValue': [date: CalendarValue | undefined]
}

const props = withDefaults(defineProps<CalendarProps>(), {
  modelValue: undefined,
})
const emits = defineEmits<CalendarEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class', 'placeholder')

const placeholder = useVModel(props, 'placeholder', emits, {
  passive: true,
  defaultValue: getReferenceDate(props.modelValue) ?? props.defaultPlaceholder ?? today(getLocalTimeZone()),
}) as Ref<DateValue>

const forwarded = useForwardPropsEmits(delegatedProps, emits) as object

function getReferenceDate(value: CalendarValue | null | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}
</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays, date }"
    v-bind="forwarded"
    v-model:placeholder="placeholder"
    data-slot="calendar"
    :class="cn('p-3', props.class)"
  >
    <CalendarHeader class="px-0 pt-0 gap-3 justify-between">
      <CalendarPrevButton />

      <div class="flex flex-1 min-w-0 justify-center">
        <slot name="heading" :date="date">
          <CalendarHeading />
        </slot>
      </div>

      <CalendarNextButton />
    </CalendarHeader>

    <div class="mt-4 flex flex-col gap-y-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <CalendarGrid v-for="month in grid" :key="month.value.toString()">
        <CalendarGridHead>
          <CalendarGridRow>
            <CalendarHeadCell
              v-for="day in weekDays" :key="day"
            >
              {{ day }}
            </CalendarHeadCell>
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow v-for="(weekDates, index) in month.rows" :key="`weekDate-${index}`" class="mt-2 w-full">
            <CalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
            >
              <CalendarCellTrigger
                :day="weekDate"
                :month="month.value"
              />
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  </CalendarRoot>
</template>
