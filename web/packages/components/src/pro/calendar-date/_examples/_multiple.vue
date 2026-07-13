<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { computed, shallowRef } from 'vue'
import FaCalendarDate from '../index.vue'

const value = shallowRef<DateValue[]>([
  parseDate('2026-06-04'),
  parseDate('2026-06-18'),
])

const selectedText = computed(() => value.value.map(date => date.toString()).join('、') || '未选择')
</script>

<template>
  <div class="space-y-3">
    <FaCalendarDate
      v-model="value"
      multiple
      :number-of-months="2"
    />
    <div class="text-sm text-muted-foreground">
      当前选择：{{ selectedText }}
    </div>
  </div>
</template>
