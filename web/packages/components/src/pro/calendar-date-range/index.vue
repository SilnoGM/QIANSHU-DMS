<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { Direction, PopoverContentProps } from 'reka-ui'
import type { HTMLAttributes, Ref } from 'vue'
import type { ButtonVariants } from '../../basic/button/button'
import { getLocalTimeZone, today } from '@internationalized/date'
import { createReusableTemplate, useTextDirection, useVModel } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { cn } from '#utils'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import Popover from '../../basic/popover/index.vue'
import RangeCalendar from './range-calendar/RangeCalendar.vue'

export interface CalendarDateRangeValue {
  start: DateValue | undefined
  end: DateValue | undefined
}

export interface CalendarDateRangeCompleteValue {
  start: DateValue
  end: DateValue
}

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6
type WeekdayFormat = 'narrow' | 'short' | 'long'
type DateMatcher = (date: DateValue) => boolean

defineOptions({
  name: 'BuiltInCalendarDateRange',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarDateRangeValue
    defaultValue?: CalendarDateRangeValue
    placeholder?: DateValue
    defaultPlaceholder?: DateValue
    minValue?: DateValue
    maxValue?: DateValue
    disabled?: boolean
    readonly?: boolean
    locale?: string
    dir?: Direction
    weekStartsOn?: WeekStartsOn
    weekdayFormat?: WeekdayFormat
    fixedWeeks?: boolean
    numberOfMonths?: number
    pagedNavigation?: boolean
    preventDeselect?: boolean
    initialFocus?: boolean
    isDateDisabled?: DateMatcher
    isDateUnavailable?: DateMatcher
    disableDaysOutsideCurrentView?: boolean
    calendarLabel?: string
    allowNonContiguousRanges?: boolean
    maximumDays?: number
    fixedDate?: 'start' | 'end'
    isDateHighlightable?: DateMatcher
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarDateRangeValue) => string
    closeOnSelect?: boolean
    triggerClass?: HTMLAttributes['class']
    triggerVariant?: ButtonVariants['variant']
    triggerSize?: ButtonVariants['size']
    triggerIcon?: string | false
    contentClass?: HTMLAttributes['class']
    popoverAlign?: PopoverContentProps['align']
    popoverAlignOffset?: PopoverContentProps['alignOffset']
    popoverSide?: PopoverContentProps['side']
    popoverSideOffset?: PopoverContentProps['sideOffset']
    popoverCollisionPadding?: PopoverContentProps['collisionPadding']
    class?: HTMLAttributes['class']
  }>(),
  {
    locale: 'zh-CN',
    weekStartsOn: 1,
    weekdayFormat: 'short',
    fixedWeeks: true,
    numberOfMonths: 2,
    pagedNavigation: false,
    preventDeselect: true,
    initialFocus: false,
    disableDaysOutsideCurrentView: false,
    calendarLabel: '日期范围选择',
    allowNonContiguousRanges: false,
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择日期范围',
    closeOnSelect: true,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: CalendarDateRangeValue]
  'change': [value: CalendarDateRangeValue]
  'complete': [value: CalendarDateRangeCompleteValue]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarDateRangeValue
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const RangeCalendarPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const emptyRange = computed<CalendarDateRangeValue>(() => ({ start: undefined, end: undefined }))
const defaultPlaceholder = computed(() => props.defaultPlaceholder ?? props.modelValue?.start ?? props.defaultValue?.start ?? today(getLocalTimeZone()))
const defaultValue = computed(() => props.defaultValue ?? emptyRange.value)
const pickerOpen = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>
const effectivePickerOpen = computed(() => !props.disabled && pickerOpen.value)
const pickerValue = shallowRef<CalendarDateRangeValue>(props.modelValue ?? props.defaultValue ?? emptyRange.value)
const isPickerEmpty = computed(() => !pickerValue.value.start && !pickerValue.value.end)
const pickerLabel = computed(() => props.formatValue?.(pickerValue.value) ?? getDefaultPickerLabel(pickerValue.value))
const triggerButtonClass = computed(() => cn(
  'w-[280px] max-w-full justify-start overflow-hidden text-left font-normal',
  isPickerEmpty.value && 'text-muted-foreground',
  props.triggerClass,
))

