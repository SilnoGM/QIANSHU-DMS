<script lang="ts" setup>
import type { DateValue } from '@internationalized/date'
import type { RangeCalendarRootEmits, RangeCalendarRootProps } from 'reka-ui'
import type { HTMLAttributes, Ref } from 'vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { reactiveOmit, useVModel } from '@vueuse/core'
import { RangeCalendarRoot, useForwardPropsEmits } from 'reka-ui'
import { cn } from '#utils'
import { RangeCalendarCell, RangeCalendarCellTrigger, RangeCalendarGrid, RangeCalendarGridBody, RangeCalendarGridHead, RangeCalendarGridRow, RangeCalendarHeadCell, RangeCalendarHeader, RangeCalendarHeading, RangeCalendarNextButton, RangeCalendarPrevButton } from '.'

const props = withDefaults(defineProps<RangeCalendarRootProps & { class?: HTMLAttributes['class'] }>(), {
  modelValue: undefined,
})

const emits = defineEmits<RangeCalendarRootEmits>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
}>()

const delegatedProps = reactiveOmit(props, 'class', 'placeholder')

const placeholder = useVModel(props, 'placeholder', emits, {
  passive: true,
  defaultValue: props.modelValue?.start ?? props.defaultValue?.start ?? props.defaultPlaceholder ?? today(getLocalTimeZone()),
}) as Ref<DateValue>

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <RangeCalendarRoot
    v-slot="{ grid, weekDays, date }"
    v-bind="forwarded"
    v-model:placeholder="placeholder"
    data-slot="range-calendar"
    :class="cn('p-3', props.class)"
  >
    <RangeCalendarHeader class="px-9 pt-0">
      <RangeCalendarPrevButton />

      <div class="flex max-w-full min-w-0 justify-center">
        <slot name="heading" :date="date">
          <RangeCalendarHeading />
        </slot>
      </div>

      <RangeCalendarNextButton />
    </RangeCalendarHeader>

    <div class="mt-4 flex flex-col gap-y-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()">
        <RangeCalendarGridHead>
          <RangeCalendarGridRow>
            <RangeCalendarHeadCell
              v-for="day in weekDays" :key="day"
            >
              {{ day }}
            </RangeCalendarHeadCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow v-for="(weekDates, index) in month.rows" :key="`weekDate-${index}`" class="mt-2 w-full">
            <RangeCalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
            >
              <RangeCalendarCellTrigger
                :day="weekDate"
                :month="month.value"
              />
            </RangeCalendarCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridBody>
      </RangeCalendarGrid>
    </div>
  </RangeCalendarRoot>
</template>
