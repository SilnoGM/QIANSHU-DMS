<script setup lang="ts">
import type { QsTimeParts } from './types'
import { useId } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
  formatDraftTime,
  hourWithinTimeBounds,
  minuteRangeForHour,
  parseDraftTime,
  secondRangeForMinute,
} from './logic'

type TimeColumn = 'hour' | 'minute' | 'second'

defineOptions({ name: 'QsTimeWheelPanel' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  maxTime?: QsTimeParts
  minTime?: QsTimeParts
  modelValue: string
  precision: 'minute' | 'second'
}>(), {
  disabled: false,
  maxTime: undefined,
  minTime: undefined,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': []
  'now': []
  'update:modelValue': [value: string]
}>()

const ITEM_HEIGHT = 32
const SCROLL_SETTLE_MS = 90

const id = useId()
const hourColumn = useTemplateRef<HTMLElement>('hourColumn')
const minuteColumn = useTemplateRef<HTMLElement>('minuteColumn')
const secondColumn = useTemplateRef<HTMLElement>('secondColumn')

const selectedHour = ref(0)
const selectedMinute = ref(0)
const selectedSecond = ref(0)
let settleTimer: ReturnType<typeof setTimeout> | undefined

const hours = Array.from({ length: 24 }, (_, index) => index)
const minutes = Array.from({ length: 60 }, (_, index) => index)
const seconds = Array.from({ length: 60 }, (_, index) => index)
const showSeconds = computed(() => props.precision === 'second')

const timeLabel = computed(() => formatDraftTime({
  hour: selectedHour.value,
  minute: selectedMinute.value,
  second: selectedSecond.value,
  millisecond: 0,
}, props.precision))

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function columnRef(column: TimeColumn): HTMLElement | null {
  if (column === 'hour') {
    return hourColumn.value
  }
  if (column === 'minute') {
    return minuteColumn.value
  }
  return secondColumn.value
}

function columnLength(column: TimeColumn): number {
  if (column === 'hour') {
    return hours.length
  }
  if (column === 'minute') {
    return minutes.length
  }
  return seconds.length
}

function selectedIndex(column: TimeColumn): number {
  if (column === 'hour') {
    return selectedHour.value
  }
  if (column === 'minute') {
    return selectedMinute.value
  }
  return selectedSecond.value
}

function optionId(column: TimeColumn, value: number): string {
  return `${id}-${column}-${value}`
}

function isHourDisabled(hour: number): boolean {
  return !hourWithinTimeBounds(hour, props.minTime, props.maxTime)
}

function isMinuteDisabled(hour: number, minute: number): boolean {
  const range = minuteRangeForHour(hour, props.minTime, props.maxTime)
  return minute < range.min || minute > range.max
}

function isSecondDisabled(hour: number, minute: number, second: number): boolean {
  const range = secondRangeForMinute(hour, minute, props.minTime, props.maxTime)
  return second < range.min || second > range.max
}

function isDisabled(column: TimeColumn, value: number): boolean {
  if (column === 'hour') {
    return isHourDisabled(value)
  }
  if (column === 'minute') {
    return isMinuteDisabled(selectedHour.value, value)
  }
  return isSecondDisabled(selectedHour.value, selectedMinute.value, value)
}

function nearestEnabledIndex(column: TimeColumn, index: number): number {
  if (!isDisabled(column, index)) {
    return index
  }
  for (let offset = 1; offset < columnLength(column); offset += 1) {
    const lower = index - offset
    if (lower >= 0 && !isDisabled(column, lower)) {
      return lower
    }
    const upper = index + offset
    if (upper < columnLength(column) && !isDisabled(column, upper)) {
      return upper
    }
  }
  return index
}

function nextEnabledIndex(
  column: TimeColumn,
  from: number,
  direction: 1 | -1,
): number {
  for (
    let index = from;
    index >= 0 && index < columnLength(column);
    index += direction
  ) {
    if (!isDisabled(column, index)) {
      return index
    }
  }
  return from
}

function scrollToIndex(column: TimeColumn, index: number): void {
  const element = columnRef(column)
  if (!element) {
    return
  }
  element.scrollTo({ top: index * ITEM_HEIGHT })
}

function scrollAll(): void {
  nextTick(() => {
    scrollToIndex('hour', selectedHour.value)
    scrollToIndex('minute', selectedMinute.value)
    if (showSeconds.value) {
      scrollToIndex('second', selectedSecond.value)
    }
  })
}

function emitTime(): void {
  emit('update:modelValue', formatDraftTime({
    hour: selectedHour.value,
    minute: selectedMinute.value,
    second: selectedSecond.value,
    millisecond: 0,
  }, props.precision))
}

function applyTime(value: string): void {
  const parsed = parseDraftTime(value, props.precision)
  if (!parsed) {
    return
  }
  selectedHour.value = parsed.hour
  selectedMinute.value = parsed.minute
  selectedSecond.value = parsed.second
  scrollAll()
}

function selectHour(hour: number): void {
  if (props.disabled || isHourDisabled(hour)) {
    return
  }
  selectedHour.value = hour
  const minuteRange = minuteRangeForHour(hour, props.minTime, props.maxTime)
  const minute = Math.min(Math.max(selectedMinute.value, minuteRange.min), minuteRange.max)
  selectedMinute.value = minute
  const secondRange = secondRangeForMinute(hour, minute, props.minTime, props.maxTime)
  const second = Math.min(Math.max(selectedSecond.value, secondRange.min), secondRange.max)
  selectedSecond.value = second
  scrollToIndex('hour', hour)
  scrollToIndex('minute', minute)
  if (showSeconds.value) {
    scrollToIndex('second', second)
  }
  emitTime()
}

function selectMinute(minute: number): void {
  if (props.disabled || isMinuteDisabled(selectedHour.value, minute)) {
    return
  }
  selectedMinute.value = minute
  const secondRange = secondRangeForMinute(
    selectedHour.value,
    minute,
    props.minTime,
    props.maxTime,
  )
  const second = Math.min(Math.max(selectedSecond.value, secondRange.min), secondRange.max)
  selectedSecond.value = second
  scrollToIndex('minute', minute)
  if (showSeconds.value) {
    scrollToIndex('second', second)
  }
  emitTime()
}

function selectSecond(second: number): void {
  if (props.disabled || isSecondDisabled(selectedHour.value, selectedMinute.value, second)) {
    return
  }
  selectedSecond.value = second
  scrollToIndex('second', second)
  emitTime()
}

function selectIndex(column: TimeColumn, index: number): void {
  if (column === 'hour') {
    selectHour(index)
  }
  else if (column === 'minute') {
    selectMinute(index)
  }
  else {
    selectSecond(index)
  }
}

function handleScroll(column: TimeColumn): void {
  if (props.disabled) {
    return
  }
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    const element = columnRef(column)
    if (!element) {
      return
    }
    const rawIndex = Math.round(element.scrollTop / ITEM_HEIGHT)
    const index = Math.min(Math.max(rawIndex, 0), columnLength(column) - 1)
    selectIndex(column, nearestEnabledIndex(column, index))
  }, SCROLL_SETTLE_MS)
}

