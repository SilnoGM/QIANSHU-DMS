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
import MonthPicker from './month-picker/MonthPicker.vue'

type MonthMatcher = (month: DateValue) => boolean
type MonthPage = (placeholder: DateValue) => DateValue
type CalendarMonthValue = DateValue | DateValue[]

defineOptions({
  name: 'BuiltInCalendarMonth',
})

const props = withDefaults(
  defineProps<{
    modelValue?: CalendarMonthValue
    defaultValue?: CalendarMonthValue
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
    isMonthDisabled?: MonthMatcher
    isMonthUnavailable?: MonthMatcher
    calendarLabel?: string
    nextPage?: MonthPage
    prevPage?: MonthPage
    picker?: boolean
    open?: boolean
    defaultOpen?: boolean
    pickerPlaceholder?: string
    formatValue?: (value: CalendarMonthValue | undefined) => string
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
    calendarLabel: '月份选择',
    picker: false,
    defaultOpen: false,
    pickerPlaceholder: '选择月份',
    closeOnSelect: undefined,
    triggerVariant: 'outline',
    triggerSize: 'default',
    triggerIcon: 'i-lucide:calendar',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: CalendarMonthValue | undefined]
  'change': [value: CalendarMonthValue | undefined]
  'update:placeholder': [value: DateValue]
  'update:open': [value: boolean]
}>()

defineSlots<{
  heading?: (props: { date: DateValue }) => any
  trigger?: (props: {
    value: CalendarMonthValue | undefined
    label: string
    open: boolean
    disabled: boolean
    readonly: boolean
  }) => any
}>()

const MonthPickerPanel = createReusableTemplate()

const documentDir = useTextDirection({
  observe: true,
})

const calendarDir = computed<Direction>(() => props.dir ?? (documentDir.value === 'rtl' ? 'rtl' : 'ltr'))

function toMonthValue(value: DateValue | null | undefined) {
  return value?.set({ day: 1 })
}

function toMonthValues(value: CalendarMonthValue | null | undefined, multiple = false) {
  if (!multiple) {
    return Array.isArray(value) ? toMonthValue(value[0]) : toMonthValue(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => toMonthValue(item)!)
  }

  return value ? [toMonthValue(value)!] : undefined
}

function getReferenceMonth(value: CalendarMonthValue | null | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}

const isMultiple = computed(() => props.multiple || Array.isArray(props.modelValue) || Array.isArray(props.defaultValue))
const effectivePreventDeselect = computed(() => props.preventDeselect ?? !isMultiple.value)
const normalizedModelValue = computed(() => toMonthValues(props.modelValue, isMultiple.value))
const normalizedDefaultValue = computed(() => toMonthValues(props.defaultValue, isMultiple.value))
const normalizedPlaceholder = computed(() => toMonthValue(props.placeholder))
const defaultPlaceholder = computed(() => toMonthValue(props.defaultPlaceholder ?? getReferenceMonth(props.modelValue) ?? getReferenceMonth(props.defaultValue) ?? today(getLocalTimeZone()))!)
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
const pickerValue = shallowRef<CalendarMonthValue | undefined>(toEmitValue(props.modelValue ?? props.defaultValue))
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
    return Array.isArray(value) ? toMonthValue(value[0]) : toMonthValue(value)
  }

  if (Array.isArray(value)) {
    return value.map(item => toMonthValue(item)!)
  }

  return value ? [toMonthValue(value)!] : []
}

function getDefaultPickerLabel(value: CalendarMonthValue | undefined) {
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
  emit('update:placeholder', toMonthValue(value)!)
}
</script>

<template>
  <MonthPickerPanel.define>
    <MonthPicker
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
      :is-month-disabled="isMonthDisabled"
      :is-month-unavailable="isMonthUnavailable"
      :calendar-label="props.calendarLabel"
      :next-page="props.nextPage"
      :prev-page="props.prevPage"
      :class="cn('border rounded-lg w-fit', props.class)"
      @update:model-value="handleModelValueUpdate"
      @update:placeholder="handlePlaceholderUpdate"
    >
      <template v-if="$slots.heading" #heading="slotProps">
        <slot name="heading" v-bind="slotProps" />
      </template>
    </MonthPicker>
  </MonthPickerPanel.define>

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
      <MonthPickerPanel.reuse />
    </template>
  </Popover>

  <MonthPickerPanel.reuse v-else />
</template>
