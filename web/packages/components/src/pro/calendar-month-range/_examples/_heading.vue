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
  <FaCalendarMonthRange v-model="value">
    <template #heading="{ date }">
      <div class="text-sm font-medium flex gap-1.5 items-center">
        <span class="text-muted-foreground px-2 py-1 rounded-md bg-muted">
          {{ date.year }}
        </span>
        <span class="text-muted-foreground">年</span>
      </div>
    </template>
  </FaCalendarMonthRange>
</template>
