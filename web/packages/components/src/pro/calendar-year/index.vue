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
import YearPicker from './year-picker/YearPicker.vue'

type YearMatcher = (year: DateValue) => boolean
type YearPage = (placeholder: DateValue) => DateValue
type CalendarYearValue = DateValue | DateValue[]

defineOptions({
  name: 'BuiltInCalendarYear',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarYearValue
    defaultValue?: CalendarYearValue
    placeholder?: DateValue
    defaultPlaceholder?: DateValue
    minValue?: DateValue
    maxValue?: DateValue
    multiple?: boolean
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
    yearsPerPage?: number
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarYearValue | undefined) => string
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
    preventDeselect: undefined,
    initialFocus: false,
    calendarLabel: '年份选择',
    yearsPerPage: 12,
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择年份',
    closeOnSelect: undefined,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: CalendarYearValue | undefined]
  'change': [value: CalendarYearValue | undefined]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarYearValue | undefined
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const YearPickerPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))

function toYearValue(value: DateValue | null | undefined) {
  return value?.set({ month: 1, day: 1 })
}

function toYearValues(value: CalendarYearValue | null | undefined, multiple = false) {
  if (!multiple) {
    return Array.isArray(value) ? toYearValue(value[0]) : toYearValue(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => toYearValue(item)!)
  }

  return value ? [toYearValue(value)!] : undefined
}

function getReferenceYear(value: CalendarYearValue | null | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}

const isMultiple = computed(() => props.multiple || Array.isArray(props.modelValue) || Array.isArray(props.defaultValue))
const effectivePreventDeselect = computed(() => props.preventDeselect ?? !isMultiple.value)
const normalizedModelValue = computed(() => toYearValues(props.modelValue, isMultiple.value))
const normalizedDefaultValue = computed(() => toYearValues(props.defaultValue, isMultiple.value))
const normalizedPlaceholder = computed(() => toYearValue(props.placeholder))
const defaultPlaceholder = computed(() => toYearValue(props.defaultPlaceholder ?? getReferenceYear(props.modelValue) ?? getReferenceYear(props.defaultValue) ?? today(getLocalTimeZone()))!)
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
const pickerValue = shallowRef<CalendarYearValue | undefined>(toEmitValue(props.modelValue ?? props.defaultValue))
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

function toEmitValue(value: DateValue | DateValue[] | undefined) {
  if (!isMultiple.value) {
    return Array.isArray(value) ? toYearValue(value[0]) : toYearValue(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => toYearValue(item)!)
  }

  return value ? [toYearValue(value)!] : []
}

function getDefaultPickerLabel(value: CalendarYearValue | undefined) {
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

function handleModelValueUpdate(value: DateValue | DateValue[] | undefined) {
  const normalizedValue = toEmitValue(value)

  pickerValue.value = normalizedValue
  emit('update:modelValue', normalizedValue)
  emit('change', normalizedValue)
  closePicker()
}

function handlePlaceholderUpdate(value: DateValue) {
  emit('update:placeholder', toYearValue(value)!)
}
</script>

<template>
  <YearPickerPanel.define>
    <YearPicker
      :model-value="normalizedModelValue"
      :default-value="normalizedDefaultValue"
      :placeholder="normalizedPlaceholder"
      :default-placeholder="defaultPlaceholder"
      :min-value="props.minValue"
      :max-value="props.maxValue"
      :multiple="isMultiple"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :locale="props.locale"
      :dir="calendarDir"
      :prevent-deselect="effectivePreventDeselect"
      :initial-focus="props.initialFocus"
      :is-year-disabled="isYearDisabled"
      :is-year-unavailable="isYearUnavailable"
      :calendar-label="props.calendarLabel"
      :next-page="props.nextPage"
      :prev-page="props.prevPage"
      :years-per-page="props.yearsPerPage"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </YearPicker>
  </YearPickerPanel.define>

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
      <YearPickerPanel.reuse />
    </template>
  </Popover>

  <YearPickerPanel.reuse v-else />
</template>
