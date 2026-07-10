<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = parseDate('2026-06-01')

function formatMonth(value: DateValue | DateValue[] | undefined) {
  if (!value || Array.isArray(value)) {
    return '选择结算月份'
  }

  return `${value.year} 年 ${value.month} 月`
}
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    picker
    picker-placeholder="选择结算月份"
    trigger-class="w-[240px]"
    :default-placeholder="defaultPlaceholder"
    :format-value="formatMonth"
  />
</template>
