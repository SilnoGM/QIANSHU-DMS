<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarDateRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDateRange from '../index.vue'

const value = shallowRef<CalendarDateRangeValue>({
  start: parseDate('2026-06-04'),
  end: undefined,
})
</script>

<template>
  <FaCalendarDateRange
    v-model="value"
    :maximum-days="7"
  />
</template>
