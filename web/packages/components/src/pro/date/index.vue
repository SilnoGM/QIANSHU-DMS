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
import CalendarDate from '../calendar-date/index.vue'
import CalendarMonth from '../calendar-month/index.vue'
import CalendarYear from '../calendar-year/index.vue'

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6
type WeekdayFormat = 'narrow' | 'short' | 'long'
type DateMatcher = (date: DateValue) => boolean
type MonthMatcher = (month: DateValue) => boolean
type YearMatcher = (year: DateValue) => boolean
type CalendarPage = (placeholder: DateValue) => DateValue
type DateView = 'date' | 'month' | 'year'

defineOptions({
  name: 'BuiltInDate',
})

const props = withDefaults(
  defineProps<{
    modelValue?: DateValue | DateValue[]
    defaultValue?: DateValue | DateValue[]
    placeholder?: DateValue
    defaultPlaceholder?: DateValue
    view?: DateView
    defaultView?: DateView
    minValue?: DateValue
    maxValue?: DateValue
    multiple?: boolean
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
    isMonthDisabled?: MonthMatcher
    isMonthUnavailable?: MonthMatcher
    isYearDisabled?: YearMatcher
    isYearUnavailable?: YearMatcher
    disableDaysOutsideCurrentView?: boolean
    calendarLabel?: string
    monthCalendarLabel?: string
    yearCalendarLabel?: string
    monthNextPage?: CalendarPage
    monthPrevPage?: CalendarPage
    yearNextPage?: CalendarPage
    yearPrevPage?: CalendarPage
    yearsPerPage?: number
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: DateValue | DateValue[] | undefined) => string
    formatMonthLabel?: (date: DateValue) => string
    formatYearLabel?: (date: DateValue) => string
    formatYearRangeLabel?: (start: DateValue, end: DateValue) => string
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
    defaultView: 'date',
    weekStartsOn: 1,
    weekdayFormat: 'short',
    fixedWeeks: true,
    numberOfMonths: 1,
    pagedNavigation: false,
    preventDeselect: undefined,
    initialFocus: false,
    disableDaysOutsideCurrentView: false,
    calendarLabel: '日期选择',
    monthCalendarLabel: '月份选择',
    yearCalendarLabel: '年份选择',
    yearsPerPage: 12,
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择日期',
    closeOnSelect: undefined,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: DateValue | DateValue[] | undefined]
  'change': [value: DateValue | DateValue[] | undefined]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
  'update:view': [value: DateView]
}>()

