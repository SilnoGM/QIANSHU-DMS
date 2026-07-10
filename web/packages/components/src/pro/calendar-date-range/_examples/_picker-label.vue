<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarDateRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDateRange from '../index.vue'

const value = shallowRef<CalendarDateRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = parseDate('2026-06-01')

function formatDate(date: DateValue) {
  return `${date.month}/${date.day}`
}

function formatDateRange(value: CalendarDateRangeValue) {
  const { start, end } = value

  if (start && end) {
    return `${formatDate(start)} 至 ${formatDate(end)}`
  }

  if (start) {
    return `${formatDate(start)} 至 ...`
  }

  return '选择项目周期'
}
</script>

<template>
  <FaCalendarDateRange
    v-model="value"
    picker
    picker-placeholder="选择项目周期"
    trigger-class="w-[260px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatDateRange"
  />
</template>
