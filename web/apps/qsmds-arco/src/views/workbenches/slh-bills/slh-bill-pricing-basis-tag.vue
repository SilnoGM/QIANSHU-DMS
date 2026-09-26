<script setup lang="ts">
import type { SlhBillLineDto } from '@/api/generated/types.gen'

defineOptions({ name: 'SlhBillPricingBasisTag' })
const props = defineProps<{ basis: SlhBillLineDto['pricingBasis'] | null }>()
const { t } = useI18n()
// 两种计价方式用固定色区分：按材积走紫、按重量走蓝，便于整列扫读。
const tone = computed(() => props.basis === 'VOLUME'
  ? 'border-violet-500/40 text-violet-700 dark:text-violet-300'
  : 'border-sky-500/40 text-sky-700 dark:text-sky-300')
</script>

<template>
  <span v-if="!basis" class="qs-type-data text-muted-foreground">{{ t('slhBill.valueMissing') }}</span>
  <FaTag v-else variant="outline" class="qs-type-status-tag" :class="tone">
    {{ t(`slhBill.pricingBasis.${basis}`) }}
  </FaTag>
</template>
