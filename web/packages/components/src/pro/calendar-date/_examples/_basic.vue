<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { getLocalTimeZone, today } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaCalendarDate from '../index.vue'

const value = shallowRef<DateValue>(today(getLocalTimeZone()))
</script>

<template>
  <div class="space-y-3">
    <FaCalendarDate v-model="value" />
    <div class="text-sm text-muted-foreground">
      当前选择：{{ value.toString() }}
    </div>
  </div>
</template>
