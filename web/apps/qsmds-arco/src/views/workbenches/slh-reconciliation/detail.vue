<script setup lang="ts">
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
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
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
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
const columns = computed<QsGenericTableColumn<SlhReconciliationBatchMemberDto>[]>(() => [
  { id: 'select', title: '', width: 56, minWidth: 56 },
  { id: 'lineNumber', title: t('slhReconciliation.detail.lineNumber'), accessorKey: 'lineNumber', width: 80, minWidth: 80, align: 'right' },
  { id: 'loadingDate', title: t('slhReconciliation.detail.loadingDate'), accessorKey: 'loadingDate', minWidth: 120 },
  { id: 'container', title: t('slhReconciliation.selectModal.containerName'), accessorFn: member => member.containerBatchNameText, minWidth: 140 },
  { id: 'shippingMark', title: t('slhReconciliation.selectModal.shippingMark'), accessorFn: member => member.shippingMarkText ?? '', minWidth: 140 },
  { id: 'goodsName', title: t('slhReconciliation.selectModal.goodsName'), accessorKey: 'goodsName', minWidth: 200 },
  { id: 'matchedContainer', title: t('slhReconciliation.selectModal.matchedContainer'), accessorKey: 'matchedContainerBatchName', minWidth: 150 },
  { id: 'matchSource', title: t('slhReconciliation.selectModal.source'), accessorKey: 'matchSource', minWidth: 130 },
  { id: 'payable', title: t('slhBill.column.payableTotalAmountCny'), accessorKey: 'payableAmountCny', minWidth: 170, align: 'right' },
  { id: 'reconciliationStatus', title: t('slhBill.column.reconciliationStatus'), accessorKey: 'reconciliationStatus', minWidth: 140 },
  { id: 'reconciled', title: t('slhReconciliation.detail.reconciledAt'), accessorFn: member => member.reconciledAt ?? '', minWidth: 200 },
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
      <FaAlert variant="destructive" role="alert">
        {{ error }}
      </FaAlert>
      <FaButton class="mt-3" variant="outline" @click="load">
        {{ t('slhBill.retry') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain v-else class="min-w-0 space-y-4">
      <div v-if="loading && !batch" class="animate-pulse space-y-3" aria-hidden="true">
        <div class="rounded-lg bg-muted/40 h-20" />
        <div class="rounded-lg bg-muted/40 h-64" />
      </div>
      <template v-else-if="batch">
        <!-- 两个数字：批次收了多少活、账单还剩多少活（口径与列表页一致）。 -->
        <dl class="gap-4 grid lg:grid-cols-4 sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-label text-muted-foreground">
              {{ t('slhReconciliation.detail.memberProgress') }}
            </dt>
            <dd class="qs-type-data-emphasis m-0 tabular-nums">
              {{ batch.reconciledMemberCount }} / {{ batch.memberCount }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-label text-muted-foreground">
              {{ t('slhReconciliation.detail.billRemaining') }}
            </dt>
            <dd class="qs-type-data-emphasis m-0 tabular-nums">
              {{ billRemaining }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-label text-muted-foreground">
              {{ t('slhReconciliation.detail.created') }}
            </dt>
            <dd class="qs-type-data m-0 flex flex-wrap gap-2 items-center">
              <QsPersonDisplay :display-name="batch.createdByDisplayName" size="sm" />
              <DateTimeDisplay :value="batch.createdAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-label text-muted-foreground">
              {{ t('slhReconciliation.detail.completedAt') }}
            </dt>
            <dd class="qs-type-data m-0 flex flex-wrap gap-2 items-center">
              <template v-if="batch.completedAt">
                <QsPersonDisplay v-if="batch.completedByDisplayName" :display-name="batch.completedByDisplayName" size="sm" />
                <DateTimeDisplay :value="batch.completedAt" />
              </template>
              <span v-else class="text-muted-foreground">{{ t('slhReconciliation.detail.notCompleted') }}</span>
            </dd>
          </div>
        </dl>

        <FaAlert v-if="actionError" variant="destructive" role="alert">
          {{ actionError }}
        </FaAlert>

        <div class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-description text-muted-foreground">
            {{ t('slhReconciliation.detail.selected', { count: selectedCount }) }}
          </span>
          <div class="flex-1" />
          <FaButton v-if="inProgress" type="button" class="w-full sm:w-auto" :loading="reconciling" :disabled="selectedCount === 0 || reconciling" @click="reconcile">
            {{ t('slhReconciliation.detail.reconcile') }}
          </FaButton>
          <FaButton v-if="inProgress" type="button" variant="outline" class="w-full sm:w-auto" :disabled="reconciling" @click="completeOpen = true">
            {{ t('slhReconciliation.detail.complete') }}
          </FaButton>
        </div>

        <!-- 只展示创建时匹配命中的成员行：账单其他行不会出现在这里。 -->
        <QsGenericTable
          row-key="id"
          table-class="w-max min-w-full"
          :columns="columns"
          :data="batch.members"
          :total="batch.members.length"
          :searchable="false"
          :addable="false"
          :show-column-settings="false"
          :page-size="50"
          :empty-title="t('slhReconciliation.detail.emptyMembers')"
        >
          <template #cell-select="{ row }">
            <FaCheckbox
              v-if="row.original.reconciledAt === null && inProgress"
              class="justify-center"
              :model-value="selected.has(row.original.lineId)"
              :aria-label="t('slhReconciliation.detail.selectLine', { line: row.original.lineNumber })"
              @update:model-value="(value: unknown) => toggle(row.original.lineId, value === true)"
            />
            <span v-else class="text-muted-foreground text-center block" aria-hidden="true">—</span>
          </template>
          <template #cell-payable="{ row }">
            <AmountDisplay :value="row.original.payableAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
          </template>
          <template #cell-matchSource="{ row }">
            <!-- 唛头推断是辅助路径，必须与柜号直接命中区分开。 -->
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="row.original.matchSource === 'MARK' ? 'border-amber-500/40 text-amber-700 dark:text-amber-300' : undefined"
            >
              {{ t(resolveSlhBillLineMatchSourceLabelKey(row.original.matchSource)) }}
            </FaTag>
          </template>
          <template #cell-reconciliationStatus="{ row }">
            <SlhBillReconciliationStatusTag :status="row.original.reconciliationStatus" />
          </template>
          <template #cell-reconciled="{ row }">
            <QsTableStackedCell>
              <QsPersonDisplay v-if="row.original.reconciledByDisplayName" :display-name="row.original.reconciledByDisplayName" size="sm" />
              <DateTimeDisplay v-if="row.original.reconciledAt" :value="row.original.reconciledAt" />
              <span v-else class="text-muted-foreground">{{ t('slhReconciliation.detail.notReconciledYet') }}</span>
            </QsTableStackedCell>
          </template>
        </QsGenericTable>
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
