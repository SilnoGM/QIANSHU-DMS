<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarMonthRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonthRange from '../index.vue'

const value = shallowRef<CalendarMonthRangeValue>({
  start: parseDate('2026-03-01'),
  end: parseDate('2026-08-01'),
})
</script>

<template>
  <div class="space-y-3">
    <FaCalendarMonthRange v-model="value" />
    <div class="text-sm text-muted-foreground">
      当前范围：{{ value.start?.toString() || '-' }} 至 {{ value.end?.toString() || '-' }}
    </div>
  </div>
</template>
