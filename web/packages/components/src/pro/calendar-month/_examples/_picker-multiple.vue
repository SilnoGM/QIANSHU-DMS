<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue[]>([])
const defaultPlaceholder = parseDate('2026-06-01')

function formatMonths(value: DateValue | DateValue[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return '选择多个月份'
  }

  if (value.length <= 2) {
    return value.map(item => `${item.year}-${item.month}`).join('、')
  }

  return `已选择 ${value.length} 个月`
}
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    picker
    multiple
    picker-placeholder="选择多个月份"
    trigger-class="w-[260px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatMonths"
  />
</template>
