<script setup lang="ts">
import type { SlhReconciliationDiffBucket, SlhReconciliationGroupMode, SlhReconciliationSortMode } from './diff.logic'
import type { SlhReconciliationBatchDetailDto } from '@/api/generated/types.gen'
import { useMediaQuery } from '@vueuse/core'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhReconciliationComparisons,
  buildSlhReconciliationRows,
  filterSlhReconciliationComparisons,
  filterSlhReconciliationDifferences,
  groupSlhReconciliationRowsByBucket,
  nextSlhReconciliationDifferenceLineId,
  resolveSlhReconciliationBucketLabelKey,
  SLH_RECONCILIATION_BUCKET_GROUP_THRESHOLD,
  SLH_RECONCILIATION_DIFF_BUCKETS,
  sortSlhReconciliationComparisons,
} from './diff.logic'
import SlhReconciliationComparePanel from './slh-reconciliation-compare-panel.vue'
import SlhReconciliationLineList from './slh-reconciliation-line-list.vue'
import { resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
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
/** 当前筛选的桶；再点一次同一个桶即清空（概览里因此不必常驻一个「全部」）。 */
const activeBucket = ref<SlhReconciliationDiffBucket | 'all'>('all')
const userSortMode = ref<SlhReconciliationSortMode | null>(null)
const userGroupMode = ref<SlhReconciliationGroupMode | null>(null)
const differencesOnly = ref(false)
const selectedLineId = ref('')
/** 中屏抽屉与窄屏全屏对照的开关；关掉只隐藏面板，不丢选中行。 */
const panelOpen = ref(false)
let controller: AbortController | null = null

/**
 * 三档断点：≥1440 清单与对照并排；1024–1439 对照进右侧抽屉；
 * <1024 对照独占一屏（返回后仍保留筛选、排序与选中行）。
 */
const isNarrow = useMediaQuery('(max-width: 1023px)')
const isCompact = useMediaQuery('(max-width: 1439px)')

const inProgress = computed(() => batch.value?.status === 'IN_PROGRESS')
const selectableLineIds = computed(() => new Set((batch.value?.members ?? []).filter(member => member.reconciledAt === null).map(member => member.lineId)))
const selectedCount = computed(() => selected.value.size)
const billRemaining = computed(() => {
  const row = batch.value
  return row === null ? 0 : row.bill.lineCount - row.bill.reconciledLineCount
})

/** 差异判定只算一次：概览计数、清单徽标与净差小结共用这份结果。 */
const comparison = computed(() => (batch.value === null
  ? null
  : buildSlhReconciliationComparisons({ findings: batch.value.findings, members: batch.value.members })))
const summary = computed(() => comparison.value?.summary ?? null)
/** 排序模式默认「不一致优先」，分组在成员行较多时默认打开；两者都可被用户覆盖。 */
const sortMode = computed<SlhReconciliationSortMode>(() => userSortMode.value ?? 'DIFFERENCE_FIRST')
const groupMode = computed<SlhReconciliationGroupMode>(() => userGroupMode.value
  ?? ((batch.value?.members.length ?? 0) >= SLH_RECONCILIATION_BUCKET_GROUP_THRESHOLD ? 'BUCKET' : 'NONE'))

const sortedComparisons = computed(() => (comparison.value === null ? [] : sortSlhReconciliationComparisons(comparison.value.members, sortMode.value)))
const visibleComparisons = computed(() => {
  const byBucket = filterSlhReconciliationComparisons(sortedComparisons.value, activeBucket.value)
  return differencesOnly.value ? filterSlhReconciliationDifferences(byBucket) : byBucket
})
const rows = computed(() => buildSlhReconciliationRows(batch.value?.members ?? [], visibleComparisons.value))
const groups = computed(() => (groupMode.value === 'BUCKET' ? groupSlhReconciliationRowsByBucket(rows.value) : []))
/** 选中行取自未筛选的全集：筛选把某行藏起来时，面板不应该跟着空掉。 */
const selectedRow = computed(() => buildSlhReconciliationRows(batch.value?.members ?? [], sortedComparisons.value)
  .find(row => row.key === selectedLineId.value) ?? null)
const hasNextDifference = computed(() => nextSlhReconciliationDifferenceLineId(sortedComparisons.value, selectedLineId.value) !== null)
const bucketChips = computed(() => SLH_RECONCILIATION_DIFF_BUCKETS.map(bucket => ({
  bucket,
  count: summary.value?.bucketLineCounts[bucket] ?? 0,
})))
const feeOutsideCount = computed(() => (summary.value === null ? 0 : summary.value.billFindingCount - summary.value.batchFindingCount))

function selectRow(lineId: string): void {
  selectedLineId.value = lineId
  // 宽屏对照面板常驻，不需要抽屉；窄屏与中屏靠这个开关切换出对照视图。
  panelOpen.value = true
}

function closePanel(): void {
  panelOpen.value = false
  if (!isCompact.value) {
    selectedLineId.value = ''
  }
}

function goNextDifference(): void {
  const next = nextSlhReconciliationDifferenceLineId(sortedComparisons.value, selectedLineId.value)
  if (next === null) {
    return
  }
  // 步进时清掉筛选，否则下一条可能被当前的桶筛选挡住。
  activeBucket.value = 'all'
  differencesOnly.value = false
  selectedLineId.value = next
}

function toggleCheck(lineId: string, checked: boolean): void {
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
    selected.value = new Set([...selected.value].filter(lineId => selectableLineIds.value.has(lineId)))
    if (selectedLineId.value !== '' && !response.data.members.some(member => member.lineId === selectedLineId.value)) {
      selectedLineId.value = ''
      panelOpen.value = false
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

/** 核对是整批语义：任一行不再合格就一行都不写，错误里带行号与原因。 */
async function reconcile(lineIds: readonly string[]): Promise<void> {
  if (!inProgress.value || lineIds.length === 0 || reconciling.value) {
    return
  }
  reconciling.value = true
  actionError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.reconcile(instanceId, { lineIds: [...lineIds] }, new AbortController().signal)
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
    <FaPageMain v-else class="min-w-0 space-y-3">
      <!-- 骨架按真实布局给三块，避免加载完成时首屏跳动。 -->
      <div v-if="loading && !batch" class="animate-pulse space-y-3" aria-hidden="true">
        <div class="rounded-lg bg-muted/40 h-16" />
        <div class="rounded-lg bg-muted/40 h-10" />
        <div class="gap-3 grid lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
          <div class="rounded-lg bg-muted/40 h-72" />
          <div class="rounded-lg bg-muted/40 h-72 hidden lg:block" />
        </div>
      </div>
      <template v-else-if="batch && summary">
        <!-- 概览：四个桶等权，没有主数字；再点一次同一个桶即取消筛选。 -->
        <section class="px-3 py-2 border rounded-lg">
          <div class="flex flex-wrap gap-2 items-center">
            <FaButton
              v-for="chip in bucketChips"
              :key="chip.bucket"
              type="button"
              size="sm"
              :variant="activeBucket === chip.bucket ? 'default' : 'outline'"
              :aria-pressed="activeBucket === chip.bucket"
              :disabled="chip.count === 0"
              @click="activeBucket = activeBucket === chip.bucket ? 'all' : chip.bucket"
            >
              {{ t(resolveSlhReconciliationBucketLabelKey(chip.bucket)) }}
              <span class="tabular-nums">{{ chip.count }}</span>
            </FaButton>
            <FaButton v-if="activeBucket !== 'all'" type="button" size="sm" variant="ghost" @click="activeBucket = 'all'">
              {{ t('slhReconciliation.detail.filterAll') }}
            </FaButton>
            <div class="flex-1" />
            <!-- 进度压成一行：窄屏上三行数字会把首屏全部吃掉。 -->
            <span class="qs-type-description text-muted-foreground tabular-nums">
              {{ t('slhReconciliation.detail.memberProgress') }} {{ batch.reconciledMemberCount }} / {{ batch.memberCount }}
              · {{ t('slhReconciliation.detail.remainingMembers', { count: summary.pendingMemberCount }) }}
              · {{ t('slhReconciliation.detail.billRemaining') }} {{ billRemaining }}
            </span>
          </div>
          <!-- 口径说明单独一行：它与进度不是一类信息，挤在同一行会互相干扰。 -->
          <p v-if="!isNarrow" class="qs-type-description text-muted-foreground m-0 mt-1">
            {{ t('slhReconciliation.detail.recipientNote') }}
          </p>
        </section>

        <FaAlert v-if="actionError" variant="destructive" role="alert" :title="actionError" />

        <div v-if="inProgress" class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-description text-muted-foreground">
            {{ t('slhReconciliation.detail.selected', { count: selectedCount }) }}
          </span>
          <div class="flex-1" />
          <!-- 窄屏并排两列：上下堆叠会在首屏再吃掉一行的高度。 -->
          <FaButton type="button" class="flex-1 sm:flex-none" :loading="reconciling" :disabled="selectedCount === 0 || reconciling" @click="reconcile([...selected])">
            {{ t('slhReconciliation.detail.reconcile') }}
          </FaButton>
          <FaButton type="button" variant="outline" class="flex-1 sm:flex-none" :disabled="reconciling" @click="completeOpen = true">
            {{ t('slhReconciliation.detail.complete') }}
          </FaButton>
        </div>

        <!-- 窄屏：对照独占一屏；中屏与宽屏：清单常驻，对照进抽屉 / 并排。 -->
        <SlhReconciliationComparePanel
          v-if="isNarrow && panelOpen"
          :row="selectedRow"
          :field-totals="summary.fieldTotals"
          :batch-finding-count="summary.batchFindingCount"
          :bill-finding-count="summary.billFindingCount"
          :in-progress="inProgress"
          :reconcilable="selectedRow !== null && selectedRow.member.reconciledAt === null"
          :has-next-difference="hasNextDifference"
          class="min-h-[70vh]"
          @close="closePanel"
          @reconcile="lineId => reconcile([lineId])"
          @next="goNextDifference"
        />
        <div v-else class="gap-3 grid lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] lg:items-start">
          <SlhReconciliationLineList
            class="max-h-[calc(100vh-19rem)] min-h-20"
            :rows="rows"
            :groups="groups"
            :grouped="groupMode === 'BUCKET'"
            :selected-line-id="selectedLineId"
            :sort-mode="sortMode"
            :differences-only="differencesOnly"
            :active-bucket="activeBucket"
            :in-progress="inProgress"
            :selectable-line-ids="selectableLineIds"
            :checked-line-ids="selected"
            @select="selectRow"
            @toggle-check="toggleCheck"
            @toggle-sort="userSortMode = sortMode === 'DIFFERENCE_FIRST' ? 'LINE_NUMBER' : 'DIFFERENCE_FIRST'"
            @toggle-group="userGroupMode = groupMode === 'BUCKET' ? 'NONE' : 'BUCKET'"
            @toggle-differences-only="differencesOnly = !differencesOnly"
          />
          <SlhReconciliationComparePanel
            v-if="!isCompact"
            class="max-h-[calc(100vh-19rem)] min-h-20"
            :row="selectedRow"
            :field-totals="summary.fieldTotals"
            :batch-finding-count="summary.batchFindingCount"
            :bill-finding-count="summary.billFindingCount"
            :bill-level-count="comparison?.billLevelFindings.length ?? 0"
            :in-progress="inProgress"
            :reconcilable="selectedRow !== null && selectedRow.member.reconciledAt === null"
            :has-next-difference="hasNextDifference"
            @close="closePanel"
            @reconcile="lineId => reconcile([lineId])"
            @next="goNextDifference"
          />
        </div>

        <div class="px-3 py-2 border rounded-lg flex flex-wrap gap-3 items-center">
          <span class="qs-type-description text-muted-foreground tabular-nums">
            {{ t('slhReconciliation.detail.feeScope', { batch: summary.batchFindingCount, bill: summary.billFindingCount }) }}
          </span>
          <span v-if="feeOutsideCount > 0" class="qs-type-description text-muted-foreground tabular-nums">
            {{ (comparison?.billLevelFindings.length ?? 0) > 0
              ? t('slhReconciliation.detail.feeOutside', { count: feeOutsideCount, billLevel: comparison?.billLevelFindings.length ?? 0 })
              : t('slhReconciliation.detail.feeOutsidePlain', { count: feeOutsideCount }) }}
          </span>
          <div class="flex-1" />
          <span class="qs-type-description text-muted-foreground flex flex-wrap gap-2 items-center">
            {{ t('slhReconciliation.detail.created') }}
            <QsPersonDisplay :display-name="batch.createdByDisplayName" size="sm" />
            <DateTimeDisplay :value="batch.createdAt" />
          </span>
          <span v-if="batch.completedAt" class="qs-type-description text-muted-foreground flex flex-wrap gap-2 items-center">
            {{ t('slhReconciliation.detail.completedAt') }}
            <QsPersonDisplay v-if="batch.completedByDisplayName" :display-name="batch.completedByDisplayName" size="sm" />
            <DateTimeDisplay :value="batch.completedAt" />
          </span>
        </div>
      </template>
    </FaPageMain>

    <!-- 中屏（1024–1439）抽屉：点行滑出，ESC 或点遮罩关闭，只隐藏不丢选中行。 -->
    <FaDrawer
      v-if="isCompact && !isNarrow"
      v-model="panelOpen"
      :header="false"
      :footer="false"
      :closable="false"
      :show-confirm-button="false"
      :destroy-on-close="false"
      content-class="qs-slh-reconcile-drawer bg-background w-screen max-w-none md:w-[30rem] md:max-w-[calc(100vw-3rem)]"
    >
      <SlhReconciliationComparePanel
        class="border-0 rounded-none min-h-full"
        :row="selectedRow"
        :field-totals="summary?.fieldTotals ?? []"
        :batch-finding-count="summary?.batchFindingCount ?? 0"
        :bill-finding-count="summary?.billFindingCount ?? 0"
        :in-progress="inProgress"
        :reconcilable="selectedRow !== null && selectedRow.member.reconciledAt === null"
        :has-next-difference="hasNextDifference"
        @close="closePanel"
        @reconcile="lineId => reconcile([lineId])"
        @next="goNextDifference"
      />
    </FaDrawer>

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
