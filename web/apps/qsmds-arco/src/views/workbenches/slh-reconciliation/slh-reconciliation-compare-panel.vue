<script setup lang="ts">
import type {
  SlhReconciliationFieldComparison,
  SlhReconciliationFieldTotal,
  SlhReconciliationRow,
} from './diff.logic'
import {
  resolveSlhReconciliationFieldLabelKey,
  resolveSlhReconciliationFieldStateLabelKey,
  resolveSlhReconciliationFindingLabelKey,
  resolveSlhReconciliationUnitLabelKey,
} from './diff.logic'

/**
 * 对照面板：只渲染当前选中的那一条成员行。
 *
 * 顺序与权重都是中性的：不一致的字段按账单原表列序在前，一致/都不涉及折叠在后，
 * 费用条目独立分区，底部是「按字段净差」小结（代收款、箱数、毛重、材积各算各的，
 * 不给金额特例）与依据。四个桶、各类字段之间没有主次。
 */
const props = defineProps<{
  row: SlhReconciliationRow | null
  fieldTotals: readonly SlhReconciliationFieldTotal[]
  batchFindingCount: number
  billFindingCount: number
  inProgress: boolean
  /** 本行是否可核对：批次进行中且本行未核对过。 */
  reconcilable: boolean
  hasNextDifference: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'reconcile', lineId: string): void
  (event: 'next'): void
}>()

const { t } = useI18n()
const consistencyOpen = ref(false)
const netDetailOpen = ref(false)
/** 每个字段都没有可比行（全是单侧不涉及）时，净差小结压缩成一行结论。 */
const allTotalsAbsent = computed(() => props.fieldTotals.length > 0 && props.fieldTotals.every(total => total.total === null))

const inconsistent = computed(() => (props.row?.comparison.fields ?? []).filter(field => field.state === 'DIFFERENT' || field.state === 'ABSENT'))
const consistent = computed(() => (props.row?.comparison.fields ?? []).filter(field => field.state === 'SAME' || field.state === 'BOTH_ABSENT'))

function fieldLabel(field: SlhReconciliationFieldComparison): string {
  return t(resolveSlhReconciliationFieldLabelKey(field.field))
}

function stateLabel(field: SlhReconciliationFieldComparison): string {
  if (field.state === 'DIFFERENT') {
    return field.difference ?? t(resolveSlhReconciliationFieldStateLabelKey('DIFFERENT'))
  }
  return t(resolveSlhReconciliationFieldStateLabelKey(field.state))
}

/** 单侧不涉及没有两个数可减，用固定槽位说清楚，而不是留空或显示短横。 */
function sideValue(value: string | null): string {
  return value ?? t('slhReconciliation.detail.absentValue')
}

function totalText(total: SlhReconciliationFieldTotal): string {
  return total.total === null ? t('slhReconciliation.detail.netUnavailable') : `${total.total} ${t(resolveSlhReconciliationUnitLabelKey(total.field))}`
}
</script>

