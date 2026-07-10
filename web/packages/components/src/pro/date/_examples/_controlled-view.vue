<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { shallowRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaDate from '../index.vue'

type DateView = 'date' | 'month' | 'year'

const value = shallowRef<DateValue>()
const view = shallowRef<DateView>('year')
const placeholder = shallowRef<DateValue>(parseDate('2026-06-01'))
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-2">
      <FaButton variant="outline" size="sm" @click="view = 'year'">
        年份视图
      </FaButton>
      <FaButton variant="outline" size="sm" @click="view = 'month'">
        月份视图
      </FaButton>
      <FaButton variant="outline" size="sm" @click="view = 'date'">
        日期视图
      </FaButton>
    </div>
    <FaDate
      v-model="value"
      v-model:view="view"
      v-model:placeholder="placeholder"
    />
  </div>
</template>
