<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarMonthRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonthRange from '../index.vue'

const value = shallowRef<CalendarMonthRangeValue>({
  start: parseDate('2026-03-01'),
  end: undefined,
})
</script>

<template>
  <FaCalendarMonthRange
    v-model="value"
    :maximum-months="6"
  />
</template>
