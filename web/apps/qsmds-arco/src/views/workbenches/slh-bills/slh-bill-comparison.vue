<script setup lang="ts">
import type { SlhBillFindingDto, SlhBillReportedDto, SlhBillTotalsDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { buildSlhBillComparison, countSlhBillFindings, groupSlhBillFindings } from './comparison.logic'
import { formatSlhBillRate } from './display.logic'

const props = defineProps<{
  totals: SlhBillTotalsDto
  reported: SlhBillReportedDto
  /** 账单公式内嵌的汇率；有值时折算净额按它折成人民币比较。 */
  embeddedForeignUnitsPerCny: string | null
  findings: SlhBillFindingDto[]
  /** 明细行数，用于「逐行复算一致」的结论文案。 */
  lineCount: number
}>()

const emit = defineEmits<{ jumpToLine: [lineNumber: number] }>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const comparison = computed(() => buildSlhBillComparison({
  totals: props.totals,
  reported: props.reported,
  embeddedForeignUnitsPerCny: props.embeddedForeignUnitsPerCny,
}))
const counts = computed(() => countSlhBillFindings(props.findings))
const differenceGroups = computed(() => groupSlhBillFindings(props.findings.filter(finding => finding.severity === 'difference')))
const warningGroups = computed(() => groupSlhBillFindings(props.findings.filter(finding => finding.severity === 'warning')))
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
      <div class="border border-border rounded-lg min-w-0 overflow-x-auto">
        <table class="qs-type-body-medium text-left w-full border-collapse">
          <thead>
            <tr class="bg-muted/40">
              <th scope="col" class="font-medium px-4 py-2.5">
                {{ t('slhBill.comparison.column.metric') }}
              </th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">
                {{ t('slhBill.comparison.column.computed') }}
              </th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">
                {{ t('slhBill.comparison.column.reported') }}
              </th>
              <th scope="col" class="font-medium px-4 py-2.5 text-right">
                {{ t('slhBill.comparison.column.difference') }}
              </th>
              <th scope="col" class="font-medium px-4 py-2.5">
                {{ t('slhBill.comparison.column.conclusion') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in comparison.rows" :key="row.key" class="align-top border-t border-border" :class="row.status === 'mismatch' ? 'bg-destructive/5' : undefined">
              <th scope="row" class="font-normal px-4 py-3">
                {{ t(`slhBill.comparison.metric.${row.key}`) }}
              </th>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <span class="inline-flex gap-1.5 items-baseline justify-end">
                  <AmountDisplay :value="row.computed" :currency="row.currency" :currencies="currencyCatalog.currencies.value" />
                  <!-- 自算支持项只在它支撑的那一行（合计应付人民币）就地展开，不再单开一节。 -->
                  <FaTooltip v-if="row.key === 'payable'" side="top" align="end">
                    <button
                      type="button"
                      class="text-muted-foreground p-0 border-0 bg-transparent cursor-pointer"
                      :aria-label="t('slhBill.comparison.supportTitle')"
                    >
                      <FaIcon name="i-lucide:info" class="size-3.5" aria-hidden="true" />
                    </button>
                    <template #content>
                      <div class="gap-1 grid w-60">
                        <p class="qs-type-compact-label m-0">
                          {{ t('slhBill.comparison.supportTitle') }}
                        </p>
                        <p v-for="item in comparison.supportTotals" :key="item.key" class="m-0 flex gap-3 items-baseline justify-between">
                          <span class="qs-type-meta text-muted-foreground">{{ t(`slhBill.comparison.support.${item.key}`) }}</span>
                          <AmountDisplay class="!text-xs" :value="item.value" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                        </p>
                        <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                          {{ t('slhBill.comparison.supportHint') }}
                        </p>
                      </div>
                    </template>
                  </FaTooltip>
                </span>
                <span v-if="row.foldedFrom" class="qs-type-meta text-muted-foreground mt-0.5 flex flex-wrap gap-x-1 items-baseline justify-end">
                  <span>{{ t('slhBill.comparison.foldedFrom') }}</span>
                  <AmountDisplay class="!text-xs" :value="row.foldedFrom.value" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                  <span>÷ {{ formatSlhBillRate(row.foldedFrom.rate) ?? row.foldedFrom.rate }}</span>
                </span>
                <!-- 无内嵌汇率时算不出折算净额，如实说明这一行还是台币原值。 -->
                <span v-else-if="row.key === 'netTwd' && row.currency === 'TWD'" class="qs-type-meta text-muted-foreground mt-0.5 block">
                  {{ t('slhBill.comparison.notFolded') }}
                </span>
              </td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <template v-if="row.reported === null">
                  <span class="text-muted-foreground">{{ t('slhBill.comparison.notProvided') }}</span>
                </template>
                <template v-else>
                  <AmountDisplay :value="row.reported" :currency="row.reportedCurrency" :currencies="currencyCatalog.currencies.value" />
                  <span v-if="row.foldedFrom" class="qs-type-meta text-muted-foreground block">
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
                  <FaTag variant="outline" class="text-emerald-700 qs-type-status-tag border-emerald-500/40 dark:text-emerald-300">
                    {{ statusLabel(row.status) }}
                  </FaTag>
                </template>
                <template v-else-if="row.status === 'mismatch'">
                  <FaTag variant="outline" class="text-destructive qs-type-status-tag border-destructive/40">
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

    <section class="min-w-0" :aria-label="t('slhBill.comparison.findingsTitle')">
      <h2 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        {{ t('slhBill.comparison.findingsTitle') }}
        <FaTag v-if="counts.difference > 0" variant="outline" class="text-destructive qs-type-status-tag border-destructive/40">
          {{ counts.difference }}
        </FaTag>
        <FaTag v-if="counts.warning > 0" variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300">
          {{ counts.warning }}
        </FaTag>
      </h2>

      <p v-if="findings.length === 0" class="qs-type-body-medium text-emerald-700 m-0 flex gap-2 items-center dark:text-emerald-300">
        <FaIcon name="i-lucide:circle-check" aria-hidden="true" class="flex-none size-4" />
        {{ t('slhBill.comparison.noFindings', { count: lineCount }) }}
      </p>

      <div v-else class="flex flex-col gap-4 min-w-0">
        <div v-for="group in [...differenceGroups, ...warningGroups]" :key="`${group.severity}:${group.kind}`" class="min-w-0">
          <h3 class="qs-type-body-medium m-0 mb-2 flex gap-2 items-center">
            <FaIcon
              :name="group.severity === 'difference' ? 'i-lucide:triangle-alert' : 'i-lucide:info'"
              aria-hidden="true"
              class="flex-none size-4"
              :class="group.severity === 'difference' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'"
            />
            {{ t(`slhBill.finding.${group.kind}`) }}
            <span class="qs-type-meta text-muted-foreground">{{ t('slhBill.comparison.findingCount', { count: group.items.length }) }}</span>
          </h3>
          <ul class="m-0 pl-0 list-none flex flex-col gap-1.5">
            <li v-for="(item, index) in group.items" :key="index" class="qs-type-body-medium flex flex-wrap gap-2 items-baseline">
              <button
                v-if="item.lineNumber !== null"
                type="button"
                class="qs-type-meta text-primary p-0 border-0 bg-transparent underline shrink-0 cursor-pointer"
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
