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
import YearRangePicker from './year-range-picker/YearRangePicker.vue'

export interface CalendarYearRangeValue {
  start: DateValue | undefined
  end: DateValue | undefined
}

export interface CalendarYearRangeCompleteValue {
  start: DateValue
  end: DateValue
}

type YearMatcher = (year: DateValue) => boolean
type YearPage = (placeholder: DateValue) => DateValue

defineOptions({
  name: 'BuiltInCalendarYearRange',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarYearRangeValue
    defaultValue?: CalendarYearRangeValue
    placeholder?: DateValue
    defaultPlaceholder?: DateValue
    minValue?: DateValue
    maxValue?: DateValue
    disabled?: boolean
    readonly?: boolean
    locale?: string
    dir?: Direction
    preventDeselect?: boolean
    initialFocus?: boolean
    isYearDisabled?: YearMatcher
    isYearUnavailable?: YearMatcher
    calendarLabel?: string
    nextPage?: YearPage
    prevPage?: YearPage
    allowNonContiguousRanges?: boolean
    maximumYears?: number
    fixedDate?: 'start' | 'end'
    yearsPerPage?: number
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarYearRangeValue) => string
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
    preventDeselect: true,
    initialFocus: false,
    calendarLabel: '年份范围选择',
    allowNonContiguousRanges: false,
    yearsPerPage: 12,
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择年份范围',
    closeOnSelect: true,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: CalendarYearRangeValue]
  'change': [value: CalendarYearRangeValue]
  'complete': [value: CalendarYearRangeCompleteValue]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarYearRangeValue
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const YearRangePickerPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const emptyRange = computed<CalendarYearRangeValue>(() => ({ start: undefined, end: undefined }))

function toYearValue(value: DateValue | null | undefined) {
  return value?.set({ month: 1, day: 1 })
}

function toYearRangeValue(value: CalendarYearRangeValue | null | undefined): CalendarYearRangeValue {
  return {
    start: toYearValue(value?.start),
    end: toYearValue(value?.end),
  }
}

const normalizedModelValue = computed(() => props.modelValue ? toYearRangeValue(props.modelValue) : undefined)
const defaultValue = computed(() => props.defaultValue ? toYearRangeValue(props.defaultValue) : emptyRange.value)
const normalizedPlaceholder = computed(() => toYearValue(props.placeholder))
const defaultPlaceholder = computed(() => toYearValue(props.defaultPlaceholder ?? props.modelValue?.start ?? props.defaultValue?.start ?? today(getLocalTimeZone()))!)
const isYearDisabled = computed(() => {
  if (!props.isYearDisabled) {
    return undefined
  }
  return (year: DateValue) => props.isYearDisabled?.(toYearValue(year)!) ?? false
})
const isYearUnavailable = computed(() => {
  if (!props.isYearUnavailable) {
    return undefined
  }
  return (year: DateValue) => props.isYearUnavailable?.(toYearValue(year)!) ?? false
})
const pickerOpen = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>
const effectivePickerOpen = computed(() => !props.disabled && pickerOpen.value)
const pickerValue = shallowRef<CalendarYearRangeValue>(props.modelValue ? toYearRangeValue(props.modelValue) : props.defaultValue ? toYearRangeValue(props.defaultValue) : emptyRange.value)
const isPickerEmpty = computed(() => !pickerValue.value.start && !pickerValue.value.end)
const pickerLabel = computed(() => props.formatValue?.(pickerValue.value) ?? getDefaultPickerLabel(pickerValue.value))
const triggerButtonClass = computed(() => cn(
  'w-[280px] max-w-full justify-start overflow-hidden text-left font-normal',
  isPickerEmpty.value && 'text-muted-foreground',
  props.triggerClass,
))

watch(() => props.modelValue, (value) => {
  pickerValue.value = value ? toYearRangeValue(value) : props.defaultValue ? toYearRangeValue(props.defaultValue) : emptyRange.value
})

function getDefaultPickerLabel(value: CalendarYearRangeValue) {
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

function handleModelValueUpdate(value: CalendarYearRangeValue) {
  const normalizedValue = toYearRangeValue(value)

  pickerValue.value = normalizedValue
  emit('update:modelValue', normalizedValue)
  emit('change', normalizedValue)

  if (!normalizedValue.start || !normalizedValue.end) {
    return
  }

  emit('complete', {
    start: normalizedValue.start,
    end: normalizedValue.end,
  })
  closePicker()
}

function handlePlaceholderUpdate(value: DateValue) {
  emit('update:placeholder', toYearValue(value)!)
}
</script>

<template>
  <YearRangePickerPanel.define>
    <YearRangePicker
      :model-value="normalizedModelValue"
      :default-value="defaultValue"
      :placeholder="normalizedPlaceholder"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :locale="props.locale"
      :dir="calendarDir"
      :prevent-deselect="props.preventDeselect"
      :initial-focus="props.initialFocus"
      :is-year-disabled="isYearDisabled"
      :is-year-unavailable="isYearUnavailable"
      :calendar-label="props.calendarLabel"
      :next-page="props.nextPage"
      :prev-page="props.prevPage"
      :allow-non-contiguous-ranges="props.allowNonContiguousRanges"
      :maximum-years="props.maximumYears"
      :fixed-date="props.fixedDate"
      :years-per-page="props.yearsPerPage"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </YearRangePicker>
  </YearRangePickerPanel.define>

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
      <YearRangePickerPanel.reuse />
    </template>
  </Popover>

  <YearRangePickerPanel.reuse v-else />
</template>
