<script setup lang="ts">
import type { SlhBillListItemDto } from '@/api/generated/types.gen'

defineOptions({ name: 'SlhBillRateSourceTag' })
/** 汇率来源的三态颜色标签：账单内嵌=绿（账单自带）、系统汇率=蓝、手工填写=琥珀（人工录入需留意）。 */
const props = defineProps<{ source: SlhBillListItemDto['rateSource'] | null }>()

type RateSource = NonNullable<SlhBillListItemDto['rateSource']>

const { t } = useI18n()
const TONE_CLASSES: Record<RateSource, string> = {
  EMBEDDED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  SYSTEM: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  MANUAL: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
}
const tone = computed(() => props.source === null || props.source === undefined ? '' : TONE_CLASSES[props.source])
</script>

<template>
  <span v-if="!source" class="qs-type-data text-muted-foreground">{{ t('slhBill.noRate') }}</span>
  <FaTag v-else variant="outline" class="qs-type-status-tag" :class="tone">
    {{ t(`slhBill.rateSource.${source}`) }}
  </FaTag>
</template>