defineSlots<{
  trigger?: (props: {
    value: DateValue | DateValue[] | undefined
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const DatePanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const isMultiple = computed(() => props.multiple || Array.isArray(props.modelValue) || Array.isArray(props.defaultValue))
const effectivePreventDeselect = computed(() => props.preventDeselect ?? !isMultiple.value)
const normalizedModelValue = computed(() => toCalendarValue(props.modelValue))
const normalizedDefaultValue = computed(() => toCalendarValue(props.defaultValue))
const defaultPlaceholder = computed(() => props.defaultPlaceholder ?? getReferenceDate(props.modelValue) ?? getReferenceDate(props.defaultValue) ?? today(getLocalTimeZone()))
const placeholderValue = useVModel(props, 'placeholder', emit, {
  passive: true,
  defaultValue: defaultPlaceholder.value,
}) as Ref<DateValue>
const currentView = useVModel(props, 'view', emit, {
  passive: true,
  defaultValue: props.defaultView,
}) as Ref<DateView>
const pickerOpen = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>
const effectivePickerOpen = computed(() => !props.disabled && pickerOpen.value)
const pickerValue = shallowRef<DateValue | DateValue[] | undefined>(toEmitValue(props.modelValue ?? props.defaultValue))
const effectiveCloseOnSelect = computed(() => props.closeOnSelect ?? !isMultiple.value)
const isPickerEmpty = computed(() => {
  const value = pickerValue.value
  return Array.isArray(value) ? value.length === 0 : !value
})
const pickerLabel = computed(() => props.formatValue?.(pickerValue.value) ?? getDefaultPickerLabel(pickerValue.value))
const triggerButtonClass = computed(() => cn(
  'w-[200px] max-w-full justify-start overflow-hidden text-left font-normal',
  isPickerEmpty.value && 'text-muted-foreground',
  props.triggerClass,
))
const navigationMonthValue = computed(() => toMonthValue(placeholderValue.value))
const navigationYearValue = computed(() => toYearValue(placeholderValue.value))

watch(() => props.modelValue, (value) => {
  pickerValue.value = toEmitValue(value)
})

watch(effectivePickerOpen, (open) => {
  if (open && props.picker && props.view === undefined) {
    currentView.value = props.defaultView
  }
})

function getReferenceDate(value: DateValue | DateValue[] | null | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}

function toCalendarValue(value: DateValue | DateValue[] | null | undefined) {
  if (!value) {
    return undefined
  }

  if (!isMultiple.value) {
    return Array.isArray(value) ? value[0] : value
  }

  if (Array.isArray(value)) {
    return value
  }

  return value ? [value] : undefined
}

function toEmitValue(value: DateValue | DateValue[] | undefined) {
  if (!isMultiple.value) {
    return Array.isArray(value) ? value[0] : value
  }

  if (Array.isArray(value)) {
    return value
  }

  return value ? [value] : []
}

function toMonthValue(value: DateValue | null | undefined) {
  return value?.set({ day: 1 })
}

function toYearValue(value: DateValue | null | undefined) {
  return value?.set({ month: 1, day: 1 })
}

function getDefaultPickerLabel(value: DateValue | DateValue[] | undefined) {
  if (!value || (Array.isArray(value) && value.length === 0)) {
    return props.pickerPlaceholder
  }

  if (Array.isArray(value)) {
    if (value.length === 1) {
      return value[0]?.toString() ?? props.pickerPlaceholder
    }

    return `已选择 ${value.length} 项`
  }

  return value.toString()
}

function formatDatePart(date: DateValue, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(props.locale, options).format(date.toDate(getLocalTimeZone()))
}

function getMonthLabel(date: DateValue) {
  return props.formatMonthLabel?.(date) ?? formatDatePart(date, { month: 'long' })
}

function getYearLabel(date: DateValue) {
  return props.formatYearLabel?.(date) ?? formatDatePart(date, { year: 'numeric' })
}

function getYearRangeLabel(date: DateValue) {
  const start = toYearValue(date)!
  const end = start.add({ years: props.yearsPerPage - 1 })

  return props.formatYearRangeLabel?.(start, end) ?? `${start.year} - ${end.year}`
}

function closePicker() {
  if (props.picker && effectiveCloseOnSelect.value) {
    pickerOpen.value = false
  }
}

function handlePickerOpenUpdate(value: boolean) {
  if (value && props.disabled) {
    return
  }

  pickerOpen.value = value
}

function switchView(view: DateView) {
  if (props.disabled) {
    return
  }

  currentView.value = view
}

function updatePlaceholder(value: DateValue) {
  placeholderValue.value = value
}

function handleModelValueUpdate(value: DateValue | DateValue[] | undefined) {
  const emitValue = toEmitValue(value)

  pickerValue.value = emitValue
  emit('update:modelValue', emitValue)
  emit('change', emitValue)
  closePicker()
}

function handleMonthValueUpdate(value: DateValue | DateValue[] | undefined) {
  const month = Array.isArray(value) ? value[0] : value

  if (!month) {
    return
  }

  updatePlaceholder(toMonthValue(month)!)
  switchView('date')
}

function handleYearValueUpdate(value: DateValue | DateValue[] | undefined) {
  const year = Array.isArray(value) ? value[0] : value

  if (!year) {
    return
  }

  updatePlaceholder(toYearValue(year)!)
  switchView('month')
}
</script>

<template>
  <DatePanel.define>
    <CalendarDate
      v-if="currentView === 'date'"
      :model-value="normalizedModelValue"
      :default-value="normalizedDefaultValue"
      :placeholder="placeholderValue"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :multiple="isMultiple"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :locale="props.locale"
      :dir="calendarDir"
      :week-starts-on="props.weekStartsOn"
      :weekday-format="props.weekdayFormat"
      :fixed-weeks="props.fixedWeeks"
      :number-of-months="props.numberOfMonths"
      :paged-navigation="props.pagedNavigation"
      :prevent-deselect="effectivePreventDeselect"
      :initial-focus="props.initialFocus"
      :is-date-disabled="props.isDateDisabled"
      :is-date-unavailable="props.isDateUnavailable"
      :disable-days-outside-current-view="props.disableDaysOutsideCurrentView"
      :calendar-label="props.calendarLabel"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:placeholder="updatePlaceholder"
    >
      <template #heading="{ date }">
        <div class="flex gap-1 min-w-0 items-center">
          <Button
            variant="ghost"
            size="sm"
            :disabled="props.disabled"
            class="text-sm px-2 h-7"
            @click="switchView('month')"
          >
            {{ getMonthLabel(date) }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="props.disabled"
            class="text-sm px-2 h-7"
            @click="switchView('year')"
          >
            {{ getYearLabel(date) }}
          </Button>
        </div>
      </template>
    </CalendarDate>

    <CalendarMonth
      v-else-if="currentView === 'month'"
      :model-value="navigationMonthValue"
      :placeholder="placeholderValue"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :disabled="props.disabled"
      :locale="props.locale"
      :dir="calendarDir"
      :prevent-deselect="true"
      :initial-focus="props.initialFocus"
      :is-month-disabled="props.isMonthDisabled"
      :is-month-unavailable="props.isMonthUnavailable"
      :calendar-label="props.monthCalendarLabel"
      :next-page="props.monthNextPage"
      :prev-page="props.monthPrevPage"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleMonthValueUpdate"
      @update:placeholder="updatePlaceholder"
    >
      <template #heading="{ date }">
        <Button
          variant="ghost"
          size="sm"
          :disabled="props.disabled"
          class="text-sm px-2 h-7"
          @click="switchView('year')"
        >
          {{ getYearLabel(date) }}
        </Button>
      </template>
    </CalendarMonth>

    <CalendarYear
      v-else
      :model-value="navigationYearValue"
      :placeholder="placeholderValue"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :disabled="props.disabled"
      :locale="props.locale"
      :dir="calendarDir"
      :prevent-deselect="true"
      :initial-focus="props.initialFocus"
      :is-year-disabled="props.isYearDisabled"
      :is-year-unavailable="props.isYearUnavailable"
      :calendar-label="props.yearCalendarLabel"
      :next-page="props.yearNextPage"
      :prev-page="props.yearPrevPage"
      :years-per-page="props.yearsPerPage"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleYearValueUpdate"
      @update:placeholder="updatePlaceholder"
    >
      <template #heading="{ date }">
        <div class="text-sm font-medium">
          {{ getYearRangeLabel(date) }}
        </div>
      </template>
    </CalendarYear>
  </DatePanel.define>

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
      <DatePanel.reuse />
    </template>
  </Popover>

  <DatePanel.reuse v-else />
</template>
