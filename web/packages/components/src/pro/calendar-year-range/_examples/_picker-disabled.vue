<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: parseDate('2024-01-01'),
  end: parseDate('2028-01-01'),
})
</script>

<template>
  <FaCalendarYearRange
    v-model="value"
    picker
    disabled
  />
</template>
