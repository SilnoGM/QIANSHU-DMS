<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarMonthRangeValue } from '../index.vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonthRange from '../index.vue'

const value = shallowRef<CalendarMonthRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = today(getLocalTimeZone()).set({ day: 1 })
</script>

<template>
  <FaCalendarMonthRange
    v-model="value"
    picker
    :initial-focus="true"
    :default-placeholder="defaultPlaceholder"
  />
</template>
