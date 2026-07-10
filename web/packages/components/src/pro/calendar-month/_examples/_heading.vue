<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-06-01'))
</script>

<template>
  <FaCalendarMonth v-model="value">
    <template #heading="{ date }">
      <div class="text-sm font-medium flex gap-1.5 items-center">
        <span class="text-muted-foreground px-2 py-1 rounded-md bg-muted">
          {{ date.year }}
        </span>
        <span class="text-muted-foreground">年</span>
      </div>
    </template>
  </FaCalendarMonth>
</template>
