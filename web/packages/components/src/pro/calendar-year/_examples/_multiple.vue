<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { computed, shallowRef } from 'vue'
import FaCalendarYear from '../index.vue'

const value = shallowRef<DateValue[]>([
  parseDate('2024-01-01'),
  parseDate('2026-01-01'),
])

const selectedText = computed(() => value.value.map(year => String(year.year)).join('、') || '未选择')
</script>

<template>
  <div class="space-y-3">
    <FaCalendarYear v-model="value" multiple />
    <div class="text-sm text-muted-foreground">
      当前选择：{{ selectedText }}
    </div>
  </div>
</template>
