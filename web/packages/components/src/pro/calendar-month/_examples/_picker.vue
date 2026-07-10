<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = today(getLocalTimeZone()).set({ day: 1 })
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    picker
    :initial-focus="true"
    :default-placeholder="defaultPlaceholder"
  />
</template>
