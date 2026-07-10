<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaDate from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = parseDate('1990-01-01')
const minValue = parseDate('1900-01-01')
const maxValue = today(getLocalTimeZone())

function formatValue(value: DateValue | DateValue[] | undefined) {
  return Array.isArray(value) ? `已选择 ${value.length} 项` : value?.toString() ?? '选择生日'
}
</script>

<template>
  <FaDate
    v-model="value"
    picker
    default-view="year"
    picker-placeholder="选择生日"
    :default-placeholder="defaultPlaceholder"
    :min-value="minValue"
    :max-value="maxValue"
    :format-value="formatValue"
  />
</template>
