<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: parseDate('2022-01-01'),
  end: undefined,
})

function isYearDisabled(year: DateValue) {
  return year.year === 2024
}

function isYearUnavailable(year: DateValue) {
  return year.year === 2028
}
</script>

<template>
  <FaCalendarYearRange
    v-model="value"
    :min-value="parseDate('2020-01-01')"
    :max-value="parseDate('2031-01-01')"
    :is-year-disabled="isYearDisabled"
    :is-year-unavailable="isYearUnavailable"
  />
</template>
