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
import MonthRangePicker from './month-range-picker/MonthRangePicker.vue'

export interface CalendarMonthRangeValue {
  start: DateValue | undefined
  end: DateValue | undefined
}

export interface CalendarMonthRangeCompleteValue {
  start: DateValue
  end: DateValue
}

type MonthMatcher = (month: DateValue) => boolean
type MonthPage = (placeholder: DateValue) => DateValue

defineOptions({
  name: 'BuiltInCalendarMonthRange',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarMonthRangeValue
    defaultValue?: CalendarMonthRangeValue
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
    isMonthDisabled?: MonthMatcher
    isMonthUnavailable?: MonthMatcher
    calendarLabel?: string
    nextPage?: MonthPage
    prevPage?: MonthPage
    allowNonContiguousRanges?: boolean
    maximumMonths?: number
    fixedDate?: 'start' | 'end'
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarMonthRangeValue) => string
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
    calendarLabel: '月份范围选择',
    allowNonContiguousRanges: false,
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择月份范围',
    closeOnSelect: true,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: CalendarMonthRangeValue]
  'change': [value: CalendarMonthRangeValue]
  'complete': [value: CalendarMonthRangeCompleteValue]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarMonthRangeValue
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const MonthRangePickerPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))
const emptyRange = computed<CalendarMonthRangeValue>(() => ({ start: undefined, end: undefined }))

function toMonthValue(value: DateValue | null | undefined) {
  return value?.set({ day: 1 })
}

function toMonthRangeValue(value: CalendarMonthRangeValue | null | undefined): CalendarMonthRangeValue {
  return {
    start: toMonthValue(value?.start),
    end: toMonthValue(value?.end),
  }
}

const normalizedModelValue = computed(() => props.modelValue ? toMonthRangeValue(props.modelValue) : undefined)
const defaultValue = computed(() => props.defaultValue ? toMonthRangeValue(props.defaultValue) : emptyRange.value)
const normalizedPlaceholder = computed(() => toMonthValue(props.placeholder))
const defaultPlaceholder = computed(() => toMonthValue(props.defaultPlaceholder ?? props.modelValue?.start ?? props.defaultValue?.start ?? today(getLocalTimeZone()))!)
const isMonthDisabled = computed(() => {
  if (!props.isMonthDisabled) {
    return undefined
  }
  return (month: DateValue) => props.isMonthDisabled?.(toMonthValue(month)!) ?? false
})
const isMonthUnavailable = computed(() => {
  if (!props.isMonthUnavailable) {
    return undefined
  }
  return (month: DateValue) => props.isMonthUnavailable?.(toMonthValue(month)!) ?? false
})
const pickerOpen = useVModel(props, 'open', emit, {
  passive: true,
  defaultValue: props.defaultOpen,
}) as Ref<boolean>
const effectivePickerOpen = computed(() => !props.disabled && pickerOpen.value)
const pickerValue = shallowRef<CalendarMonthRangeValue>(props.modelValue ? toMonthRangeValue(props.modelValue) : props.defaultValue ? toMonthRangeValue(props.defaultValue) : emptyRange.value)
const isPickerEmpty = computed(() => !pickerValue.value.start && !pickerValue.value.end)
const pickerLabel = computed(() => props.formatValue?.(pickerValue.value) ?? getDefaultPickerLabel(pickerValue.value))
const triggerButtonClass = computed(() => cn(
  'w-[280px] max-w-full justify-start overflow-hidden text-left font-normal',
  isPickerEmpty.value && 'text-muted-foreground',
  props.triggerClass,
))

watch(() => props.modelValue, (value) => {
  pickerValue.value = value ? toMonthRangeValue(value) : props.defaultValue ? toMonthRangeValue(props.defaultValue) : emptyRange.value
})

function getDefaultPickerLabel(value: CalendarMonthRangeValue) {
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

function handleModelValueUpdate(value: CalendarMonthRangeValue) {
  const normalizedValue = toMonthRangeValue(value)

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
  emit('update:placeholder', toMonthValue(value)!)
}
</script>

<template>
  <MonthRangePickerPanel.define>
    <MonthRangePicker
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
      :is-month-disabled="isMonthDisabled"
      :is-month-unavailable="isMonthUnavailable"
      :calendar-label="props.calendarLabel"
      :next-page="props.nextPage"
      :prev-page="props.prevPage"
      :allow-non-contiguous-ranges="props.allowNonContiguousRanges"
      :maximum-months="props.maximumMonths"
      :fixed-date="props.fixedDate"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </MonthRangePicker>
  </MonthRangePickerPanel.define>

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
      <MonthRangePickerPanel.reuse />
    </template>
  </Popover>

  <MonthRangePickerPanel.reuse v-else />
</template>
