<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaDate from '../index.vue'

const value = shallowRef<DateValue[]>([
  parseDate('2026-06-04'),
  parseDate('2026-06-18'),
])
const defaultPlaceholder = parseDate('2026-06-01')

function formatDates(value: DateValue | DateValue[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return '选择日期'
  }

  return `已选择 ${value.length} 天`
}
</script>

<template>
  <FaDate
    v-model="value"
    picker
    multiple
    :default-placeholder="defaultPlaceholder"
    :format-value="formatDates"
  />
</template>
