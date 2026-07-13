<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-06-01'))
const placeholder = shallowRef<DateValue>(parseDate('2026-01-01'))

function nextPage(placeholder: DateValue) {
  return placeholder.set({ year: placeholder.year + 2 })
}

function prevPage(placeholder: DateValue) {
  return placeholder.set({ year: placeholder.year - 2 })
}
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    v-model:placeholder="placeholder"
    :next-page="nextPage"
    :prev-page="prevPage"
  />
</template>
