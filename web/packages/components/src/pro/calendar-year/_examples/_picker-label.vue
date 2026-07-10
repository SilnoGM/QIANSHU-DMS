<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarYear from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = parseDate('2026-01-01')

function formatYear(value: DateValue | DateValue[] | undefined) {
  if (!value || Array.isArray(value)) {
    return '选择预算年份'
  }

  return `${value.year} 年`
}
</script>

<template>
  <FaCalendarYear
    v-model="value"
    picker
    picker-placeholder="选择预算年份"
    trigger-class="w-[240px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatYear"
  />
</template>
