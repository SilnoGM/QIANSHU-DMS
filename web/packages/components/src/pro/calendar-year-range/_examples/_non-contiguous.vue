<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: parseDate('2024-01-01'),
  end: undefined,
})

function isYearUnavailable(year: DateValue) {
  return year.year === 2027
}
</script>

<template>
  <FaCalendarYearRange
    v-model="value"
    allow-non-contiguous-ranges
    :is-year-unavailable="isYearUnavailable"
  />
</template>