function handleKeydown(column: TimeColumn, event: KeyboardEvent): void {
  if (props.disabled) {
    return
  }
  const current = selectedIndex(column)
  const length = columnLength(column)
  let next: number | null = null
  if (event.key === 'ArrowUp') {
    next = current - 1
  }
  else if (event.key === 'ArrowDown') {
    next = current + 1
  }
  else if (event.key === 'PageUp') {
    next = current - 5
  }
  else if (event.key === 'PageDown') {
    next = current + 5
  }
  else if (event.key === 'Home') {
    next = 0
  }
  else if (event.key === 'End') {
    next = length - 1
  }
  if (next === null) {
    return
  }
  event.preventDefault()
  const clamped = Math.min(Math.max(next, 0), length - 1)
  const enabled = nextEnabledIndex(column, clamped, clamped >= current ? 1 : -1)
  selectIndex(column, enabled)
}

watch(() => props.modelValue, (value) => {
  if (value !== timeLabel.value) {
    applyTime(value)
  }
})

onMounted(() => {
  applyTime(props.modelValue)
})

onBeforeUnmount(() => {
  clearTimeout(settleTimer)
})
</script>

<template>
  <section class="p-3 w-60 space-y-3" aria-label="选择时间">
    <header class="flex items-center justify-between">
      <span class="qs-type-compact-label">选择时间</span>
      <span class="qs-type-data text-primary" aria-live="polite">{{ timeLabel }}</span>
    </header>

    <div class="relative">
      <div
        aria-hidden="true"
        class="border-y border-border bg-muted/40 h-8 pointer-events-none inset-x-0 top-16 absolute"
      />
      <div class="flex gap-2 relative z-10">
        <div
          ref="hourColumn"
          role="listbox"
          aria-label="小时"
          :aria-activedescendant="optionId('hour', selectedHour)"
          :aria-disabled="props.disabled || undefined"
          tabindex="0"
          class="overscroll-contain h-40 w-14 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
          @scroll.passive="handleScroll('hour')"
          @keydown="event => handleKeydown('hour', event)"
        >
          <div class="h-16" aria-hidden="true" />
          <div
            v-for="hour in hours"
            :id="optionId('hour', hour)"
            :key="hour"
            role="option"
            :aria-selected="hour === selectedHour"
            :aria-disabled="isHourDisabled(hour) || undefined"
            class="text-sm flex h-8 items-center justify-center"
            :class="[
              hour === selectedHour ? 'text-primary font-semibold' : 'text-foreground',
              isHourDisabled(hour) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
            ]"
            @click="selectHour(hour)"
          >
            {{ pad(hour) }}
          </div>
          <div class="h-16" aria-hidden="true" />
        </div>

        <div
          ref="minuteColumn"
          role="listbox"
          aria-label="分钟"
          :aria-activedescendant="optionId('minute', selectedMinute)"
          :aria-disabled="props.disabled || undefined"
          tabindex="0"
          class="overscroll-contain h-40 w-14 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
          @scroll.passive="handleScroll('minute')"
          @keydown="event => handleKeydown('minute', event)"
        >
          <div class="h-16" aria-hidden="true" />
          <div
            v-for="minute in minutes"
            :id="optionId('minute', minute)"
            :key="minute"
            role="option"
            :aria-selected="minute === selectedMinute"
            :aria-disabled="isMinuteDisabled(selectedHour, minute) || undefined"
            class="text-sm flex h-8 items-center justify-center"
            :class="[
              minute === selectedMinute ? 'text-primary font-semibold' : 'text-foreground',
              isMinuteDisabled(selectedHour, minute) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
            ]"
            @click="selectMinute(minute)"
          >
            {{ pad(minute) }}
          </div>
          <div class="h-16" aria-hidden="true" />
        </div>

        <div
          v-if="showSeconds"
          ref="secondColumn"
          role="listbox"
          aria-label="秒"
          :aria-activedescendant="optionId('second', selectedSecond)"
          :aria-disabled="props.disabled || undefined"
          tabindex="0"
          class="overscroll-contain h-40 w-14 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
          @scroll.passive="handleScroll('second')"
          @keydown="event => handleKeydown('second', event)"
        >
          <div class="h-16" aria-hidden="true" />
          <div
            v-for="second in seconds"
            :id="optionId('second', second)"
            :key="second"
            role="option"
            :aria-selected="second === selectedSecond"
            :aria-disabled="isSecondDisabled(selectedHour, selectedMinute, second) || undefined"
            class="text-sm flex h-8 items-center justify-center"
            :class="[
              second === selectedSecond ? 'text-primary font-semibold' : 'text-foreground',
              isSecondDisabled(selectedHour, selectedMinute, second) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
            ]"
            @click="selectSecond(second)"
          >
            {{ pad(second) }}
          </div>
          <div class="h-16" aria-hidden="true" />
        </div>
      </div>
    </div>

    <footer class="pt-3 border-t border-border flex items-center justify-between">
      <FaButton
        type="button"
        variant="ghost"
        size="sm"
        class="min-h-9"
        :disabled="props.disabled"
        @click="emit('now')"
      >
        现在
      </FaButton>
      <div class="flex gap-2 items-center">
        <FaButton
          type="button"
          variant="outline"
          size="sm"
          class="min-h-9"
          @click="emit('cancel')"
        >
          取消
        </FaButton>
        <FaButton
          type="button"
          size="sm"
          class="min-h-9"
          :disabled="props.disabled"
          @click="emit('confirm')"
        >
          确定
        </FaButton>
      </div>
    </footer>
  </section>
</template>
