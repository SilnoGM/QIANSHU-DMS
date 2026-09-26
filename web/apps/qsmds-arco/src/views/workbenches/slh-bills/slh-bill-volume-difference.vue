<script setup lang="ts">
import type { SlhBillLineDto } from '@/api/generated/types.gen'
import { resolveSlhBillVolumeDifference } from './display.logic'

defineOptions({ name: 'SlhBillVolumeDifference' })
const props = defineProps<{ line: Pick<SlhBillLineDto, 'volumeCai' | 'reportedVolumeCai'> }>()
const { t } = useI18n()
const difference = computed(() => resolveSlhBillVolumeDifference(props.line))
</script>

<template>
  <!-- 差异 = 系统计算材积 − 账单自报材积：正数标红（账单写少了），负数标绿；相等显示占位符。 -->
  <span v-if="difference === null" class="qs-type-data text-muted-foreground tabular-nums">
    {{ t('slhBill.valueMissing') }}
  </span>
  <span v-else-if="difference.tone === 'even'" class="qs-type-data text-muted-foreground tabular-nums">
    -
  </span>
  <span
    v-else
    class="qs-type-data tabular-nums"
    :class="difference.tone === 'over' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'"
  >
    {{ difference.text }} {{ t('slhBill.unit.cai') }}
  </span>
</template>