watch(() => props.modelValue, (value) => {
  pickerValue.value = value ?? props.defaultValue ?? emptyRange.value
})

function getDefaultPickerLabel(value: CalendarDateRangeValue) {
  const { start, end } = value
  if (start && end) {
    return `${start.toString()} 至 ${end.toString()}`
  }
  if (start) {
    return `${start.toString()} 至 ...`
  }
  if (end) {
    return `... 至 ${end.toString()}`
  }
  return props.pickerPlaceholder
}

function closePicker() {
  if (props.picker && props.closeOnSelect) {
    pickerOpen.value = false
  }
}

function handlePickerOpenUpdate(value: boolean) {
  if (value && props.disabled) {
    return
  }

  pickerOpen.value = value
}

function handleModelValueUpdate(value: CalendarDateRangeValue) {
  pickerValue.value = value
  emit('update:modelValue', value)
  emit('change', value)
}

function handleValidModelValueUpdate(value: CalendarDateRangeValue) {
  if (!value.start || !value.end) {
    return
  }

  emit('complete', {
    start: value.start,
    end: value.end,
  })
  closePicker()
}

function handlePlaceholderUpdate(value: DateValue) {
  emit('update:placeholder', value)
}
</script>

<template>
  <RangeCalendarPanel.define>
    <RangeCalendar
      :model-value="props.modelValue"
      :default-value="defaultValue"
      :placeholder="props.placeholder"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :locale="props.locale"
      :dir="calendarDir"
      :week-starts-on="props.weekStartsOn"
      :weekday-format="props.weekdayFormat"
      :fixed-weeks="props.fixedWeeks"
      :number-of-months="props.numberOfMonths"
      :paged-navigation="props.pagedNavigation"
      :prevent-deselect="props.preventDeselect"
      :initial-focus="props.initialFocus"
      :is-date-disabled="props.isDateDisabled"
      :is-date-unavailable="props.isDateUnavailable"
      :disable-days-outside-current-view="props.disableDaysOutsideCurrentView"
      :calendar-label="props.calendarLabel"
      :allow-non-contiguous-ranges="props.allowNonContiguousRanges"
      :maximum-days="props.maximumDays"
      :fixed-date="props.fixedDate"
      :is-date-highlightable="props.isDateHighlightable"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:valid-model-value="handleValidModelValueUpdate"
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </RangeCalendar>
  </RangeCalendarPanel.define>

  <Popover
    v-if="props.picker"
    :open="effectivePickerOpen"
    :align="props.popoverAlign"
    :align-offset="props.popoverAlignOffset"
    :side="props.popoverSide"
    :side-offset="props.popoverSideOffset"
    :collision-padding="props.popoverCollisionPadding"
    :class="cn('p-0 w-auto min-w-auto border-0', props.contentClass)"
    @update:open="handlePickerOpenUpdate"
  >
    <slot
      name="trigger"
      :value="pickerValue"
      :label="pickerLabel"
      :open="effectivePickerOpen"
      :disabled="!!props.disabled"
      :readonly="!!props.readonly"
    >
      <Button
        :variant="props.triggerVariant"
        :size="props.triggerSize"
        :disabled="props.disabled"
        :class="triggerButtonClass"
      >
        <Icon v-if="props.triggerIcon" :name="props.triggerIcon" class="flex-none size-4" />
        <span class="flex-1 min-w-0 truncate">{{ pickerLabel }}</span>
      </Button>
    </slot>
    <template #panel>
      <RangeCalendarPanel.reuse />
    </template>
  </Popover>

  <RangeCalendarPanel.reuse v-else />
</template>
