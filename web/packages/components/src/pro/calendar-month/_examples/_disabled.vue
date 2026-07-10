<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-06-01'))

function isMonthDisabled(month: DateValue) {
  return month.month === 2
}

function isMonthUnavailable(month: DateValue) {
  return month.month === 7
}
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    :min-value="parseDate('2026-01-01')"
    :max-value="parseDate('2026-12-01')"
    :is-month-disabled="isMonthDisabled"
    :is-month-unavailable="isMonthUnavailable"
  />
</template>
