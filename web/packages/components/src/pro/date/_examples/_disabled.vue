<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaDate from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-06-12'))

function isDateDisabled(date: DateValue) {
  return date.day < 10
}

function isMonthDisabled(month: DateValue) {
  return month.month < 3
}

function isYearDisabled(year: DateValue) {
  return year.year < 2020
}
</script>

<template>
  <FaDate
    v-model="value"
    :min-value="parseDate('2020-01-01')"
    :max-value="parseDate('2030-12-31')"
    :is-date-disabled="isDateDisabled"
    :is-month-disabled="isMonthDisabled"
    :is-year-disabled="isYearDisabled"
  />
</template>
