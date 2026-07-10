<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarDateRangeValue } from '../index.vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDateRange from '../index.vue'

const value = shallowRef<CalendarDateRangeValue>({
  start: undefined,
  end: undefined,
})
const defaultPlaceholder = today(getLocalTimeZone())
</script>

<template>
  <FaCalendarDateRange
    v-model="value"
    picker
    :initial-focus="true"
    :default-placeholder="defaultPlaceholder"
  />
</template>
