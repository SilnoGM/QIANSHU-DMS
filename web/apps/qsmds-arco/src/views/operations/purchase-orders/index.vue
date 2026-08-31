<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type { PurchaseOrderDetailInitialAction } from './purchase-order-detail-drawer.vue'
import type {
  PurchaseOrderListViewMode,
  PurchaseOrderPendingActionItem,
} from './purchase-order-list.logic'
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import { getLocalTimeZone, today } from '@internationalized/date'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import PurchaseOrderDetailDrawer from './purchase-order-detail-drawer.vue'
import {
  buildPurchaseOrderListQuery,
  calculatePurchaseOrderPaymentProgress,
  fulfillmentStatusLabel,
  fulfillmentStatusTagClass,
  getPurchaseOrderApiFailure,
  getPurchaseOrderPendingTaskItems,
  isPurchaseOrderAbortError,
  nextPurchaseOrderFulfillmentStatus,
  normalizePurchaseOrderPendingTask,
  orderStatusLabel,
  orderStatusTagClass,
  paymentStatusLabel,
  paymentStatusTagClass,
  purchaseTypeLabel,
  resolvePurchaseOrderPendingActions,
} from './purchase-order-list.logic'

defineOptions({ name: 'QsOperationsPurchaseOrders' })

const props = withDefaults(defineProps<{
  viewMode?: PurchaseOrderListViewMode
}>(), {
  viewMode: 'all',
})

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog(SUPPLIER_DICTIONARY_CODE)

const canRead = computed(() => auth('purchase-orders:read'))
const canCreate = computed(() => auth('purchase-orders:create'))
const canCreateStock = computed(() => auth('purchase-orders:create-stock'))
const canUpdate = computed(() => auth('purchase-orders:update'))
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const pageTitle = computed(() => props.viewMode === 'pending' ? '待办采购' : '全部采购')
const pageDescription = computed(() => props.viewMode === 'pending'
  ? '按待发货、待入仓和待付款分类处理采购订单。'
  : '查询所有采购订单及其销售来源、履约和付款状态。')
const pendingTaskItems = getPurchaseOrderPendingTaskItems()
const selectedPendingTask = computed<string>({
  get: () => normalizePurchaseOrderPendingTask(route.query.task),
  set: (value) => {
    const normalized = normalizePurchaseOrderPendingTask(value)
    if (normalized === selectedPendingTask.value) {
      return
    }
    void router.push({ query: { ...route.query, task: normalized } })
  },
})

const rows = ref<PurchaseOrderListItemDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const dateRange = shallowRef<CalendarDateRangeValue>({
  end: undefined,
  start: undefined,
})
const loading = ref(false)
const listError = ref('')
const requestId = ref<string>()
const detailVisible = ref(false)
const selectedOrder = shallowRef<PurchaseOrderListItemDto | null>(null)
const detailInitialAction = ref<PurchaseOrderDetailInitialAction>('detail')
const todayDate = today(getLocalTimeZone())
let requestVersion = 0
let listAbortController: AbortController | null = null

const supplierFilterOptions = computed(() => (
  supplierCatalog.catalog.value?.items ?? []
).map(item => ({
  label: item.effectiveEnabled ? item.label : `${item.label}（已停用）`,
  value: item.value,
})))

const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [{
  key: 'supplierValue',
  label: '供应商',
  options: supplierFilterOptions.value,
  placeholder: '选择供应商',
}, {
  key: 'purchaseType',
  label: '采购类型',
  options: [
    { label: '销售关联采购', value: 'SALES_LINKED' },
    { label: '备货采购', value: 'STOCK' },
  ],
  placeholder: '选择采购类型',
}, {
  key: 'orderStatus',
  label: '订单状态',
  options: [
    { label: '已确认', value: 'CONFIRMED' },
    { label: '已取消', value: 'CANCELLED' },
  ],
  placeholder: '选择订单状态',
}, {
  key: 'fulfillmentStatus',
  label: '履约状态',
  options: [
    { label: '已下单', value: 'ORDERED' },
    { label: '备货中', value: 'PREPARING' },
    { label: '已发货', value: 'SHIPPED' },
    { label: '已签收', value: 'SIGNED' },
  ],
  placeholder: '选择履约状态',
}, {
  key: 'paymentStatus',
  label: '付款状态',
  options: [
    { label: '未付款', value: 'UNPAID' },
    { label: '部分付款', value: 'PARTIALLY_PAID' },
    { label: '已付清', value: 'PAID' },
  ],
  placeholder: '选择付款状态',
}])

