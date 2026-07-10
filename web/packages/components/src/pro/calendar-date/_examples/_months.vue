<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDate from '../index.vue'

const value = shallowRef<DateValue>(parseDate('2026-06-04'))
</script>

<template>
  <FaCalendarDate
    v-model="value"
    :number-of-months="2"
    paged-navigation
  />
</template>
