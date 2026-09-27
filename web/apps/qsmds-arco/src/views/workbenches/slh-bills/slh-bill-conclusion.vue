<script setup lang="ts">
import type { SlhBillComparisonKey } from './comparison.logic'
import type { SlhBillReportedDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { buildSlhBillComparison, resolveSlhBillConclusion } from './comparison.logic'
import { formatSlhBillRate } from './display.logic'

const props = defineProps<{
  totals: SlhBillTotalsDto
  reported: SlhBillReportedDto
  /** 账单公式内嵌的汇率；折算净额由它把台币净额折成人民币。 */
  embeddedForeignUnitsPerCny: string | null
  /** 入库确认时落库的差异与告警计数，决定结论等级。 */
  counts: { difference: number, warning: number }
  lineCount: number
}>()

const emit = defineEmits<{ viewFindings: [] }>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
// 与下方对比表同源：结论层与表格读同一份 buildSlhBillComparison 结果，
// 避免两处对「应付多少、差在哪」给出不一致的答案。
const comparison = computed(() => buildSlhBillComparison({
  totals: props.totals,
  reported: props.reported,
  embeddedForeignUnitsPerCny: props.embeddedForeignUnitsPerCny,
}))
const conclusion = computed(() => resolveSlhBillConclusion(props.counts))
const payable = computed(() => comparison.value.rows.find(row => row.key === 'payable') ?? null)
// 次级三项固定按台币两笔 + 折算净额排列：折算净额是人民币，币种由行自己带出来。
const secondaryKeys: readonly SlhBillComparisonKey[] = ['codTwd', 'ntdSurchargeTwd', 'netTwd']
const secondaryRows = computed(() => secondaryKeys.flatMap(key => comparison.value.rows.filter(row => row.key === key)))

function metricLabel(key: SlhBillComparisonKey): string {
  return t(`slhBill.comparison.metric.${key}`)
}
</script>

<template>
  <div class="min-w-0">
    <div class="gap-4 grid min-w-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
      <!-- 主数字：全页唯一的大号金额，是全页的视觉落点。 -->
      <div v-if="payable" data-slot="slh-bill-conclusion-payable" class="p-4 border border-primary/30 rounded-xl bg-primary/8 flex flex-col min-w-0">
        <p class="qs-type-compact-label text-primary m-0">
          {{ t('slhBill.column.payableTotalAmountCny') }} · {{ t('slhBill.comparison.column.computed') }}
        </p>
        <div tabindex="0" :aria-label="t('slhBill.column.payableTotalAmountCny')" class="mt-1.5 max-w-full overflow-x-auto">
          <AmountDisplay class="!text-2xl !leading-10 !font-semibold md:!text-3xl" :value="payable.computed" :currency="payable.currency" :currencies="currencyCatalog.currencies.value" />
        </div>
        <!-- 口径注脚贴底：三块等高时留白落在数字与注脚之间，而不是底部空洞。 -->
        <p class="qs-type-meta text-muted-foreground m-0 mt-auto pt-2 flex flex-wrap gap-x-2 items-baseline">
          <span>{{ t('slhBill.comparison.column.reported') }}</span>
          <AmountDisplay class="!text-xs" :value="payable.reported" :currency="payable.reportedCurrency" :currencies="currencyCatalog.currencies.value" />
          <template v-if="payable.status === 'mismatch'">
            <span aria-hidden="true">·</span>
            <span>{{ t('slhBill.comparison.column.difference') }}</span>
            <AmountDisplay class="!text-xs !text-destructive" :value="payable.difference" :currency="payable.reportedCurrency" :currencies="currencyCatalog.currencies.value" />
          </template>
        </p>
      </div>

      <dl class="m-0 p-4 border border-border rounded-xl gap-x-5 gap-y-2 grid min-w-0 lg:grid-cols-1 sm:grid-cols-3">
        <div v-for="row in secondaryRows" :key="row.key" class="min-w-0">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ metricLabel(row.key) }}
          </dt>
          <dd class="m-0 mt-0.5">
            <AmountDisplay class="!text-lg !font-semibold" :value="row.computed" :currency="row.currency" :currencies="currencyCatalog.currencies.value" />
          </dd>
          <!-- 折算净额标出所用汇率，避免和旁边的台币金额被当成同一币种读。 -->
          <p v-if="row.foldedFrom" class="qs-type-meta text-muted-foreground m-0 mt-0.5">
            {{ t('slhBill.conclusion.foldedByRate', { rate: formatSlhBillRate(row.foldedFrom.rate) ?? row.foldedFrom.rate }) }}
          </p>
        </div>
      </dl>

      <!-- 结论：只用小面积语义色表达状态，不与主数字争色彩。 -->
      <div data-slot="slh-bill-conclusion-verdict" class="p-4 border border-border rounded-xl bg-muted/15 flex flex-col min-w-0">
        <p class="qs-type-compact-label text-muted-foreground m-0">
          {{ t('slhBill.comparison.column.conclusion') }}
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <FaTag v-if="counts.difference > 0" variant="outline" class="text-destructive qs-type-status-tag border-destructive/40">
            {{ t('slhBill.conclusion.differenceCount', { count: counts.difference }) }}
          </FaTag>
          <FaTag v-if="counts.warning > 0" variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300">
            {{ t('slhBill.conclusion.warningCount', { count: counts.warning }) }}
          </FaTag>
          <FaTag v-if="conclusion === 'match'" variant="outline" class="text-emerald-700 qs-type-status-tag border-emerald-500/40 dark:text-emerald-300">
            {{ t('slhBill.comparison.match') }}
          </FaTag>
        </div>
        <p v-if="conclusion === 'match'" class="qs-type-body-medium text-emerald-700 m-0 mt-3 flex gap-2 items-start dark:text-emerald-300">
          <FaIcon name="i-lucide:circle-check" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
          {{ t('slhBill.comparison.noFindings', { count: lineCount }) }}
        </p>
        <p v-else class="qs-type-body-medium m-0 mt-3 flex gap-2 items-start" :class="conclusion === 'difference' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'">
          <FaIcon :name="conclusion === 'difference' ? 'i-lucide:triangle-alert' : 'i-lucide:info'" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
          {{ conclusion === 'difference' ? t('slhBill.conclusion.differenceNotice') : t('slhBill.conclusion.warningNotice') }}
        </p>
        <FaButton v-if="conclusion !== 'match'" variant="ghost" size="sm" class="mt-auto -ml-2" @click="emit('viewFindings')">
          <FaIcon name="i-lucide:arrow-down" aria-hidden="true" />{{ t('slhBill.conclusion.viewFindings') }}
        </FaButton>
      </div>
    </div>
    <p class="qs-type-meta text-muted-foreground m-0 mt-3">
      {{ t('slhBill.conclusion.twdHint') }}
    </p>
  </div>
</template>