const columns: QsGenericTableColumn<PurchaseOrderListItemDto>[] = [{
  accessorKey: 'orderNo',
  fixed: 'left',
  id: 'orderSummary',
  minWidth: 220,
  title: '采购订单',
}, {
  accessorKey: 'salesOrderNo',
  id: 'sourceSummary',
  minWidth: 220,
  title: '销售来源',
}, {
  accessorFn: item => item.supplier.value,
  id: 'supplierSummary',
  minWidth: 120,
  title: '供应商',
}, {
  accessorKey: 'purchaseTotalAmount',
  align: 'right',
  id: 'amountSummary',
  minWidth: 160,
  title: '采购金额',
}, {
  accessorKey: 'depositDueAmount',
  align: 'right',
  id: 'termsSummary',
  minWidth: 190,
  title: '付款约定',
}, {
  accessorKey: 'paidAmount',
  align: 'right',
  id: 'paymentAmountSummary',
  minWidth: 190,
  title: '实际付款',
}, {
  accessorKey: 'paymentStatus',
  id: 'paymentStatusSummary',
  minWidth: 180,
  title: '付款状态',
}, {
  accessorKey: 'orderStatus',
  id: 'statusSummary',
  minWidth: 210,
  title: '订单状态',
}, {
  accessorKey: 'remark',
  defaultVisible: false,
  id: 'remarkSummary',
  minWidth: 240,
  title: '备注',
}, {
  accessorKey: 'updatedAt',
  id: 'auditSummary',
  minWidth: 230,
  title: '审计信息',
}]

