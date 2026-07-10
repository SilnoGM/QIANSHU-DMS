<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYear from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-01-01'))
</script>

<template>
  <FaCalendarYear v-model="value">
    <template #heading="{ date }">
      <div class="text-sm font-medium flex gap-1.5 items-center">
        <span class="text-muted-foreground px-2 py-1 rounded-md bg-muted">
          {{ date.year }} - {{ date.year + 11 }}
        </span>
        <span class="text-muted-foreground">年份</span>
      </div>
    </template>
  </FaCalendarYear>
</template>
