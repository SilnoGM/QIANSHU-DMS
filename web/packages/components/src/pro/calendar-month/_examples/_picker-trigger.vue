<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaCalendarMonth from '../index.vue'

const value = shallowRef<DateValue>()
const defaultPlaceholder = parseDate('2026-06-01')
</script>

<template>
  <FaCalendarMonth
    v-model="value"
    picker
    :default-placeholder="defaultPlaceholder"
  >
    <template #trigger="{ label, open }">
      <FaButton variant="outline" class="w-[240px] justify-between">
        <span class="min-w-0 truncate">{{ label }}</span>
        <FaIcon :name="open ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" class="size-4" />
      </FaButton>
    </template>
  </FaCalendarMonth>
</template>