const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : requestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${requestId.value}）`)
function paymentProgress(order: PurchaseOrderListItemDto) {
  return calculatePurchaseOrderPaymentProgress(
    order.paidAmount,
    order.purchaseTotalAmount,
  )
}

function paymentProgressClass(status: PurchaseOrderListItemDto['paymentStatus']): string {
  return status === 'PAID'
    ? '[&_[data-slot=progress-indicator]]:bg-primary'
    : status === 'PARTIALLY_PAID'
      ? '[&_[data-slot=progress-indicator]]:bg-amber-500'
      : '[&_[data-slot=progress-indicator]]:bg-muted-foreground'
}

function currentDateRange() {
  return {
    ...(dateRange.value.start === undefined
      ? {}
      : { orderDateFrom: dateRange.value.start.toString() }),
    ...(dateRange.value.end === undefined
      ? {}
      : { orderDateTo: dateRange.value.end.toString() }),
  }
}

async function loadOrders(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const version = ++requestVersion
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  listError.value = ''
  requestId.value = undefined
  try {
    const response = await purchaseOrdersApi.list(buildPurchaseOrderListQuery({
      dateRange: currentDateRange(),
      filters: filters.value,
      page: page.value,
      pageSize: pageSize.value,
      pendingTask: props.viewMode === 'pending'
        ? normalizePurchaseOrderPendingTask(route.query.task)
        : undefined,
      searchKeyword: searchKeyword.value,
      viewMode: props.viewMode,
    }), controller.signal)
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || !canRead.value
    ) {
      return
    }
    rows.value = response.data.items
    total.value = response.data.total
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    const failure = getPurchaseOrderApiFailure(error)
    listError.value = failure.message
    requestId.value = failure.requestId
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      if (listAbortController === controller) {
        listAbortController = null
      }
    }
  }
}

function handleSearch(): void {
  page.value = 1
  void loadOrders()
}

function handleFilterChange(): void {
  page.value = 1
  void loadOrders()
}

function handlePaginationChange(): void {
  void loadOrders()
}

function handleDateRangeComplete(): void {
  page.value = 1
  void loadOrders()
}

function clearDateRange(): void {
  page.value = 1
  void loadOrders()
}

function navigateCreate(type: PurchaseOrderListItemDto['purchaseType']): void {
  void router.push({
    name: 'operationsPurchaseOrderCreate',
    query: { type },
  })
}

function openPurchaseOrderDetail(
  order: PurchaseOrderListItemDto,
  initialAction: PurchaseOrderDetailInitialAction = 'detail',
): void {
  selectedOrder.value = { ...order }
  detailInitialAction.value = initialAction
  detailVisible.value = true
}

function pendingActions(order: PurchaseOrderListItemDto) {
  return resolvePurchaseOrderPendingActions(
    normalizePurchaseOrderPendingTask(route.query.task),
    order,
  )
}

function canShowPendingAction(action: PurchaseOrderPendingActionItem): boolean {
  return action.key === 'PAYMENT' ? canManagePayment.value : canUpdate.value
}

/** 首期只说明能力建设状态，不调用履约或付款 mutation，避免按钮产生半成品业务事实。 */
function handlePendingAction(action: PurchaseOrderPendingActionItem): void {
  toast.info(`${action.label}功能正在建设中`)
}

function handleDetailUpdated(_detail: PurchaseOrderDetailDto): void {
  // 待办谓词和筛选均由 Server 负责；mutation 后重取当前页，避免本地复制查询规则。
  void loadOrders()
}

watch(() => appAccountStore.authEpoch, () => {
  listAbortController?.abort()
  detailVisible.value = false
  selectedOrder.value = null
  rows.value = []
  total.value = 0
  if (canRead.value) {
    void loadOrders()
  }
})

watch(
  () => [props.viewMode, route.query.task] as const,
  ([nextMode, nextTask], [previousMode, previousTask]) => {
    if (nextMode === previousMode && nextTask === previousTask) {
      return
    }
    page.value = 1
    void loadOrders()
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadOrders()
  }
})

onBeforeUnmount(() => {
  listAbortController?.abort()
})
</script>

<template>
  <div>
    <FaPageHeader :title="pageTitle" :description="pageDescription">
      <div class="flex flex-wrap gap-2">
        <FaButton
          v-if="canCreate"
          type="button"
          class="min-h-[44px] sm:min-h-9"
          @click="navigateCreate('SALES_LINKED')"
        >
          <FaIcon name="i-lucide:link-2" aria-hidden="true" />新增采购
        </FaButton>
        <FaButton
          v-if="canCreate && canCreateStock"
          type="button"
          variant="outline"
          class="min-h-[44px] sm:min-h-9"
          @click="navigateCreate('STOCK')"
        >
          <FaIcon name="i-lucide:warehouse" aria-hidden="true" />新增备货采购
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权读取采购订单"
        description="当前身份缺少 purchase-orders:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar
        v-if="props.viewMode === 'pending'"
        v-model="selectedPendingTask"
        :items="pendingTaskItems"
        aria-label="待办采购任务筛选"
        class="mb-4"
      />

      <FaAlert
        v-if="supplierCatalog.error.value"
        title="供应商筛选暂不可用"
        description="采购列表仍可查询；重试后恢复供应商筛选。"
        variant="destructive"
        class="mb-4"
      >
        <template #actions>
          <FaButton type="button" variant="outline" size="sm" @click="supplierCatalog.retry()">
            重试供应商
          </FaButton>
        </template>
      </FaAlert>

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="searchKeyword"
        v-model:filters="filters"
        data-testid="purchase-order-list-table"
        :row-key="item => item.id"
        :addable="false"
        :action-column="{ fixed: 'right', minWidth: 260, title: '操作', width: 260 }"
        :columns="columns"
        :data="rows"
        :empty-title="viewMode === 'pending' ? '暂无待办采购' : '暂无采购订单'"
        :empty-description="viewMode === 'pending' ? '当前分类下暂无需要处理的采购订单。' : '请先创建采购订单。'"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索采购单号、销售单号或客户名"
        :total="total"
        table-class="min-w-[2560px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadOrders"
        @search="handleSearch"
      >
        <template #query-leading>
          <QsDateRangeFilter
            v-model="dateRange"
            :max-value="todayDate"
            calendar-label="采购日期范围"
            placeholder="采购日期范围"
            @complete="handleDateRangeComplete"
            @clear="clearDateRange"
          />
        </template>

        <template #actions="{ row }">
          <div class="flex flex-wrap gap-1 items-center">
            <FaButton
              type="button"
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="`${row.orderNo}：查看详情`"
              @click="openPurchaseOrderDetail(row)"
            >
              <FaIcon name="i-lucide:eye" aria-hidden="true" />查看
            </FaButton>
            <template v-if="props.viewMode === 'pending'">
              <template v-for="action in pendingActions(row)" :key="action.key">
                <FaButton
                  v-if="canShowPendingAction(action)"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="min-h-11 sm:min-h-8"
                  :aria-label="`${row.orderNo}：${action.label}`"
                  @click="handlePendingAction(action)"
                >
                  <FaIcon :name="action.icon" aria-hidden="true" />{{ action.label }}
                </FaButton>
              </template>
            </template>
            <FaButton
              v-else-if="canUpdate && nextPurchaseOrderFulfillmentStatus(row)"
              type="button"
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="`${row.orderNo}：推进履约`"
              @click="openPurchaseOrderDetail(row, 'fulfillment')"
            >
              <FaIcon name="i-lucide:truck" aria-hidden="true" />履约
            </FaButton>
            <FaButton
              v-if="props.viewMode === 'all' && canManagePayment && row.orderStatus === 'CONFIRMED' && row.paymentStatus !== 'PAID'"
              type="button"
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="`${row.orderNo}：记录付款`"
              @click="openPurchaseOrderDetail(row, 'payment')"
            >
              <FaIcon name="i-lucide:hand-coins" aria-hidden="true" />付款
            </FaButton>
          </div>
        </template>

        <template #cell-orderSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine nowrap content-class="qs-type-data-emphasis font-mono">
              {{ row.original.orderNo }}
              <template #suffix>
                <CopyCellButton label="采购订单号" :text="row.original.orderNo" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta" nowrap>
              {{ row.original.orderDate }} · {{ purchaseTypeLabel(row.original.purchaseType) }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-sourceSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="font-medium" nowrap>
              {{ row.original.salesOrderNo ?? '独立备货' }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta" nowrap>
              {{ row.original.customerName ?? '不关联销售客户' }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-supplierSummary="{ row }">
          <FaTag variant="outline" :class="row.original.supplier.tone">
            {{ row.original.supplier.label }}
          </FaTag>
        </template>

        <template #cell-amountSummary="{ row }">
          <AmountDisplay
            :value="row.original.purchaseTotalAmount"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="font-semibold"
          />
        </template>

        <template #cell-termsSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="定金" content-class="ml-auto flex justify-end" nowrap>
              <AmountDisplay :value="row.original.depositDueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="尾款" content-class="ml-auto flex justify-end" nowrap>
              <AmountDisplay :value="row.original.balanceDueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-paymentAmountSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="已付" content-class="ml-auto flex justify-end" nowrap>
              <AmountDisplay :value="row.original.paidAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="未付" content-class="ml-auto flex justify-end" nowrap>
              <AmountDisplay :value="row.original.outstandingAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-paymentStatusSummary="{ row }">
          <div class="flex flex-col gap-2 min-w-0">
            <FaTag
              variant="outline"
              class="qs-type-status-tag self-start"
              :class="paymentStatusTagClass(row.original.paymentStatus)"
            >
              {{ paymentStatusLabel(row.original.paymentStatus) }}
            </FaTag>
            <div v-if="paymentProgress(row.original)" class="flex gap-2 items-center">
              <FaProgress
                :model-value="paymentProgress(row.original)?.progressValue ?? 0"
                :aria-label="`付款进度 ${paymentProgress(row.original)?.formattedPercentage ?? '—'}`"
                class="flex-1 h-1.5 min-w-16"
                :class="paymentProgressClass(row.original.paymentStatus)"
              />
              <span class="qs-type-meta shrink-0 tabular-nums">
                {{ paymentProgress(row.original)?.formattedPercentage }}
              </span>
            </div>
          </div>
        </template>

        <template #cell-statusSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="订单状态" nowrap>
              <FaTag variant="outline" class="qs-type-status-tag" :class="orderStatusTagClass(row.original.orderStatus)">
                {{ orderStatusLabel(row.original.orderStatus) }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine label="履约状态" tone="muted" nowrap>
              <FaTag variant="outline" class="qs-type-status-tag" :class="fulfillmentStatusTagClass(row.original.fulfillmentStatus)">
                {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-remarkSummary="{ row }">
          <FaTooltip :text="row.original.remark ?? '未填写备注'" :disabled="row.original.remark === null">
            <span class="max-w-[13rem] block truncate">{{ row.original.remark ?? '未填写备注' }}</span>
          </FaTooltip>
        </template>

        <template #cell-auditSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="创建" content-class="qs-type-meta" nowrap>
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
            <QsTableStackedLine label="更新" tone="muted" content-class="qs-type-meta" nowrap>
              <DateTimeDisplay :value="row.original.updatedAt" /> · v{{ row.original.version }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <article data-testid="purchase-order-mobile-summary">
            <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
              <div class="group min-w-0">
                <div class="qs-type-data-emphasis font-mono flex gap-2 break-all items-center">
                  {{ row.orderNo }}
                  <CopyCellButton always-visible label="采购订单号" :text="row.orderNo" />
                </div>
                <div class="qs-type-meta mt-1">
                  {{ row.orderDate }} · {{ purchaseTypeLabel(row.purchaseType) }}
                </div>
              </div>
              <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
            </div>
            <dl class="m-0 gap-x-4 gap-y-4 grid grid-cols-2">
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  销售来源
                </dt>
                <dd class="font-medium m-0">
                  {{ row.salesOrderNo ?? '独立备货' }} · {{ row.customerName ?? '不关联客户' }}
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  供应商
                </dt>
                <dd class="m-0">
                  {{ row.supplier.label }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  采购总价
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="row.purchaseTotalAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  已付 / 未付
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="row.paidAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" /> / <AmountDisplay :value="row.outstandingAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  订单状态
                </dt>
                <dd class="m-0">
                  <FaTag variant="outline" :class="orderStatusTagClass(row.orderStatus)">
                    {{ orderStatusLabel(row.orderStatus) }}
                  </FaTag>
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  履约状态
                </dt>
                <dd class="m-0">
                  <FaTag variant="outline" :class="fulfillmentStatusTagClass(row.fulfillmentStatus)">
                    {{ fulfillmentStatusLabel(row.fulfillmentStatus) }}
                  </FaTag>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  付款状态
                </dt>
                <dd class="m-0">
                  <FaTag variant="outline" :class="paymentStatusTagClass(row.paymentStatus)">
                    {{ paymentStatusLabel(row.paymentStatus) }}
                  </FaTag>
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <PurchaseOrderDetailDrawer
      v-model="detailVisible"
      :order="selectedOrder"
      :initial-action="detailInitialAction"
      :currencies="currencyCatalog.currencies.value"
      @detail-updated="handleDetailUpdated"
    />
  </div>
</template>
