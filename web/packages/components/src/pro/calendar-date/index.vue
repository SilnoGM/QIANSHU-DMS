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
import Calendar from './calendar/Calendar.vue'

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6
type WeekdayFormat = 'narrow' | 'short' | 'long'
type DateMatcher = (date: DateValue) => boolean
type CalendarDateValue = DateValue | DateValue[]

defineOptions({
  name: 'BuiltInCalendarDate',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarDateValue
    defaultValue?: CalendarDateValue
    placeholder?: DateValue
    defaultPlaceholder?: DateValue
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
    disableDaysOutsideCurrentView?: boolean
    calendarLabel?: string
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarDateValue | undefined) => string
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
    numberOfMonths: 1,
    pagedNavigation: false,
    preventDeselect: undefined,
    initialFocus: false,
    disableDaysOutsideCurrentView: false,
    calendarLabel: '日期选择',
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
  'update:modelValue': [value: CalendarDateValue | undefined]
  'change': [value: CalendarDateValue | undefined]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarDateValue | undefined
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const CalendarPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const isMultiple = computed(() => props.multiple || Array.isArray(props.modelValue) || Array.isArray(props.defaultValue))
const effectivePreventDeselect = computed(() => props.preventDeselect ?? !isMultiple.value)
const normalizedModelValue = computed(() => toCalendarValue(props.modelValue))
const normalizedDefaultValue = computed(() => toCalendarValue(props.defaultValue))
const defaultPlaceholder = computed(() => props.defaultPlaceholder ?? getReferenceDate(props.modelValue) ?? getReferenceDate(props.defaultValue) ?? today(getLocalTimeZone()))
const pickerOpen = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>
const effectivePickerOpen = computed(() => !props.disabled && pickerOpen.value)
const pickerValue = shallowRef<CalendarDateValue | undefined>(toEmitValue(props.modelValue ?? props.defaultValue))
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

watch(() => props.modelValue, (value) => {
  pickerValue.value = toEmitValue(value)
})

function getReferenceDate(value: CalendarDateValue | null | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}

function toCalendarValue(value: CalendarDateValue | null | undefined) {
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

function toEmitValue(value: CalendarDateValue | undefined) {
  if (!isMultiple.value) {
    return Array.isArray(value) ? value[0] : value
  }

  if (Array.isArray(value)) {
    return value
  }

  return value ? [value] : []
}

function getDefaultPickerLabel(value: CalendarDateValue | undefined) {
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

function handleModelValueUpdate(value: CalendarDateValue | undefined) {
  const emitValue = toEmitValue(value)

  pickerValue.value = emitValue
  emit('update:modelValue', emitValue)
  emit('change', emitValue)
  closePicker()
}

function handlePlaceholderUpdate(value: DateValue) {
  emit('update:placeholder', value)
}
</script>

<template>
  <CalendarPanel.define>
    <Calendar
      :model-value="normalizedModelValue"
      :default-value="normalizedDefaultValue"
      :placeholder="props.placeholder"
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
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </Calendar>
  </CalendarPanel.define>

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
      <CalendarPanel.reuse />
    </template>
  </Popover>

  <CalendarPanel.reuse v-else />
</template>
