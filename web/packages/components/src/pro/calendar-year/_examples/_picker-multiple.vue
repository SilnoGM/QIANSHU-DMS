<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYear from '../index.vue'

const value = shallowRef<DateValue[]>([])
const defaultPlaceholder = parseDate('2026-01-01')

function formatYears(value: DateValue | DateValue[] | undefined) {
  if (!Array.isArray(value) || value.length === 0) {
    return '选择多个年份'
  }

  if (value.length <= 3) {
    return value.map(item => item.year).join('、')
  }

  return `已选择 ${value.length} 年`
}
</script>

<template>
  <FaCalendarYear
    v-model="value"
    picker
    multiple
    picker-placeholder="选择多个年份"
    trigger-class="w-[260px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatYears"
  />
</template>
