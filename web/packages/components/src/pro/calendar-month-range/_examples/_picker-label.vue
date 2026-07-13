<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarMonthRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonthRange from '../index.vue'

const value = shallowRef<CalendarMonthRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = parseDate('2026-06-01')

function formatMonth(date: DateValue) {
  return `${date.year} 年 ${date.month} 月`
}

function formatMonthRange(value: CalendarMonthRangeValue) {
  const { start, end } = value

  if (start && end) {
    return `${formatMonth(start)} 至 ${formatMonth(end)}`
  }

  if (start) {
    return `${formatMonth(start)} 至 ...`
  }

  return '选择账期范围'
}
</script>

<template>
  <FaCalendarMonthRange
    v-model="value"
    picker
    picker-placeholder="选择账期范围"
    trigger-class="w-[300px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatMonthRange"
  />
</template>
