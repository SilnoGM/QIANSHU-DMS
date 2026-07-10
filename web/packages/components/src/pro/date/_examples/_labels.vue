<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaDate from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = parseDate('2026-06-01')

function formatMonthLabel(date: DateValue) {
  return `${date.month} 月`
}

function formatYearLabel(date: DateValue) {
  return `${date.year} 年`
}

function formatYearRangeLabel(start: DateValue, end: DateValue) {
  return `${start.year} 至 ${end.year}`
}
</script>

<template>
  <FaDate
    v-model="value"
    :default-placeholder="defaultPlaceholder"
    :format-month-label="formatMonthLabel"
    :format-year-label="formatYearLabel"
    :format-year-range-label="formatYearRangeLabel"
  />
</template>
