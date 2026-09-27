<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type { SlhBillListState } from './list.logic'
import type { SlhBillListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import slhBillsApi from '@/api/modules/slh-bills'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { buildSlhBillListQuery, shouldOpenSlhBillFromRowClick } from './list.logic'

defineOptions({ name: 'QsFinanceBillReconciliationSlhBillManagement' })
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('slh-bills:read'))
const canImport = computed(() => canRead.value && auth('slh-bills:create'))
const state = ref<SlhBillListState>('active')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const dateRange = shallowRef<CalendarDateRangeValue>({ end: undefined, start: undefined })
const items = shallowRef<SlhBillListItemDto[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
let controller: AbortController | null = null
const stateItems = computed(() => (['active', 'superseded', 'all'] as const).map(value => ({ value, label: t(`slhBill.state.${value}`) })))
const query = computed(() => buildSlhBillListQuery({
  page: page.value,
  pageSize: pageSize.value,
  keyword: keyword.value,
  periodFrom: dateRange.value.start?.toString(),
  periodTo: dateRange.value.end?.toString(),
  state: state.value,
}))
const columns = computed<QsGenericTableColumn<SlhBillListItemDto>[]>(() => [
  // 编号是账单的唯一标识，固定在最左；名称与月份是入库时填的归档信息，紧随其后不固定。
  { id: 'slhBillNo', title: t('slhBill.column.slhBillNo'), accessorKey: 'slhBillNo', width: 215, minWidth: 215, fixed: 'left' },
  { id: 'billName', title: t('slhBill.column.billName'), accessorFn: item => item.billName, width: 240, minWidth: 240 },
  { id: 'billMonth', title: t('slhBill.column.billMonth'), accessorFn: item => item.billMonth, width: 130, minWidth: 130 },
  { id: 'period', title: t('slhBill.column.period'), accessorFn: item => `${item.periodStart} ~ ${item.periodEnd}`, minWidth: 205 },
  { id: 'lineCount', title: t('slhBill.column.lineCount'), accessorKey: 'lineCount', minWidth: 110, align: 'right' },
  { id: 'containerBatchCount', title: t('slhBill.column.containerBatchCount'), accessorKey: 'containerBatchCount', minWidth: 100, align: 'right' },
  { id: 'payable', title: t('slhBill.column.payableTotalAmountCny'), accessorKey: 'payableTotalAmountCny', minWidth: 175, align: 'right' },
  { id: 'codTwd', title: t('slhBill.column.codTotalAmountTwd'), accessorKey: 'codTotalAmountTwd', minWidth: 165, align: 'right' },
  { id: 'reportedNet', title: t('slhBill.column.reportedNetAmountTwd'), accessorKey: 'reportedNetAmountTwd', minWidth: 165, align: 'right' },
  { id: 'rate', title: t('slhBill.column.rateSource'), accessorFn: item => item.rateSource ?? '', minWidth: 175 },
  { id: 'sourceFile', title: t('slhBill.column.sourceFileName'), accessorKey: 'sourceFileName', minWidth: 240 },
  { id: 'created', title: t('slhBill.column.createdAt'), accessorKey: 'createdAt', minWidth: 220 },
])
async function load(): Promise<void> {
  controller?.abort()
  if (!canRead.value) {
    items.value = []
    total.value = 0
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
function search(): void {
  page.value = 1
  void load()
}
function selectState(value: string): void {
  if (value !== 'active' && value !== 'superseded' && value !== 'all') {
    return
  }
  state.value = value
  page.value = 1
  void load()
}
function viewBill(id: string): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillDetail', params: { id } })
}
function openImport(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillImport' })
}
// 行内按钮与复制按钮自己处理点击，只有其余区域才算作进入详情，避免一次点击触发两次导航。
function onRowClick(row: SlhBillListItemDto, _index: number, event: MouseEvent): void {
  if (shouldOpenSlhBillFromRowClick(event.target)) {
    viewBill(row.id)
  }
}
watch(() => [canRead.value, accountStore.authEpoch], () => {
  items.value = []
  total.value = 0
  error.value = ''
  void load()
}, { immediate: true })
onBeforeUnmount(() => controller?.abort())
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
      <QsStatusSwitchToolbar :model-value="state" :items="stateItems" :aria-label="t('workbench.slhBillManagement')" class="mb-4" @update:model-value="selectState" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        row-key="id"
        table-class="w-max min-w-full [&_tbody_tr]:cursor-pointer"
        :show-row-number="false"
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
        :action-column="{ fixed: 'right', minWidth: 120 }"
        @search="search"
        @pagination-change="load"
        @retry="load"
        @row-click="onRowClick"
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
        <template #cell-payable="{ row }">
          <AmountDisplay :value="row.original.payableTotalAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-codTwd="{ row }">
          <AmountDisplay :value="row.original.codTotalAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-reportedNet="{ row }">
          <AmountDisplay :value="row.original.reportedNetAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-rate="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine>
              {{ row.original.rateSource ? t(`slhBill.rateSource.${row.original.rateSource}`) : t('slhBill.noRate') }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-sourceFile="{ row }">
          <span class="qs-type-data block break-words">{{ row.original.sourceFileName }}</span>
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
                  {{ t('slhBill.column.reportedNetAmountTwd') }}
                </dt>
                <dd class="m-0 mt-1">
                  <AmountDisplay :value="row.reportedNetAmountTwd" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
            </dl>
            <dl class="m-0 gap-1 grid">
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
                </dt><dd class="qs-type-body m-0 break-words">
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
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.slhBillNo} · ${t('slhBill.view')}`" @click="viewBill(row.id)">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('slhBill.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
  </div>
</template>
