<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = parseDate('2026-01-01')

function formatYearRange(value: CalendarYearRangeValue) {
  const { start, end } = value

  if (start && end) {
    return `${start.year} 年至 ${end.year} 年`
  }

  if (start) {
    return `${start.year} 年至 ...`
  }

  return '选择战略周期'
}
</script>

<template>
  <FaCalendarYearRange
    v-model="value"
    picker
    picker-placeholder="选择战略周期"
    trigger-class="w-[260px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatYearRange"
  />
</template>
