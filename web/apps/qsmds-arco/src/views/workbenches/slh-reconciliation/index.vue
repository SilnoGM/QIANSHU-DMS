<script setup lang="ts">
import type { SlhReconciliationBatchFilter } from './list.logic'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'
import { containerFailure } from '../containers/use-container-resource'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhReconciliationBatchListQuery,
  resolveSlhReconciliationBatchFilter,
  SLH_RECONCILIATION_BATCH_DEFAULT_FILTER,
  SLH_RECONCILIATION_BATCH_FILTERS,
} from './list.logic'
import SlhBillSelectModal from './slh-bill-select-modal.vue'
import { resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillReconciliation' })
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
const canReconcile = computed(() => auth('slh-bills:reconcile'))
// 进页面先看进行中的对账：那是还没收工的活。
const status = ref<SlhReconciliationBatchFilter>(SLH_RECONCILIATION_BATCH_DEFAULT_FILTER)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<SlhReconciliationBatchListItemDto[]>([])
const total = ref(0)
/**
 * 切换器的另外两档计数：当前档的计数直接用列表返回的 total（同一次请求、口径必然一致），
 * 另两档各发一次 pageSize=1 的列表请求只取 total——接口没有按状态分组计数的能力，
 * 这样不用改契约，代价是每次刷新多两个小请求。关键词一致，计数跟着筛选走。
 */
const counts = shallowRef<Partial<Record<SlhReconciliationBatchFilter, number>>>({})
const loading = ref(false)
const error = ref('')
const billSelectOpen = ref(false)
let controller: AbortController | null = null
let countsController: AbortController | null = null

const statusItems = computed(() => withStatusSwitchCounts(
  SLH_RECONCILIATION_BATCH_FILTERS.map(value => ({ value, label: t(`slhReconciliation.filter.${value}`) })),
  SLH_RECONCILIATION_BATCH_FILTERS.map(value => ({ value, count: counts.value[value] ?? 0 })),
  // 选中项的计数用列表 total 校准：两个请求之间并发变化时，数字与行数不会打架。
  { selectedCount: loading.value ? undefined : total.value, selectedValue: status.value },
))
const query = computed(() => buildSlhReconciliationBatchListQuery({
  page: page.value,
  pageSize: pageSize.value,
  keyword: keyword.value,
  status: status.value,
}))
const columns = computed<QsGenericTableColumn<SlhReconciliationBatchListItemDto>[]>(() => [
  // 批次编号是批次的唯一标识，固定在最左；账单信息紧随其后。
  { id: 'batchNo', title: t('slhReconciliation.column.batchNo'), accessorKey: 'batchNo', width: 205, minWidth: 205, fixed: 'left' },
  { id: 'status', title: t('slhReconciliation.column.status'), accessorKey: 'status', minWidth: 120 },
  { id: 'billNo', title: t('slhBill.column.slhBillNo'), accessorFn: item => item.bill.slhBillNo, width: 215, minWidth: 215 },
  { id: 'billName', title: t('slhBill.column.billName'), accessorFn: item => item.bill.billName, width: 240, minWidth: 240 },
  { id: 'period', title: t('slhBill.column.period'), accessorFn: item => `${item.bill.periodStart} ~ ${item.bill.periodEnd}`, minWidth: 205 },
  // 两个进度数：看批次收了什么活、账单还剩多少活（口径与详情页一致）。
  { id: 'progress', title: t('slhReconciliation.column.progress'), accessorFn: item => `${item.reconciledMemberCount}/${item.memberCount}`, minWidth: 130, align: 'right' },
  { id: 'billRemaining', title: t('slhReconciliation.column.billRemaining'), accessorFn: item => String(item.bill.lineCount - item.bill.reconciledLineCount), minWidth: 150, align: 'right' },
  { id: 'billStatus', title: t('slhBill.column.reconciliationStatus'), accessorFn: item => item.bill.reconciliationStatus, minWidth: 140 },
  // 创建人与创建时间分两列：原先叠在一个「创建时间」列里，扫读时要二次分辨。
  { id: 'createdBy', title: t('slhBill.column.created'), accessorFn: item => item.createdByDisplayName, minWidth: 140 },
  { id: 'created', title: t('slhBill.column.createdAt'), accessorFn: item => item.createdAt, minWidth: 190 },
])
/** 操作列只有「查看详情」一个按钮：宽度按按钮 100 + 左右内边距 24 估算。 */
const actionColumn = { fixed: 'right' as const, width: 128, minWidth: 128 }

async function load(): Promise<void> {
  controller?.abort()
  if (!canReconcile.value) {
    items.value = []
    total.value = 0
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhReconciliationBatchesApi.list(query.value, current.signal)
    if (current.signal.aborted || !canReconcile.value) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
  }
  catch (failure) {
    if (!current.signal.aborted) {
      items.value = []
      total.value = 0
      error.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

/**
 * 另外两档的计数：与列表解耦（自己一条控制器、失败静默），但必须跟着列表走——
 * 每次先把旧值清空，切了筛选或关键词后旧数字绝不停留。
 */
async function loadCounts(): Promise<void> {
  countsController?.abort()
  counts.value = {}
  if (!canReconcile.value) {
    return
  }
  const current = new AbortController()
  countsController = current
  const others = SLH_RECONCILIATION_BATCH_FILTERS.filter(value => value !== status.value)
  await Promise.all(others.map(async (value) => {
    try {
      const response = await slhReconciliationBatchesApi.list(
        buildSlhReconciliationBatchListQuery({ page: 1, pageSize: 1, keyword: keyword.value, status: value }),
        current.signal,
      )
      if (!current.signal.aborted) {
        counts.value = { ...counts.value, [value]: response.data.total }
      }
    }
    catch {
      // 计数取不到就不显示这一档的数字（切换器回落 0），不打扰列表与页面错误态。
    }
  }))
}

function search(): void {
  page.value = 1
  refresh()
}

function selectStatus(value: string): void {
  status.value = resolveSlhReconciliationBatchFilter(value)
  page.value = 1
  refresh()
}

/** 列表与计数一起刷新：计数依赖当前状态与关键词，换任一个都要重取另外两档。 */
function refresh(): void {
  void load()
  void loadCounts()
}

function viewBatch(id: string): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhReconciliationDetail', params: { id } })
}

/** 批次创建成功：提示编号并进入本次对账的作业面（详情页）。 */
function handleBatchCreated(batch: SlhReconciliationBatchDetailDto): void {
  toast.success(t('slhReconciliation.billSelect.createdToast', { batchNo: batch.batchNo }))
  viewBatch(batch.id)
}

watch([canReconcile, () => accountStore.authEpoch], () => {
  // 进页面、换身份（或权限变化）都要把列表与切换器计数一起取回。
  void load()
  void loadCounts()
}, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
  countsController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.slhBillReconciliation')" :description="t('slhReconciliation.intro')">
      <FaButton v-if="canReconcile" @click="billSelectOpen = true">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />{{ t('slhReconciliation.billSelect.createButton') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!canReconcile">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('slhBill.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar :model-value="status" :items="statusItems" :aria-label="t('slhReconciliation.filterLabel')" class="mb-4" @update:model-value="selectStatus" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        row-key="id"
        table-class="w-max min-w-full"
        :columns="columns"
        :data="items"
        :loading="loading"
        :error="error || undefined"
        :total="total"
        :addable="false"
        :search-placeholder="t('slhReconciliation.search')"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('slhReconciliation.empty')"
        :action-column="actionColumn"
        @search="search"
        @pagination-change="load"
        @retry="refresh"
      >
        <template #cell-batchNo="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis font-mono break-all">
              {{ row.original.batchNo }}
              <template #suffix>
                <CopyCellButton :text="row.original.batchNo" :label="t('slhReconciliation.column.batchNo')" />
              </template>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-status="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag" :class="resolveSlhReconciliationBatchTone(row.original.status)">
            {{ t(resolveSlhReconciliationBatchLabelKey(row.original.status)) }}
          </FaTag>
        </template>
        <template #cell-period="{ row }">
          <span class="qs-type-data whitespace-nowrap">{{ row.original.bill.periodStart }} ~ {{ row.original.bill.periodEnd }}</span>
        </template>
        <template #cell-progress="{ row }">
          <span class="qs-type-data tabular-nums">{{ row.original.reconciledMemberCount }}/{{ row.original.memberCount }}</span>
        </template>
        <template #cell-billRemaining="{ row }">
          <span class="qs-type-data tabular-nums">{{ row.original.bill.lineCount - row.original.bill.reconciledLineCount }}</span>
        </template>
        <template #cell-billStatus="{ row }">
          <SlhBillReconciliationStatusTag :status="row.original.bill.reconciliationStatus" />
        </template>
        <template #cell-createdBy="{ row }">
          <QsPersonDisplay :display-name="row.original.createdByDisplayName" size="sm" :avatar-url="row.original.createdByAvatarUrl" />
        </template>
        <template #cell-created="{ row }">
          <span class="qs-type-data whitespace-nowrap">
            <DateTimeDisplay :value="row.original.createdAt" />
          </span>
        </template>
        <template #actions="{ row }">
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="viewBatch(row.id)">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('slhBill.viewDetail') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <SlhBillSelectModal v-if="canReconcile" v-model="billSelectOpen" @created="handleBatchCreated" />
  </div>
</template>
