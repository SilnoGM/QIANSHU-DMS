<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CalendarYearRangeValue } from '../index.vue'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaCalendarYearRange from '../index.vue'

const value = shallowRef<CalendarYearRangeValue>({
  start: undefined,
  end: undefined,
})
const open = shallowRef(false)
const defaultPlaceholder = parseDate('2026-01-01')
</script>

<template>
  <div class="flex flex-wrap gap-3 items-center">
    <FaCalendarYearRange
      v-model="value"
      v-model:open="open"
      picker
      popover-align="start"
      popover-side="bottom"
      trigger-variant="secondary"
      trigger-size="sm"
      trigger-class="w-[280px]"
      :popover-side-offset="8"
      :default-placeholder="defaultPlaceholder"
    />
    <FaButton variant="outline" size="sm" @click="open = !open">
      {{ open ? '收起' : '展开' }}
    </FaButton>
  </div>
</template>
