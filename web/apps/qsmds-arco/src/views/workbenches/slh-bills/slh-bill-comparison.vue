<script setup lang="ts">
import type { SlhBillFindingDto, SlhBillReportedDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { buildSlhBillComparison, countSlhBillFindings, groupSlhBillFindings } from './comparison.logic'

const props = defineProps<{
  totals: SlhBillTotalsDto
  reported: SlhBillReportedDto
  /** 账单公式内嵌的汇率；有值时台币净额按它折回同一口径比较。 */
  embeddedForeignUnitsPerCny: string | null
  findings: SlhBillFindingDto[]
  /** 明细行数，用于「逐行复算一致」的结论文案。 */
  lineCount: number
}>()

const emit = defineEmits<{ jumpToLine: [lineNumber: number] }>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const supportOpen = ref(false)
const comparison = computed(() => buildSlhBillComparison({
  totals: props.totals,
  reported: props.reported,
  embeddedForeignUnitsPerCny: props.embeddedForeignUnitsPerCny,
}))
const counts = computed(() => countSlhBillFindings(props.findings))
const differenceGroups = computed(() => groupSlhBillFindings(props.findings.filter(finding => finding.severity === 'difference')))
const warningGroups = computed(() => groupSlhBillFindings(props.findings.filter(finding => finding.severity === 'warning')))
const foldedRate = computed(() => props.embeddedForeignUnitsPerCny)
// 账单另有一行把应付写成负数：与对比用的「小计」不同源，单独作为原文说明。
const negativePayable = computed(() => props.reported.payableAmountCny)

function statusLabel(status: string): string {
  return status === 'match' ? t('slhBill.comparison.match') : t('slhBill.comparison.mismatch')
}
</script>

<template>
  <div class="flex flex-col gap-4 min-w-0">
    <section class="min-w-0" :aria-label="t('slhBill.comparison.title')">
      <h2 class="qs-type-component-title m-0 mb-1">
        {{ t('slhBill.comparison.title') }}
      </h2>
      <p class="qs-type-meta text-muted-foreground m-0 mb-3">
        {{ t('slhBill.comparison.hint') }}
      </p>
      <div class="overflow-x-auto border border-border rounded-lg min-w-0">
        <table class="qs-type-body-medium text-left w-full border-collapse">
          <thead>
            <tr class="bg-muted/40">
              <th scope="col" class="font-medium px-4 py-2.5">{{ t('slhBill.comparison.column.metric') }}</th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">{{ t('slhBill.comparison.column.computed') }}</th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">{{ t('slhBill.comparison.column.reported') }}</th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">{{ t('slhBill.comparison.column.difference') }}</th>
              <th scope="col" class="font-medium px-4 py-2.5">{{ t('slhBill.comparison.column.conclusion') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in comparison.rows" :key="row.key" class="border-t border-border align-top" :class="row.status === 'mismatch' ? 'bg-destructive/5' : undefined">
              <th scope="row" class="font-normal px-4 py-3">
                {{ t(`slhBill.comparison.metric.${row.key}`) }}
              </th>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <AmountDisplay :value="row.computed" :currency="row.currency" :currencies="currencyCatalog.currencies.value" />
                <span v-if="row.comparableComputed" class="qs-type-meta text-muted-foreground block">
                  {{ t('slhBill.comparison.foldedTo', { value: row.comparableComputed, rate: foldedRate ?? '' }) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <template v-if="row.reported === null">
                  <span class="text-muted-foreground">{{ t('slhBill.comparison.notProvided') }}</span>
                </template>
                <template v-else>
                  <AmountDisplay :value="row.reported" :currency="row.reportedCurrency" :currencies="currencyCatalog.currencies.value" />
                  <span v-if="row.comparableComputed" class="qs-type-meta text-muted-foreground block">
                    {{ t('slhBill.comparison.reportedConverted') }}
                  </span>
                </template>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <template v-if="row.difference === null">
                  <span class="text-muted-foreground">—</span>
                </template>
                <template v-else>
                  <AmountDisplay :value="row.difference" :currency="row.reportedCurrency" :currencies="currencyCatalog.currencies.value" />
                </template>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <template v-if="row.status === 'match'">
                  <FaTag variant="outline" class="qs-type-status-tag border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                    {{ statusLabel(row.status) }}
                  </FaTag>
                </template>
                <template v-else-if="row.status === 'mismatch'">
                  <FaTag variant="outline" class="qs-type-status-tag border-destructive/40 text-destructive">
                    {{ statusLabel(row.status) }}
                  </FaTag>
                </template>
                <span v-else class="qs-type-meta text-muted-foreground">{{ t('slhBill.comparison.notComparable') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="negativePayable" class="qs-type-meta text-muted-foreground m-0 mt-2">
        {{ t('slhBill.comparison.negativePayableNote', { value: negativePayable }) }}
      </p>
    </section>

    <section class="min-w-0">
      <button
        type="button"
        class="qs-type-component-title flex gap-1.5 items-center bg-transparent border-0 cursor-pointer p-0 text-foreground"
        :aria-expanded="supportOpen"
        @click="supportOpen = !supportOpen"
      >
        <FaIcon :name="supportOpen ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'" aria-hidden="true" class="size-4" />
        {{ t('slhBill.comparison.supportTitle') }}
      </button>
      <p class="qs-type-meta text-muted-foreground m-0 mt-1">
        {{ t('slhBill.comparison.supportHint') }}
      </p>
      <dl v-if="supportOpen" class="m-0 gap-x-6 gap-y-3 grid grid-cols-1 mt-3 sm:grid-cols-3">
        <div v-for="item in comparison.supportTotals" :key="item.key" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t(`slhBill.comparison.support.${item.key}`) }}
          </dt>
          <dd class="m-0 mt-1">
            <AmountDisplay :value="item.value" currency="CNY" :currencies="currencyCatalog.currencies.value" />
          </dd>
        </div>
      </dl>
    </section>

    <section class="min-w-0" :aria-label="t('slhBill.comparison.findingsTitle')">
      <h2 class="qs-type-component-title flex gap-2 items-center m-0 mb-3">
        {{ t('slhBill.comparison.findingsTitle') }}
        <FaTag v-if="counts.difference > 0" variant="outline" class="qs-type-status-tag border-destructive/40 text-destructive">
          {{ counts.difference }}
        </FaTag>
        <FaTag v-if="counts.warning > 0" variant="outline" class="qs-type-status-tag border-amber-500/40 text-amber-700 dark:text-amber-300">
          {{ counts.warning }}
        </FaTag>
      </h2>

      <p v-if="findings.length === 0" class="qs-type-body-medium flex gap-2 items-center text-emerald-700 m-0 dark:text-emerald-300">
        <FaIcon name="i-lucide:circle-check" aria-hidden="true" class="size-4 flex-none" />
        {{ t('slhBill.comparison.noFindings', { count: lineCount }) }}
      </p>

      <div v-else class="flex flex-col gap-4 min-w-0">
        <div v-for="group in [...differenceGroups, ...warningGroups]" :key="`${group.severity}:${group.kind}`" class="min-w-0">
          <h3 class="qs-type-body-medium flex gap-2 items-center m-0 mb-2">
            <FaIcon
              :name="group.severity === 'difference' ? 'i-lucide:triangle-alert' : 'i-lucide:info'"
              aria-hidden="true"
              class="size-4 flex-none"
              :class="group.severity === 'difference' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'"
            />
            {{ t(`slhBill.finding.${group.kind}`) }}
            <span class="qs-type-meta text-muted-foreground">{{ t('slhBill.comparison.findingCount', { count: group.items.length }) }}</span>
          </h3>
          <ul class="m-0 pl-0 list-none flex flex-col gap-1.5">
            <li v-for="(item, index) in group.items" :key="index" class="qs-type-body-medium flex gap-2 flex-wrap items-baseline">
              <button
                v-if="item.lineNumber !== null"
                type="button"
                class="qs-type-meta shrink-0 bg-transparent border-0 cursor-pointer underline p-0 text-primary"
                @click="emit('jumpToLine', item.lineNumber)"
              >
                {{ t('slhBill.comparison.lineNumber', { line: item.sourceRowNumber ?? item.lineNumber }) }}
              </button>
              <span class="min-w-0 [overflow-wrap:anywhere]">{{ item.message }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
