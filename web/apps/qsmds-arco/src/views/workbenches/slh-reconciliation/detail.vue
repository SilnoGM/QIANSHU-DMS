<script setup lang="ts">
import type { SlhReconciliationDiffBucket, SlhReconciliationFieldComparison, SlhReconciliationMemberComparison } from './diff.logic'
import type { SlhBillFindingDto, SlhReconciliationBatchDetailDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import SlhBillOverflowText from '../slh-bills/slh-bill-overflow-text.vue'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhReconciliationComparisons,
  filterSlhReconciliationComparisons,
  resolveSlhReconciliationBucketLabelKey,
  resolveSlhReconciliationFieldLabelKey,
  resolveSlhReconciliationFieldStateLabelKey,
  resolveSlhReconciliationFindingLabelKey,
  SLH_RECONCILIATION_DIFF_BUCKETS,

} from './diff.logic'
import { resolveSlhBillLineMatchSourceLabelKey, resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const canReconcile = computed(() => auth('slh-bills:reconcile'))
const instanceId = String(route.params.id ?? '')
const batch = shallowRef<SlhReconciliationBatchDetailDto | null>(null)
const loading = ref(false)
const error = ref('')
const selected = ref<ReadonlySet<string>>(new Set())
const reconciling = ref(false)
const completing = ref(false)
const completeOpen = ref(false)
const actionError = ref('')
/** 当前筛选的差异桶；`all` 表示不筛（差异行仍会按行内徽标区分）。 */
const activeBucket = ref<SlhReconciliationDiffBucket | 'all'>('all')
/** 正在展开字段级对照的成员行；同一时刻只展开一行。 */
const compareLineId = ref('')
let controller: AbortController | null = null

const inProgress = computed(() => batch.value?.status === 'IN_PROGRESS')
/** 只有未核对的成员行可以被勾选：已核对的行不允许重复核对。 */
const selectableLineIds = computed(() => new Set((batch.value?.members ?? []).filter(member => member.reconciledAt === null).map(member => member.lineId)))
const selectedCount = computed(() => selected.value.size)
/** 本账单还剩多少行没核对完：与匹配无关，就是未对账的明细行总数。 */
const billRemaining = computed(() => {
  const row = batch.value
  return row === null ? 0 : row.bill.lineCount - row.bill.reconciledLineCount
})

/**
 * 差异判定每次读取时重算，且只算一次：筛选条计数、行徽标与 Hero 合计都取自这份结果，
 * 所以「筛出来的行数」与「计数说的行数」不会互相矛盾。
 */
const comparison = computed(() => (batch.value === null
  ? null
  : buildSlhReconciliationComparisons({ findings: batch.value.findings, members: batch.value.members })))
const summary = computed(() => comparison.value?.summary ?? null)
const memberByLineId = computed(() => new Map((batch.value?.members ?? []).map(member => [member.lineId, member])))
interface ReconciliationRow { readonly key: string, readonly comparison: SlhReconciliationMemberComparison, readonly member: SlhReconciliationBatchMemberDto }
const rows = computed<ReconciliationRow[]>(() => (comparison.value === null
  ? []
  : filterSlhReconciliationComparisons(comparison.value.members, activeBucket.value)
      .map(item => ({ comparison: item, key: item.lineId, member: memberByLineId.value.get(item.lineId)! }))))
const bucketFilters = computed(() => {
  const counts = summary.value?.bucketLineCounts
  return [
    { count: summary.value?.linesWithDifference ?? 0, key: 'all' as const },
    ...SLH_RECONCILIATION_DIFF_BUCKETS.map(bucket => ({ count: counts?.[bucket] ?? 0, key: bucket })),
  ]
})
const compareRow = computed(() => rows.value.find(row => row.comparison.lineId === compareLineId.value)
  ?? (comparison.value?.members ?? []).map(item => ({ comparison: item, key: item.lineId, member: memberByLineId.value.get(item.lineId)! })).find(row => row.comparison.lineId === compareLineId.value)
  ?? null)
/** 费用出入只认导入快照：本批次的行级条目 + 账单级条目，两者分开计数，避免口径混用。 */
interface FindingRow { readonly key: string, readonly finding: SlhBillFindingDto, readonly lineNumber: number | null }
const feeFindings = computed<FindingRow[]>(() => {
  const result: FindingRow[] = []
  const memberLines = new Set((batch.value?.members ?? []).map(member => member.lineNumber))
  for (const [index, finding] of (batch.value?.findings ?? []).entries()) {
    // 账单级条目（没有行号）不属于任何成员行，只计数不混进本批次的表里。
    const lineNumber = finding.lineNumber
    if (lineNumber === null || lineNumber === undefined || !memberLines.has(lineNumber)) {
      continue
    }
    result.push({ finding, key: `${finding.kind}-${lineNumber}-${index}`, lineNumber })
  }
  return result
})

const columns = computed<QsGenericTableColumn<ReconciliationRow>[]>(() => [
  { id: 'select', title: '', width: 56, minWidth: 56 },
  { id: 'lineNumber', title: t('slhReconciliation.detail.billLineNumber'), width: 110, minWidth: 110 },
  { id: 'identity', title: t('slhReconciliation.detail.field.shippingMark'), minWidth: 170 },
  { id: 'goodsName', title: t('slhReconciliation.detail.field.goodsName'), minWidth: 180 },
  { id: 'cod', title: t('slhReconciliation.detail.heroCodDifference'), minWidth: 240, align: 'right' },
  { id: 'quantity', title: t('slhReconciliation.detail.bucket.QUANTITY'), minWidth: 170 },
  { id: 'fee', title: t('slhReconciliation.detail.bucket.FEE'), minWidth: 130 },
  { id: 'buckets', title: t('slhReconciliation.detail.filterAll'), minWidth: 170 },
  { id: 'status', title: t('slhReconciliation.detail.reconciledAt'), minWidth: 150 },
])
const feeColumns = computed<QsGenericTableColumn<FindingRow>[]>(() => [
  { id: 'kind', title: t('slhReconciliation.detail.feeKind'), minWidth: 170 },
  { id: 'line', title: t('slhReconciliation.detail.billLineNumber'), width: 100, minWidth: 100 },
  { id: 'message', title: t('slhReconciliation.detail.feeMessage'), minWidth: 320 },
  { id: 'severity', title: t('slhReconciliation.detail.severityTitle'), width: 110, minWidth: 110 },
])

async function load(): Promise<void> {
  controller?.abort()
  if (!canReconcile.value) {
    batch.value = null
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhReconciliationBatchesApi.get(instanceId, current.signal)
    if (current.signal.aborted || !canReconcile.value) {
      return
    }
    batch.value = response.data
    // 刷新后只保留仍然可核对的选择，避免把已核对的行带进下一次提交。
    selected.value = new Set([...selected.value].filter(lineId => selectableLineIds.value.has(lineId)))
    if (compareLineId.value !== '' && !response.data.members.some(member => member.lineId === compareLineId.value)) {
      compareLineId.value = ''
    }
  }
  catch (failure) {
    if (!current.signal.aborted) {
      batch.value = null
      error.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

function toggle(lineId: string, checked: boolean): void {
  if (!selectableLineIds.value.has(lineId)) {
    return
  }
  const next = new Set(selected.value)
  if (checked) {
    next.add(lineId)
  }
  else {
    next.delete(lineId)
  }
  selected.value = next
}

/** 行点击展开字段级对照；复选框与按钮的点击不触发展开。 */
function toggleCompare(row: ReconciliationRow): void {
  compareLineId.value = compareLineId.value === row.comparison.lineId ? '' : row.comparison.lineId
}

/** 只对差异行做底色提示：一致的行保持白底，扫读时差异自己会浮出来。 */
function rowClass(row: { original: ReconciliationRow }): string {
  return row.original.comparison.buckets.length > 0 ? '[&>td]:bg-destructive/5' : ''
}

function fieldDifferenceText(field: SlhReconciliationFieldComparison): string {
  if (field.state === 'ABSENT') {
    return t('slhReconciliation.detail.fieldState.ABSENT')
  }
  return field.difference ?? t('slhReconciliation.detail.fieldState.DIFFERENT')
}

function quantitySummary(row: ReconciliationRow): SlhReconciliationFieldComparison[] {
  return row.comparison.fields.filter(field => field.bucket === 'QUANTITY' && field.state !== 'SAME' && field.state !== 'BOTH_ABSENT')
}

/** 核对是整批语义：任一行不再合格就一行都不写，错误里带行号与原因。 */
async function reconcile(): Promise<void> {
  if (!inProgress.value || selectedCount.value === 0 || reconciling.value) {
    return
  }
  reconciling.value = true
  actionError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.reconcile(instanceId, { lineIds: [...selected.value] }, new AbortController().signal)
    batch.value = response.data
    selected.value = new Set()
    toast.success(t('slhReconciliation.detail.reconciled', { count: response.data.reconciledMemberCount }))
  }
  catch (failure) {
    actionError.value = containerFailure(failure).message
    await load()
  }
  finally {
    reconciling.value = false
  }
}

async function complete(): Promise<void> {
  if (!inProgress.value || completing.value) {
    return
  }
  completing.value = true
  actionError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.complete(instanceId, new AbortController().signal)
    batch.value = response.data
    completeOpen.value = false
    selected.value = new Set()
    toast.success(t('slhReconciliation.detail.completed'))
  }
  catch (failure) {
    actionError.value = containerFailure(failure).message
    completeOpen.value = false
    await load()
  }
  finally {
    completing.value = false
  }
}

watch([canReconcile, () => accountStore.authEpoch, instanceId], () => {
  void load()
}, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      main-class="min-w-0"
      default-class="w-full min-w-0 sm:w-auto"
      :title="batch ? `${batch.batchNo} · ${t('slhReconciliation.detail.title')}` : t('slhReconciliation.detail.title')"
    >
      <template #description>
        <span v-if="batch" class="qs-type-description text-muted-foreground flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" class="qs-type-status-tag" :class="resolveSlhReconciliationBatchTone(batch.status)">
            {{ t(resolveSlhReconciliationBatchLabelKey(batch.status)) }}
          </FaTag>
          <span class="font-mono">{{ batch.bill.slhBillNo }}</span>
          <span>{{ batch.bill.billName }}</span>
          <span>{{ batch.bill.periodStart }} ~ {{ batch.bill.periodEnd }}</span>
          <SlhBillReconciliationStatusTag :status="batch.bill.reconciliationStatus" />
        </span>
      </template>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="router.push({ name: 'qsFinanceBillReconciliationSlhBillReconciliation' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhBill.back') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canReconcile">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('slhBill.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else-if="error" class="min-w-0">
      <FaAlert variant="destructive" role="alert" :title="error" />
      <FaButton class="mt-3" variant="outline" @click="load">
        {{ t('slhBill.retry') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain v-else class="min-w-0 space-y-4">
      <div v-if="loading && !batch" class="animate-pulse space-y-3" aria-hidden="true">
        <div class="rounded-lg bg-muted/40 h-20" />
        <div class="rounded-lg bg-muted/40 h-64" />
      </div>
      <template v-else-if="batch && summary">
        <!-- 代收款是唯一两侧都有原始值的金额字段，所以差额只在这里给；两个合计不可直接相减。 -->
        <section class="border rounded-lg">
          <h2 class="qs-type-component-title px-4 py-2.5 border-b">
            {{ t('slhReconciliation.detail.heroCodDifference') }}
          </h2>
          <dl class="p-4 gap-4 grid lg:grid-cols-3 sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-label text-muted-foreground">
                {{ t('slhReconciliation.detail.heroCodDifference') }}
              </dt>
              <dd class="text-2xl text-destructive font-semibold m-0 tabular-nums">
                {{ t('slhReconciliation.detail.heroCodDifferenceValue', { count: summary.codDifferentCount + summary.codConflictCount }) }}
              </dd>
              <p class="qs-type-description text-muted-foreground m-0 mt-1">
                {{ t('slhReconciliation.detail.heroCodDifferenceHint', { conflict: summary.codConflictCount }) }}
              </p>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-label text-muted-foreground">
                {{ t('slhReconciliation.detail.heroCodDifferenceTotal') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay
                  v-if="summary.codDifferenceTotal !== null"
                  :value="summary.codDifferenceTotal"
                  currency="TWD"
                  :currencies="currencyCatalog.currencies.value"
                  class="text-2xl text-destructive font-semibold"
                />
                <span v-else class="qs-type-data-emphasis text-muted-foreground">{{ t('slhReconciliation.detail.diffNone') }}</span>
              </dd>
              <p class="qs-type-description text-muted-foreground m-0 mt-1">
                {{ t('slhReconciliation.detail.heroCodDifferenceTotalHint') }}
              </p>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-label text-muted-foreground">
                {{ t('slhReconciliation.detail.heroCodTotals') }}
              </dt>
              <dd class="qs-type-data-emphasis m-0 tabular-nums">
                {{ t('slhReconciliation.detail.heroCodTotalsValue', { bill: summary.billCodTotal, container: summary.containerCodTotal }) }}
              </dd>
              <p class="qs-type-description text-muted-foreground m-0 mt-1">
                {{ t('slhReconciliation.detail.heroCodTotalsHint') }}
              </p>
            </div>
          </dl>
        </section>

        <!-- 每类差异都有自己的计数与筛选入口：参考项同样入列，不隐藏、不合并。 -->
        <section class="border rounded-lg">
          <div class="px-4 py-3 flex flex-wrap gap-2 items-center">
            <FaButton
              v-for="filter in bucketFilters"
              :key="filter.key"
              type="button"
              size="sm"
              :variant="activeBucket === filter.key ? 'default' : 'outline'"
              class="qs-type-status-tag"
              @click="activeBucket = filter.key"
            >
              {{ filter.key === 'all' ? t('slhReconciliation.detail.filterAll') : t(resolveSlhReconciliationBucketLabelKey(filter.key)) }}
              <span class="tabular-nums">{{ filter.count }}</span>
            </FaButton>
            <span class="qs-type-description text-muted-foreground">{{ t('slhReconciliation.detail.recipientNote') }}</span>
          </div>
        </section>

        <FaAlert v-if="actionError" variant="destructive" role="alert" :title="actionError" />

        <div v-if="inProgress" class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-description text-muted-foreground">
            {{ t('slhReconciliation.detail.selected', { count: selectedCount }) }}
          </span>
          <div class="flex-1" />
          <FaButton type="button" class="w-full sm:w-auto" :loading="reconciling" :disabled="selectedCount === 0 || reconciling" @click="reconcile">
            {{ t('slhReconciliation.detail.reconcile') }}
          </FaButton>
          <FaButton type="button" variant="outline" class="w-full sm:w-auto" :disabled="reconciling" @click="completeOpen = true">
            {{ t('slhReconciliation.detail.complete') }}
          </FaButton>
        </div>

        <!-- 只展示创建时匹配命中的成员行：账单其他行不会出现在这里。 -->
        <QsGenericTable
          row-key="key"
          table-class="w-max min-w-full"
          :columns="columns"
          :data="rows"
          :total="rows.length"
          :searchable="false"
          :addable="false"
          :show-column-settings="false"
          :page-size="50"
          :row-class="rowClass"
          :empty-title="t('slhReconciliation.detail.emptyMembers')"
          @row-click="toggleCompare"
        >
          <template #cell-select="{ row }">
            <FaCheckbox
              v-if="row.original.member.reconciledAt === null && inProgress"
              class="justify-center"
              :model-value="selected.has(row.original.member.lineId)"
              :aria-label="t('slhReconciliation.detail.selectLine', { line: row.original.member.lineNumber })"
              @update:model-value="(value: unknown) => toggle(row.original.member.lineId, value === true)"
            />
            <span v-else class="text-muted-foreground text-center block" aria-hidden="true">—</span>
          </template>
          <template #cell-lineNumber="{ row }">
            <div class="flex gap-1 items-center">
              <FaIcon
                :name="compareLineId === row.original.comparison.lineId ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'"
                aria-hidden="true"
                class="text-muted-foreground"
              />
              <span class="tabular-nums">{{ row.original.member.lineNumber }}</span>
              <span class="text-muted-foreground font-mono">{{ row.original.member.matchSource === 'MARK' ? `(${t(resolveSlhBillLineMatchSourceLabelKey('MARK'))})` : '' }}</span>
            </div>
          </template>
          <template #cell-identity="{ row }">
            <QsTableStackedCell>
              <QsTableStackedLine content-class="font-mono">
                <SlhBillOverflowText :text="row.original.member.matchedContainerBatchName" />
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ row.original.member.shippingMarkText ?? row.original.member.warehouseReceiptReference ?? t('slhReconciliation.detail.absentValue') }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-goodsName="{ row }">
            <!-- 宽度靠外层 max-w 限制：组件根节点不继承 class，直接给组件加类不生效。 -->
            <span class="max-w-[180px] block">
              <SlhBillOverflowText :text="row.original.member.goodsName" />
            </span>
          </template>
          <template #cell-cod="{ row }">
            <div class="flex flex-col gap-0.5 items-end">
              <div class="flex gap-1.5 items-baseline tabular-nums">
                <AmountDisplay :value="row.original.member.codAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                <span class="text-muted-foreground" aria-hidden="true">↔</span>
                <AmountDisplay :value="row.original.comparison.cod.container" currency="TWD" :currencies="currencyCatalog.currencies.value" />
              </div>
              <span v-if="row.original.comparison.cod.state === 'DIFFERENT'" class="text-destructive qs-type-status-tag tabular-nums">
                {{ fieldDifferenceText(row.original.comparison.cod) }}
              </span>
              <span v-else-if="row.original.comparison.cod.state === 'ABSENT'" class="text-destructive qs-type-status-tag">
                {{ t('slhReconciliation.detail.fieldState.ABSENT') }}
              </span>
              <span v-else class="qs-type-description text-muted-foreground">
                {{ t(resolveSlhReconciliationFieldStateLabelKey(row.original.comparison.cod.state)) }}
              </span>
            </div>
          </template>
          <template #cell-quantity="{ row }">
            <div class="flex flex-wrap gap-1">
              <FaTag
                v-for="field in quantitySummary(row.original)"
                :key="field.field"
                variant="outline"
                class="text-amber-700 qs-type-status-tag border-amber-500/40 dark:text-amber-300"
              >
                {{ t(resolveSlhReconciliationFieldLabelKey(field.field)) }} {{ fieldDifferenceText(field) }}
              </FaTag>
              <span v-if="quantitySummary(row.original).length === 0" class="qs-type-description text-muted-foreground">
                {{ t(resolveSlhReconciliationFieldStateLabelKey('SAME')) }}
              </span>
            </div>
          </template>
          <template #cell-fee="{ row }">
            <FaTag
              v-if="row.original.comparison.findings.length > 0"
              variant="outline"
              class="qs-type-status-tag"
              :class="row.original.comparison.findings.some(finding => finding.severity === 'difference') ? 'border-red-500/40 text-red-700 dark:text-red-300' : 'border-amber-500/40 text-amber-700 dark:text-amber-300'"
            >
              {{ row.original.comparison.findings.length }}
            </FaTag>
            <span v-else class="qs-type-description text-muted-foreground">{{ t('slhReconciliation.detail.diffNone') }}</span>
          </template>
          <template #cell-buckets="{ row }">
            <div class="flex flex-wrap gap-1">
              <FaTag
                v-for="bucket in row.original.comparison.buckets"
                :key="bucket"
                variant="outline"
                class="qs-type-status-tag"
                :class="bucket === 'COD' ? 'border-red-500/40 text-red-700 dark:text-red-300' : bucket === 'FEE' ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : undefined"
              >
                {{ t(resolveSlhReconciliationBucketLabelKey(bucket)) }}
              </FaTag>
              <span v-if="row.original.comparison.buckets.length === 0" class="qs-type-description text-muted-foreground">
                {{ t('slhReconciliation.detail.diffNone') }}
              </span>
            </div>
          </template>
          <template #cell-status="{ row }">
            <QsTableStackedCell>
              <QsPersonDisplay v-if="row.original.member.reconciledByDisplayName" :display-name="row.original.member.reconciledByDisplayName" size="sm" />
              <DateTimeDisplay v-if="row.original.member.reconciledAt" :value="row.original.member.reconciledAt" />
              <span v-else class="text-muted-foreground">{{ t('slhReconciliation.detail.notReconciledYet') }}</span>
            </QsTableStackedCell>
          </template>
        </QsGenericTable>

        <!-- 字段级对照：点行展开，一致项与不涉及项同样列出，方便逐项看完再确认核对。 -->
        <section v-if="compareRow" class="border rounded-lg">
          <div class="px-4 py-2.5 border-b flex flex-wrap gap-2 items-center">
            <h2 class="qs-type-component-title">
              {{ t('slhReconciliation.detail.fieldCompareTitle', { line: compareRow.member.lineNumber }) }}
            </h2>
            <span class="qs-type-description text-muted-foreground">{{ t('slhReconciliation.detail.fieldCompareHint') }}</span>
            <div class="flex-1" />
            <FaButton type="button" size="sm" variant="ghost" @click="compareLineId = ''">
              {{ t('slhReconciliation.detail.closeCompare') }}
            </FaButton>
          </div>
          <div class="overflow-x-auto">
            <table class="text-sm w-full">
              <thead>
                <tr class="text-muted-foreground bg-muted/40">
                  <th class="font-normal px-4 py-2 text-left">
                    {{ t('slhReconciliation.detail.fieldName') }}
                  </th>
                  <th class="font-normal px-4 py-2 text-left">
                    {{ batch.bill.billName }}
                  </th>
                  <th class="font-normal px-4 py-2 text-left">
                    {{ compareRow.member.matchedContainerBatchName }}
                  </th>
                  <th class="font-normal px-4 py-2 text-left">
                    {{ t('slhReconciliation.detail.severityDifference') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="field in compareRow.comparison.fields"
                  :key="field.field"
                  class="border-t"
                  :class="field.state === 'DIFFERENT' ? 'bg-destructive/5' : field.state === 'ABSENT' ? 'bg-amber-500/5' : undefined"
                >
                  <td class="text-muted-foreground px-4 py-2">
                    {{ t(resolveSlhReconciliationFieldLabelKey(field.field)) }}
                  </td>
                  <td class="px-4 py-2 tabular-nums">
                    {{ field.bill ?? t('slhReconciliation.detail.absentValue') }}
                  </td>
                  <td class="px-4 py-2 tabular-nums">
                    {{ field.container ?? t('slhReconciliation.detail.absentValue') }}
                  </td>
                  <td class="px-4 py-2 tabular-nums" :class="field.state === 'DIFFERENT' ? 'text-destructive' : undefined">
                    {{ field.state === 'SAME' ? t('slhReconciliation.detail.fieldState.SAME') : fieldDifferenceText(field) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="qs-type-description text-muted-foreground m-0 px-4 py-2 border-t">
            {{ t('slhReconciliation.detail.evidence') }}：
            {{ t('slhReconciliation.detail.evidenceValue', {
              row: compareRow.member.sourceRowNumber,
              container: compareRow.member.matchedContainerBatchName,
              itemLine: compareRow.member.matchedLoadingItemLineNumber,
            }) }}
          </p>
        </section>

        <section class="border rounded-lg">
          <div class="px-4 py-2.5 border-b flex flex-wrap gap-2 items-center">
            <h2 class="qs-type-component-title">
              {{ t('slhReconciliation.detail.feeTitle') }}
            </h2>
            <div class="flex-1" />
            <span class="qs-type-description text-muted-foreground">
              {{ t('slhReconciliation.detail.feeScope', { batch: summary.batchFindingCount, bill: summary.billFindingCount }) }}
            </span>
          </div>
          <QsGenericTable
            row-key="key"
            table-class="w-max min-w-full"
            :columns="feeColumns"
            :data="feeFindings"
            :total="feeFindings.length"
            :searchable="false"
            :addable="false"
            :show-column-settings="false"
            :show-pagination="false"
            :empty-title="t('slhReconciliation.detail.feeEmpty')"
          >
            <template #cell-kind="{ row }">
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ t(resolveSlhReconciliationFindingLabelKey(row.original.finding.kind)) }}
              </FaTag>
            </template>
            <template #cell-line="{ row }">
              <span class="tabular-nums">{{ row.original.lineNumber ?? '—' }}</span>
            </template>
            <template #cell-message="{ row }">
              <span class="max-w-[520px] block">{{ row.original.finding.message }}</span>
            </template>
            <template #cell-severity="{ row }">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="row.original.finding.severity === 'difference' ? 'border-red-500/40 text-red-700 dark:text-red-300' : 'border-amber-500/40 text-amber-700 dark:text-amber-300'"
              >
                {{ row.original.finding.severity === 'difference' ? t('slhReconciliation.detail.severityDifference') : t('slhReconciliation.detail.severityWarning') }}
              </FaTag>
            </template>
          </QsGenericTable>
          <p v-if="summary.billFindingCount > summary.batchFindingCount" class="qs-type-description text-muted-foreground m-0 px-4 py-2">
            {{ t('slhReconciliation.detail.feeOutside', {
              count: summary.billFindingCount - summary.batchFindingCount,
              billLevel: comparison ? comparison.billLevelFindings.length : 0,
            }) }}
          </p>
        </section>

        <div class="px-4 py-3 border rounded-lg flex flex-wrap gap-3 items-center">
          <span class="qs-type-data-emphasis tabular-nums">
            {{ t('slhReconciliation.detail.memberProgress') }} {{ batch.reconciledMemberCount }} / {{ batch.memberCount }}
          </span>
          <span class="qs-type-description text-muted-foreground tabular-nums">
            {{ t('slhReconciliation.detail.remainingMembers', { count: summary.pendingMemberCount }) }}
          </span>
          <span class="qs-type-description text-muted-foreground tabular-nums">
            {{ t('slhReconciliation.detail.billRemaining') }} {{ billRemaining }}
          </span>
          <div class="flex-1" />
          <QsPersonDisplay :display-name="batch.createdByDisplayName" size="sm" />
          <DateTimeDisplay :value="batch.createdAt" />
        </div>
      </template>
    </FaPageMain>

    <!-- 结束是不可逆的：剩余未核对的行留到下一轮重新匹配，所以要先说清楚。 -->
    <QsGenericModal
      v-model="completeOpen"
      :title="t('slhReconciliation.detail.completeTitle')"
      size="sm"
      :submitting="completing"
    >
      <p class="qs-type-description text-muted-foreground m-0">
        {{ t('slhReconciliation.detail.completeHint', { remaining: batch ? batch.memberCount - batch.reconciledMemberCount : 0 }) }}
      </p>
      <template #footer>
        <div class="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
          <FaButton type="button" variant="outline" class="w-full sm:w-auto" :disabled="completing" @click="completeOpen = false">
            {{ t('slhBill.cancel') }}
          </FaButton>
          <FaButton type="button" class="w-full sm:w-auto" :loading="completing" @click="complete">
            {{ t('slhReconciliation.detail.completeConfirm') }}
          </FaButton>
        </div>
      </template>
    </QsGenericModal>
  </div>
</template>
