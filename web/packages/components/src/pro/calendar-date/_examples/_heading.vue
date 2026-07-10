<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDate from '../index.vue'

const value = shallowRef<DateValue>(today(getLocalTimeZone()))
</script>

<template>
  <FaCalendarDate v-model="value">
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
  </FaCalendarDate>
</template>
