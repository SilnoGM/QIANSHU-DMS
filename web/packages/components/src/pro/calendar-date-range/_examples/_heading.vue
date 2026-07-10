<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarDateRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDateRange from '../index.vue'

const value = shallowRef<CalendarDateRangeValue>({
  start: parseDate('2026-06-04'),
  end: parseDate('2026-06-10'),
})
</script>

<template>
  <FaCalendarDateRange v-model="value">
    <template #heading="{ date }">
      <div class="text-sm font-medium flex gap-1.5 items-center">
        <span class="text-muted-foreground px-2 py-1 rounded-md bg-muted">
          {{ date.year }}
        </span>
        <span class="text-muted-foreground">/</span>
        <span class="text-muted-foreground px-2 py-1 rounded-md bg-muted">
          {{ date.month }}
        </span>
      </div>
    </template>
  </FaCalendarDateRange>
</template>
