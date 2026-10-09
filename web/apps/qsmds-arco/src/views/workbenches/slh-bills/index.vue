<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type { SlhBillListState, SlhBillReconciliationFilter } from './list.logic'
import type { SlhBillListItemDto, SlhBillStatusCountsDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhBillsApi from '@/api/modules/slh-bills'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { resolveSlhBillNetDisplay } from './display.logic'
import {
  buildSlhBillListQuery,
  buildSlhBillStatusCountsQuery,
  resolveSlhBillListState,
  resolveSlhBillReconciliationFilter,
  SLH_BILL_DEFAULT_RECONCILIATION_FILTER,
  SLH_BILL_LIST_STATES,
  SLH_BILL_RECONCILIATION_FILTERS,
} from './list.logic'
import { resolveSlhBillReconciliationActionLabelKey, resolveSlhBillReconciliationLabelKey } from './reconciliation-status.logic'
import SlhBillRateSourceTag from './slh-bill-rate-source-tag.vue'
import SlhBillReconciliationStatusTag from './slh-bill-reconciliation-status-tag.vue'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillManagement' })
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const canRead = computed(() => auth('slh-bills:read'))
/** 可核对行数只在能发起对账时才有意义，没权限就不发注定被拒的请求，列上留占位符。 */
const canReconcile = computed(() => canRead.value && auth('slh-bills:reconcile'))
const canImport = computed(() => canRead.value && auth('slh-bills:create'))
const state = ref<SlhBillListState>('active')
// 进页面默认停在未对账：财务打开账单管理时最先要处理的就是这批。
const reconciliationStatus = ref<SlhBillReconciliationFilter>(SLH_BILL_DEFAULT_RECONCILIATION_FILTER)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const dateRange = shallowRef<CalendarDateRangeValue>({ end: undefined, start: undefined })
const items = shallowRef<SlhBillListItemDto[]>([])
const total = ref(0)
// 计数快照：列表与计数两个请求共用同一组筛选条件，任一失败都不冒充成功结果。
const counts = shallowRef<SlhBillStatusCountsDto | null>(null)
const loading = ref(false)
const error = ref('')
/**
 * 「当前可核对」只覆盖当前页：进页面、翻页、改筛选后按当页账单批量算一次，
 * 结果按账单主键存，数值随列表一起被替换，不跨页复用。
 */
const reconcilableCounts = shallowRef<Map<string, number>>(new Map())
let controller: AbortController | null = null
let countsController: AbortController | null = null
let reconcilableController: AbortController | null = null
const stateItems = computed(() => withStatusSwitchCounts(
  SLH_BILL_LIST_STATES.map(value => ({ value, label: t(`slhBill.state.${value}`) })),
  (counts.value?.states ?? []).map(item => ({ value: item.value, count: item.count })),
  // 列表 total 与选中项同源，用它校准，避免两个请求之间的并发变化导致数字与行数不一致。
  { selectedCount: loading.value ? undefined : total.value, selectedValue: state.value },
))
const reconciliationItems = computed(() => withStatusSwitchCounts(
  SLH_BILL_RECONCILIATION_FILTERS.map(value => ({ value, label: t(resolveSlhBillReconciliationLabelKey(value)) })),
  (counts.value?.reconciliationStatuses ?? []).map(item => ({ value: item.value, count: item.count })),
  { selectedCount: loading.value ? undefined : total.value, selectedValue: reconciliationStatus.value },
))
/** 两块工具栏共用同一组筛选参数，页面只维护一份状态。 */
const filter = computed(() => ({
  keyword: keyword.value,
  periodFrom: dateRange.value.start?.toString(),
  periodTo: dateRange.value.end?.toString(),
  reconciliationStatus: reconciliationStatus.value,
  state: state.value,
}))
const query = computed(() => buildSlhBillListQuery({ ...filter.value, page: page.value, pageSize: pageSize.value }))
const countsQuery = computed(() => buildSlhBillStatusCountsQuery(filter.value))
const columns = computed<QsGenericTableColumn<SlhBillListItemDto>[]>(() => [
  // 编号是账单的唯一标识，固定在最左；名称与月份是入库时填的归档信息，紧随其后不固定。
  { id: 'slhBillNo', title: t('slhBill.column.slhBillNo'), accessorKey: 'slhBillNo', width: 215, minWidth: 215, fixed: 'left' },
  { id: 'billName', title: t('slhBill.column.billName'), accessorFn: item => item.billName, width: 240, minWidth: 240 },
  { id: 'billMonth', title: t('slhBill.column.billMonth'), accessorFn: item => item.billMonth, width: 130, minWidth: 130 },
  { id: 'period', title: t('slhBill.column.period'), accessorFn: item => `${item.periodStart} ~ ${item.periodEnd}`, minWidth: 205 },
  // 对账状态由服务端按明细行汇总派生，与详情页明细行上的状态同源；紧跟账单期间，便于一眼看进度。
  { id: 'reconciliationStatus', title: t('slhBill.column.reconciliationStatus'), accessorKey: 'reconciliationStatus', minWidth: 140 },
  { id: 'lineCount', title: t('slhBill.column.lineCount'), accessorKey: 'lineCount', minWidth: 110, align: 'right' },
  // 当前可核对紧跟明细行数：两个数字放一起，才能看出「还有多少行等着核对」。
  { id: 'reconcilable', title: t('slhBill.column.reconcilableLineCount'), accessorFn: item => reconcilableCounts.value.get(item.id), minWidth: 130, align: 'right' },
  { id: 'containerBatchCount', title: t('slhBill.column.containerBatchCount'), accessorKey: 'containerBatchCount', minWidth: 110, align: 'right' },
  // 金额三列按用户要求加宽：金额是核对时的主要对象，列太窄会挤在一起不好扫读。
  { id: 'payable', title: t('slhBill.column.payableTotalAmountCny'), accessorKey: 'payableTotalAmountCny', minWidth: 195, align: 'right' },
  { id: 'codTwd', title: t('slhBill.column.codTotalAmountTwd'), accessorKey: 'codTotalAmountTwd', minWidth: 195, align: 'right' },
  { id: 'ntdSurchargeTwd', title: t('slhBill.column.ntdSurchargeTotalAmountTwd'), accessorKey: 'ntdSurchargeTotalAmountTwd', minWidth: 165, align: 'right' },
  // 折算净额：有账单内嵌汇率时出折算后的人民币，没有则退回不折算的台币原值。
  { id: 'foldedNet', title: t('slhBill.column.foldedNetAmount'), accessorFn: item => resolveSlhBillNetDisplay(item).amount, minWidth: 195, align: 'right' },
  { id: 'rate', title: t('slhBill.column.rateSource'), accessorFn: item => item.rateSource ?? '', minWidth: 175 },
  { id: 'sourceFile', title: t('slhBill.column.sourceFileName'), accessorKey: 'sourceFileName', minWidth: 240 },
  { id: 'created', title: t('slhBill.column.createdAt'), accessorKey: 'createdAt', minWidth: 220 },
])
/**
 * 操作列宽度按「查看详情 + 开始对账」并排算：左右内边距各 12、两个按钮各 100、间距 4，
 * 合计 228，取 232 留一点余量；不传宽度时组件默认 160 会把两个按钮挤成两行。
 */
const actionColumn = { fixed: 'right' as const, minWidth: 232, width: 232 }
async function load(): Promise<void> {
  controller?.abort()
  if (!canRead.value) {
    items.value = []
    total.value = 0
    void loadReconcilableCounts([])
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhBillsApi.list(query.value, current.signal)
    if (current.signal.aborted || !canRead.value) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
    void loadReconcilableCounts(response.data.items.map(item => item.id))
  }
  catch (failure) {
    if (!current.signal.aborted) {
      items.value = []
      total.value = 0
      error.value = containerFailure(failure).message
      void loadReconcilableCounts([])
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}
function search(): void {
  page.value = 1
  refresh()
}
function selectState(value: string): void {
  state.value = resolveSlhBillListState(value)
  page.value = 1
  refresh()
}
function selectReconciliationStatus(value: string): void {
  reconciliationStatus.value = resolveSlhBillReconciliationFilter(value)
  page.value = 1
  refresh()
}
/**
 * 计数与列表一起刷新：两块工具栏的计数互相依赖对方的选择，
 * 切换任一块都会让对方那一组数字变化，所以状态切换也必须重取计数。
 */
function refresh(): void {
  void load()
  void loadCounts()
}
/** 计数失败不遮蔽列表错误：清空快照让数字回落为 0，不把上一次的结果冒充成本次筛选的结果。 */
async function loadCounts(): Promise<void> {
  countsController?.abort()
  if (!canRead.value) {
    counts.value = null
    return
  }
  const current = new AbortController()
  countsController = current
  try {
    const response = await slhBillsApi.statusCounts(countsQuery.value, current.signal)
    if (current.signal.aborted || !canRead.value) {
      return
    }
    counts.value = response.data
  }
  catch {
    // 计数失败不遮蔽列表错误：清空快照让数字回落为 0，不把上一次的结果冒充成本次筛选的结果。
    if (!current.signal.aborted) {
      counts.value = null
    }
  }
  finally {
    if (countsController === current) {
      countsController = null
    }
  }
}
/**
 * 静默算当前页每张账单可核对的明细行数。
 *
 * 与列表解耦：自己一条控制器、独立失败（失败就留占位符，不提示也不影响列表），
 * 但结果必须跟着列表走——每次先把快照清空，旧页的数字绝不停留在新页上。
 */
async function loadReconcilableCounts(billIds: string[]): Promise<void> {
  reconcilableController?.abort()
  if (!canReconcile.value || billIds.length === 0) {
    reconcilableCounts.value = new Map()
    return
  }
  const current = new AbortController()
  reconcilableController = current
  reconcilableCounts.value = new Map()
  try {
    const response = await slhReconciliationBatchesApi.reconcilableCounts({ billIds }, current.signal)
    if (current.signal.aborted || !canReconcile.value) {
      return
    }
    // 列口径＝匹配得上且没有被进行中批次冻结的行（unfrozenLineCount），不是全部匹配行。
    reconcilableCounts.value = new Map(response.data.items.map(item => [item.billId, item.unfrozenLineCount]))
  }
  catch {
    // 静默算：取不到就不显示数字，让「当前可核对」留占位符。
  }
  finally {
    if (reconcilableController === current) {
      reconcilableController = null
    }
  }
}
function viewBill(id: string): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillDetail', params: { id } })
}
/** 对账入口先占位：功能未上线，只给轻提示，不跳转也不改数据。 */
function startReconciliation(): void {
  toast.info(t('slhBill.reconciliationUnavailable'))
}
function openImport(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillImport' })
}
watch(() => [canRead.value, accountStore.authEpoch], () => {
  items.value = []
  total.value = 0
  counts.value = null
  error.value = ''
  void loadReconcilableCounts([])
  refresh()
}, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
  countsController?.abort()
  reconcilableController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.slhBillManagement')" :description="t('slhBill.intro')">
      <FaButton v-if="canImport" @click="openImport">
        <FaIcon name="i-lucide:upload" aria-hidden="true" />{{ t('slhBill.import') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('slhBill.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <!-- 两块工具栏：上排按账单状态，下排按对账状态（对账状态由明细行汇总派生）。 -->
      <QsStatusSwitchToolbar :model-value="state" :items="stateItems" :aria-label="t('slhBill.stateFilter')" class="mb-2" @update:model-value="selectState" />
      <QsStatusSwitchToolbar :model-value="reconciliationStatus" :items="reconciliationItems" :aria-label="t('slhBill.column.reconciliationStatus')" class="mb-4" @update:model-value="selectReconciliationStatus" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        row-key="id"
        table-class="w-max min-w-full"
        :show-row-number="true"
        :columns="columns"
        :data="items"
        :loading="loading"
        :error="error || undefined"
        :total="total"
        :addable="false"
        :search-placeholder="t('slhBill.search')"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('slhBill.empty')"
        :empty-description="t('slhBill.emptyDescription')"
        :action-column="actionColumn"
        @search="search"
        @pagination-change="load"
        @retry="refresh"
      >
        <template #query-leading>
          <QsDateRangeFilter
            v-model="dateRange"
            width-class="w-[360px]"
            :calendar-label="t('slhBill.periodRange')"
            :placeholder="t('slhBill.periodRange')"
            @complete="search"
            @clear="search"
          />
        </template>
        <template #cell-slhBillNo="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis font-mono break-all">
              {{ row.original.slhBillNo }}
              <template #suffix>
                <CopyCellButton :text="row.original.slhBillNo" :label="t('slhBill.column.slhBillNo')" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.supersededById" tone="muted">
              <FaTag variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/30 dark:text-amber-300">
                {{ t('slhBill.superseded') }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-period="{ row }">
          <span class="qs-type-data whitespace-nowrap">{{ row.original.periodStart }} ~ {{ row.original.periodEnd }}</span>
        </template>
        <template #cell-reconcilable="{ row }">
          <!-- 静默算还没回来（或算不出来）时给占位符：不显示 0，避免把「未知」读成「没有」。 -->
          <span
            v-if="reconcilableCounts.get(row.original.id) !== undefined"
            class="qs-type-data tabular-nums"
            :class="reconcilableCounts.get(row.original.id)! > 0 && 'text-primary font-semibold'"
          >{{ reconcilableCounts.get(row.original.id) }}</span>
          <span v-else class="qs-type-data text-muted-foreground">—</span>
        </template>
        <template #cell-containerBatchCount="{ row }">
          <!-- 悬停整格即出柜号清单：不再单独放图标，数量本身仍留在列里。 -->
          <FaTooltip v-if="row.original.containerBatchNames.length > 0">
            <span class="qs-type-data tabular-nums" tabindex="0">{{ row.original.containerBatchCount }}</span>
            <template #content>
              <!-- 气泡内不能套 qs-type-*：那组类自带前景色，落在深色气泡上会看不清。 -->
              <div class="flex flex-wrap gap-x-3 gap-y-1 max-w-[16rem]">
                <span v-for="name in row.original.containerBatchNames" :key="name" class="text-xs text-background">
                  {{ name }}
                </span>
              </div>
            </template>
          </FaTooltip>
          <span v-else class="qs-type-data tabular-nums">{{ row.original.containerBatchCount }}</span>
        </template>
        <template #cell-payable="{ row }">
          <AmountDisplay :value="row.original.payableTotalAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-codTwd="{ row }">
          <AmountDisplay :value="row.original.codTotalAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-ntdSurchargeTwd="{ row }">
          <AmountDisplay :value="row.original.ntdSurchargeTotalAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-foldedNet="{ row }">
          <AmountDisplay
            :value="resolveSlhBillNetDisplay(row.original).amount"
            :currency="resolveSlhBillNetDisplay(row.original).currency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>
        <template #cell-rate="{ row }">
          <SlhBillRateSourceTag :source="row.original.rateSource ?? null" />
        </template>
        <template #cell-reconciliationStatus="{ row }">
          <SlhBillReconciliationStatusTag :status="row.original.reconciliationStatus" />
        </template>
        <template #cell-sourceFile="{ row }">
          <!-- 只做"这是原件文件名"的视觉标注，不可点击（下载入口在详情页）。 -->
          <span class="qs-type-data underline underline-offset-2 decoration-dotted block break-words">{{ row.original.sourceFileName }}</span>
        </template>
        <template #cell-created="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.createdByDisplayName" size="sm" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #mobile-row="{ row }">
          <article class="min-w-0 space-y-3">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <span class="qs-type-data-emphasis font-mono break-all">{{ row.slhBillNo }}</span>
              <FaTag v-if="row.supersededById" variant="outline" class="text-amber-700 qs-type-status-tag border-amber-500/30 dark:text-amber-300">
                {{ t('slhBill.superseded') }}
              </FaTag>
            </div>
            <p class="qs-type-body m-0">
              {{ row.periodStart }} ~ {{ row.periodEnd }}
            </p>
            <dl class="m-0 gap-3 grid grid-cols-2">
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.lineCount') }}
                </dt><dd class="qs-type-data m-0">
                  {{ row.lineCount }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.reconcilableLineCount') }}
                </dt>
                <dd class="qs-type-data m-0">
                  {{ reconcilableCounts.get(row.id) ?? '—' }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.containerBatchCount') }}
                </dt><dd class="qs-type-data m-0">
                  {{ row.containerBatchCount }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.payableTotalAmountCny') }}
                </dt>
                <dd class="m-0 mt-1">
                  <AmountDisplay :value="row.payableTotalAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.codTotalAmountTwd') }}
                </dt>
                <dd class="m-0 mt-1">
                  <AmountDisplay :value="row.codTotalAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.ntdSurchargeTotalAmountTwd') }}
                </dt>
                <dd class="m-0 mt-1">
                  <AmountDisplay :value="row.ntdSurchargeTotalAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.foldedNetAmount') }}
                </dt>
                <dd class="m-0 mt-1">
                  <AmountDisplay
                    :value="resolveSlhBillNetDisplay(row).amount"
                    :currency="resolveSlhBillNetDisplay(row).currency"
                    :currencies="currencyCatalog.currencies.value"
                  />
                </dd>
              </div>
            </dl>
            <dl class="m-0 gap-1 grid">
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.reconciliationStatus') }}
                </dt>
                <dd class="m-0 mt-1">
                  <SlhBillReconciliationStatusTag :status="row.reconciliationStatus" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.rateSource') }}
                </dt><dd class="qs-type-body m-0">
                  {{ row.rateSource ? t(`slhBill.rateSource.${row.rateSource}`) : t('slhBill.noRate') }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.sourceFileName') }}
                </dt><dd class="qs-type-body m-0 underline underline-offset-2 decoration-dotted break-words">
                  {{ row.sourceFileName }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('slhBill.column.created') }}
                </dt><dd class="m-0">
                  {{ row.createdByDisplayName }} · <DateTimeDisplay :value="row.createdAt" />
                </dd>
              </div>
            </dl>
          </article>
        </template>
        <template #actions="{ row }">
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.slhBillNo} · ${t('slhBill.viewDetail')}`" @click="viewBill(row.id)">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('slhBill.viewDetail') }}
          </FaButton>
          <!-- 对账入口按状态出现：未对账给「开始对账」、部分对账给「继续对账」、对账完成不给。 -->
          <FaButton
            v-if="resolveSlhBillReconciliationActionLabelKey(row.reconciliationStatus)"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.slhBillNo} · ${t(resolveSlhBillReconciliationActionLabelKey(row.reconciliationStatus) ?? '')}`"
            @click="startReconciliation"
          >
            <FaIcon name="i-lucide:scale" aria-hidden="true" />{{ t(resolveSlhBillReconciliationActionLabelKey(row.reconciliationStatus) ?? '') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
  </div>
</template>
