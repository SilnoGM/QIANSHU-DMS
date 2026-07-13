<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarDateRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDateRange from '../index.vue'

const value = shallowRef<CalendarDateRangeValue>({
  start: parseDate('2026-06-04'),
  end: undefined,
})

function isDateDisabled(date: DateValue) {
  return date.day === 1
}

function isDateUnavailable(date: DateValue) {
  return date.day % 7 === 0
}
</script>

<template>
  <FaCalendarDateRange
    v-model="value"
    :min-value="parseDate('2026-01-01')"
    :max-value="parseDate('2026-12-31')"
    :is-date-disabled="isDateDisabled"
    :is-date-unavailable="isDateUnavailable"
  />
</template>
