<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: parseDate('2022-01-01'),
  end: parseDate('2026-01-01'),
})
</script>

<template>
  <div class="space-y-3">
    <FaCalendarYearRange v-model="value" />
    <div class="text-sm text-muted-foreground">
      当前范围：{{ value.start?.toString() || '-' }} 至 {{ value.end?.toString() || '-' }}
    </div>
  </div>
</template>
