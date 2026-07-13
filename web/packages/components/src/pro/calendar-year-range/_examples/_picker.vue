<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarYearRangeValue } from '../index.vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = today(getLocalTimeZone()).set({ month: 1, day: 1 })
</script>

<template>
  <FaCalendarYearRange
    v-model="value"
    picker
    :initial-focus="true"
    :default-placeholder="defaultPlaceholder"
  />
</template>