<template>
  <section class="border rounded-lg bg-background flex flex-col min-h-0">
    <div v-if="row === null" class="qs-type-description text-muted-foreground p-6 text-center">
      {{ t('slhReconciliation.detail.panelEmpty') }}
    </div>
    <template v-else>
      <header class="px-3 py-2 border-b flex gap-2 items-start">
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="qs-type-component-title m-0">
              {{ t('slhReconciliation.detail.panelTitle', { line: row.comparison.lineNumber }) }}
            </span>
            <FaTag variant="outline" class="font-mono qs-type-status-tag">
              {{ row.member.matchedContainerBatchName }}
            </FaTag>
            <span class="qs-type-description text-muted-foreground truncate">{{ row.member.goodsName }}</span>
          </div>
          <p class="qs-type-description text-muted-foreground m-0 mt-1">
            {{ t('slhReconciliation.detail.evidenceValue', {
              row: row.member.sourceRowNumber,
              container: row.member.matchedContainerBatchName,
              itemLine: row.member.matchedLoadingItemLineNumber,
            }) }}
          </p>
        </div>
        <FaButton type="button" size="sm" variant="ghost" @click="emit('close')">
          <FaIcon name="i-lucide:x" aria-hidden="true" />
          <span class="sr-only">{{ t('slhReconciliation.detail.closeCompare') }}</span>
        </FaButton>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto">
        <!-- 不一致在前：不是给它们特权，而是页面存在的意义就是把这些挑出来。 -->
        <div class="px-3 py-2 border-b">
          <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
            {{ t('slhReconciliation.detail.panelInconsistent') }}
            <span class="text-destructive tabular-nums">{{ inconsistent.length }}</span>
          </h3>
          <p v-if="inconsistent.length === 0" class="qs-type-description text-muted-foreground m-0 mt-1">
            {{ t('slhReconciliation.detail.diffNone') }}
          </p>
          <ul v-else class="m-0 mt-2 p-0 list-none space-y-1.5">
            <li
              v-for="field in inconsistent"
              :key="field.field"
              class="px-2 py-1.5 rounded-md sm:gap-x-2 sm:grid sm:grid-cols-[minmax(6rem,auto)_1fr_auto] sm:items-baseline"
              :class="field.state === 'DIFFERENT' ? 'bg-destructive/5' : 'bg-muted/40'"
            >
              <span class="flex gap-2 items-baseline justify-between">
                <span class="qs-type-description text-muted-foreground">{{ fieldLabel(field) }}</span>
                <!-- 窄屏把状态提到标签行：三列网格在 320px 下会把取值列压成竖排。 -->
                <span class="qs-type-status-tag tabular-nums sm:hidden" :class="field.state === 'DIFFERENT' ? 'text-destructive' : 'text-muted-foreground'">
                  {{ stateLabel(field) }}
                </span>
              </span>
              <span class="mt-0.5 flex flex-wrap gap-1.5 items-baseline tabular-nums sm:mt-0">
                <span>{{ sideValue(field.bill) }}</span>
                <span class="text-muted-foreground" aria-hidden="true">↔</span>
                <span>{{ sideValue(field.container) }}</span>
              </span>
              <span class="qs-type-status-tag hidden tabular-nums sm:inline-flex" :class="field.state === 'DIFFERENT' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'">
                {{ stateLabel(field) }}
              </span>
            </li>
          </ul>
        </div>

        <!-- 费用条目：形态与字段对照不同，独立分区但同等显眼。 -->
        <div v-if="row.comparison.findings.length > 0" class="px-3 py-2 border-b">
          <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
            {{ t('slhReconciliation.detail.bucket.FEE') }}
            <span class="tabular-nums">{{ row.comparison.findings.length }}</span>
            <div class="flex-1" />
            <span class="qs-type-description text-muted-foreground font-normal">
              {{ t('slhReconciliation.detail.feeScope', { batch: batchFindingCount, bill: billFindingCount }) }}
            </span>
          </h3>
          <ul class="m-0 mt-2 p-0 list-none space-y-1.5">
            <li v-for="finding in row.comparison.findings" :key="`${finding.kind}-${finding.sourceRowNumber ?? 'x'}-${finding.message}`" class="flex gap-2 items-start">
              <FaTag variant="outline" class="qs-type-status-tag shrink-0">
                {{ t(resolveSlhReconciliationFindingLabelKey(finding.kind)) }}
              </FaTag>
              <span class="qs-type-description min-w-0">{{ finding.message }}</span>
              <div class="flex-1" />
              <span class="qs-type-description whitespace-nowrap" :class="finding.severity === 'difference' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'">
                {{ finding.severity === 'difference' ? t('slhReconciliation.detail.severityDifference') : t('slhReconciliation.detail.severityWarning') }}
              </span>
            </li>
          </ul>
        </div>

        <div class="px-3 py-2 border-b">
          <button type="button" class="text-left flex gap-2 w-full items-center" @click="consistencyOpen = !consistencyOpen">
            <FaIcon :name="consistencyOpen ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'" aria-hidden="true" class="text-muted-foreground" />
            <span class="qs-type-component-title">{{ t('slhReconciliation.detail.panelConsistent') }}</span>
            <span class="qs-type-description text-muted-foreground tabular-nums">{{ consistent.length }}</span>
          </button>
          <ul v-if="consistencyOpen" class="m-0 mt-2 p-0 list-none space-y-1">
            <li v-for="field in consistent" :key="field.field" class="px-2 gap-x-2 grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-baseline">
              <span class="qs-type-description text-muted-foreground">{{ fieldLabel(field) }}</span>
              <span class="qs-type-description flex flex-wrap gap-1.5 items-baseline tabular-nums">
                <span>{{ sideValue(field.bill) }}</span>
                <span class="text-muted-foreground" aria-hidden="true">↔</span>
                <span>{{ sideValue(field.container) }}</span>
              </span>
              <span class="qs-type-description text-muted-foreground">{{ stateLabel(field) }}</span>
            </li>
          </ul>
        </div>

        <!-- 净差小结：按字段各算各的，金额不再是唯一有合计的量；逐件尺寸不参与累加。 -->
        <div class="px-3 py-2">
          <h3 class="qs-type-component-title m-0">
            {{ t('slhReconciliation.detail.netTitle') }}
          </h3>
          <p class="qs-type-description text-muted-foreground m-0 mt-0.5">
            {{ t('slhReconciliation.detail.netHint') }}
          </p>
          <!-- 没有可计算净差时只留一行结论，字段明细进折叠：空着三行「—」既占位又像功能失效。 -->
          <template v-if="allTotalsAbsent">
            <p class="qs-type-description text-muted-foreground m-0 mt-1">
              {{ t('slhReconciliation.detail.netAllAbsent') }}
            </p>
            <button type="button" class="qs-type-description mt-1 flex gap-1 items-center" @click="netDetailOpen = !netDetailOpen">
              <FaIcon :name="netDetailOpen ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'" aria-hidden="true" class="text-muted-foreground" />
              {{ t('slhReconciliation.detail.netDetail') }}
            </button>
          </template>
          <p v-else-if="fieldTotals.length === 0" class="qs-type-description text-muted-foreground m-0 mt-1">
            {{ t('slhReconciliation.detail.netEmpty') }}
          </p>
          <ul v-if="fieldTotals.length > 0 && (!allTotalsAbsent || netDetailOpen)" class="m-0 mt-2 p-0 list-none space-y-1">
            <li v-for="total in fieldTotals" :key="total.field" class="flex flex-wrap gap-2 items-baseline">
              <span class="qs-type-description text-muted-foreground min-w-24">{{ t(resolveSlhReconciliationFieldLabelKey(total.field)) }}</span>
              <span class="tabular-nums" :class="total.total === null ? 'text-muted-foreground' : undefined">{{ totalText(total) }}</span>
              <span class="qs-type-description text-muted-foreground">
                {{ t('slhReconciliation.detail.netComputed', { count: total.computedCount }) }}
                <template v-if="total.absentCount > 0">· {{ t('slhReconciliation.detail.netAbsent', { count: total.absentCount }) }}</template>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <footer class="px-3 py-2 border-t flex flex-wrap gap-2">
        <FaButton v-if="inProgress" type="button" size="sm" :disabled="!reconcilable" @click="emit('reconcile', row.key)">
          {{ t('slhReconciliation.detail.reconcileLine') }}
        </FaButton>
        <div class="flex-1" />
        <FaButton type="button" size="sm" variant="outline" :disabled="!hasNextDifference" @click="emit('next')">
          {{ t('slhReconciliation.detail.nextDifference') }}
          <FaIcon name="i-lucide:chevron-right" aria-hidden="true" />
        </FaButton>
      </footer>
    </template>
  </section>
</template>
