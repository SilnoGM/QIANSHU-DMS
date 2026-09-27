<script setup lang="ts">
import type { SlhBillAnyReconciliationStatus } from './reconciliation-status.logic'
import { resolveSlhBillReconciliationLabelKey, resolveSlhBillReconciliationTone } from './reconciliation-status.logic'

defineOptions({ name: 'SlhBillReconciliationStatusTag' })
/**
 * 对账状态标签：账单列表传三态（未对账 / 部分对账 / 对账完成），详情页明细行传二态（未对账 / 已对账）。
 * 两处共用同一份颜色与文案映射，见 reconciliation-status.logic。
 */
const props = defineProps<{ status: SlhBillAnyReconciliationStatus }>()

const { t } = useI18n()
const tone = computed(() => resolveSlhBillReconciliationTone(props.status))
const label = computed(() => t(resolveSlhBillReconciliationLabelKey(props.status)))
</script>

<template>
  <FaTag variant="outline" class="qs-type-status-tag" :class="tone">
    {{ label }}
  </FaTag>
</template>
