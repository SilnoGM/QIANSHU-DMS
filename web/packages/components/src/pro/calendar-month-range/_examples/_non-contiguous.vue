<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import type { CalendarMonthRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonthRange from '../index.vue'

const value = shallowRef<CalendarMonthRangeValue>({
  start: parseDate('2026-05-01'),
  end: undefined,
})

function isMonthUnavailable(month: DateValue) {
  return month.month === 7
}
</script>

<template>
  <FaCalendarMonthRange
    v-model="value"
    allow-non-contiguous-ranges
    :is-month-unavailable="isMonthUnavailable"
  />
</template>
