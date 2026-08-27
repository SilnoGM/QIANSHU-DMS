<script setup lang="ts">
import type {
  SalesOrderListViewMode,
  SalesOrderPendingActionItem,
  SalesOrderQueryTarget,
} from './sales-order-list-view.logic'
import type { SalesOrderPaymentProgress } from './sales-order-list.logic'
import type {
  SalesOrderRecordsInitialAction,
  SalesOrderRecordsKind,
} from './sales-order-records-modal.logic'
import type {
  SalesOrderCurrencySummaryDto,
  SalesOrderIssuerOptionDto,
  SalesOrderLinePreviewDto,
  SalesOrderListItemDto,
  SalesOrderPageDto,
} from '@/api/generated/types.gen'
import type { SalesOrderListQuery } from '@/api/modules/sales-orders'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type {
  MoneyDiscountRate,
  MoneyDiscountRateTrend,
} from '@/components/base/MoneyInput/logic'

import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { resolveMoneyDiscountRate } from '@/components/base/MoneyInput/logic'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'

import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import {
  deduplicateSalesOrderItems,
  getSalesOrderStatusItems,
  normalizeSalesOrderStatusSelection,
  resolvePendingSalesOrderActions,
  resolveSalesOrderQueryTargets,
  summarizeSalesOrderItemsByCurrency,
} from './sales-order-list-view.logic'
import {
  buildSalesOrderCustomerCopyText,
  calculateSalesOrderPaymentProgress,
  formatSalesOrderSummaryAmount,
} from './sales-order-list.logic'
import SalesOrderRecordsModal from './sales-order-records-modal.vue'

defineOptions({ name: 'OperationsSalesOrders' })

const props = withDefaults(defineProps<{
  viewMode?: SalesOrderListViewMode
}>(), {
  viewMode: 'all',
})

type SalesOrderCurrencyCode = 'TWD' | 'MYR'

/**
 * 销售订单首版只允许 TWD 与 MYR。这里固定的是两种货币的视觉身份，名称、符号与
 * 启用状态仍由货币目录提供，避免卡片展示与基础资料形成第二份业务真相源。
 */
const ORDER_CURRENCY_CARD_DEFINITIONS = [
  {
    code: 'TWD',
    emblemClass: 'bg-emerald-950 text-white ring-emerald-400/30 dark:bg-emerald-900',
    fallbackName: '新台币',
    fallbackSymbol: 'NT$',
    icon: 'i-lucide:flower-2',
    motifClass: 'text-emerald-500/10 dark:text-emerald-300/10',
    regionLabel: '中国台湾',
    regionTextClass: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  {
    code: 'MYR',
    emblemClass: 'bg-blue-950 text-amber-300 ring-amber-400/30 dark:bg-blue-900',
    fallbackName: '马来西亚林吉特',
    fallbackSymbol: 'RM',
    icon: 'i-lucide:moon-star',
    motifClass: 'text-amber-500/10 dark:text-amber-300/10',
    regionLabel: '马来西亚',
    regionTextClass: 'text-blue-700 dark:text-blue-300',
  },
] as const

/** 全部订单页保持既有两个记录入口；待办页由订单状态动态收敛操作。 */
const ALL_ORDER_ROW_ACTIONS = [
  {
    icon: 'i-lucide:hand-coins',
    key: 'RECORD_PAYMENT',
    label: '新增实际收款',
  },
  {
    icon: 'i-lucide:package-check',
    key: 'DELIVERY_RECEIPT',
    label: '货物签收',
  },
] as const satisfies readonly SalesOrderPendingActionItem[]

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()

const canRead = computed(() => auth('sales-orders:read'))
const canCreate = computed(() => auth('sales-orders:create'))
const canRecordPayment = computed(() => (
  auth('sales-orders:payment') && auth('sales-orders:document')
))
const canSubmitDeliveryReceipt = computed(() => auth('sales-orders:document'))
const rows = ref<SalesOrderListItemDto[]>([])
const summariesByCurrency = ref<SalesOrderCurrencySummaryDto[]>([])
const issuerFilterOptions = ref<SalesOrderIssuerOptionDto[]>([])
const issuerFilterOptionsLoaded = ref(false)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const loading = ref(false)
const listError = ref('')
const requestId = ref<string>()
const currencyModalVisible = ref(false)
const selectedCurrency = ref<SalesOrderCurrencyCode | null>(null)
const recordsModalVisible = ref(false)
const recordsModalKind = ref<SalesOrderRecordsKind>('payments')
const recordsModalOrder = ref<SalesOrderListItemDto | null>(null)
const recordsModalInitialAction = ref<SalesOrderRecordsInitialAction>(null)
let requestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshPending = false

const availableOrderCurrencies = computed(() => currencyCatalog.selectableCurrencies.value.filter(
  currency => currency.code === 'TWD' || currency.code === 'MYR',
))
const orderCurrencyCardOptions = computed(() => ORDER_CURRENCY_CARD_DEFINITIONS.map((definition) => {
  const currency = currencyCatalog.currencies.value.find(item => item.code === definition.code)
  return {
    ...definition,
    disabled: currency?.enabled !== true,
    name: currency?.name ?? definition.fallbackName,
    symbol: currency?.symbol?.trim() || definition.fallbackSymbol,
    value: definition.code,
  }
}))
// FaFormItem 依赖 FaForm 提供的表单上下文；弹窗虽然只有一个字段，也不能省略该容器。
const currencyFormModel = computed(() => ({
  salesOrderCurrency: selectedCurrency.value ?? '__sales_order_currency_empty__',
}))
const currencySelectionUnavailable = computed(() => (
  currencyCatalog.loading.value
  || currencyCatalog.errorMessage.value !== null
  || availableOrderCurrencies.value.length === 0
))
const selectedCurrencyAvailable = computed(() => selectedCurrency.value !== null
  && availableOrderCurrencies.value.some(currency => currency.code === selectedCurrency.value))
const listErrorDisplay = computed(() => requestId.value === undefined
  ? listError.value || undefined
  : `${listError.value}（requestId: ${requestId.value}）`)
const statusItems = computed(() => getSalesOrderStatusItems(props.viewMode))
const pageTitle = computed(() => props.viewMode === 'pending' ? '待办订单' : '全部订单')
const pageDescription = computed(() => props.viewMode === 'pending'
  ? '聚合当前需要推进的销售订单，并按履约阶段快速筛选。'
  : '订单、履约与付款状态独立展示；实际收款与定金/尾款分开统计。')
const tableEmptyTitle = computed(() => props.viewMode === 'pending'
  ? '暂无待办订单'
  : '暂无销售订单')
const tableEmptyDescription = computed(() => {
  const selected = normalizeSalesOrderStatusSelection(
    props.viewMode,
    route.query.status,
  )
  if (
    props.viewMode === 'all'
    && (selected === 'PENDING_RECONCILIATION' || selected === 'COMPLETED')
  ) {
    return '该订单状态尚未进入当前数据契约。'
  }
  return props.viewMode === 'pending'
    ? '当前筛选条件下没有需要处理的销售订单。'
    : '当前筛选条件下没有可展示的销售订单。'
})

/**
 * 状态切换写入 URL，保证刷新与浏览器前进/后退可恢复；“全部”使用无查询参数的规范地址。
 */
const selectedStatus = computed<string>({
  get: () => normalizeSalesOrderStatusSelection(props.viewMode, route.query.status),
  set: (value) => {
    const normalized = normalizeSalesOrderStatusSelection(props.viewMode, value)
    if (normalized === selectedStatus.value) {
      return
    }
    const nextQuery = { ...route.query }
    if (normalized === 'ALL') {
      delete nextQuery.status
    }
    else {
      nextQuery.status = normalized
    }
    void router.push({ query: nextQuery })
  },
})

watch(availableOrderCurrencies, (currencies) => {
  if (
    selectedCurrency.value !== null
    && !currencies.some(currency => currency.code === selectedCurrency.value)
  ) {
    selectedCurrency.value = null
  }
})

const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => {
  const definitions: QsGenericTableFilterDefinition[] = [
    {
      key: 'currencyCode',
      label: '订单币种',
      options: [
        { label: 'TWD', value: 'TWD' },
        { label: 'MYR', value: 'MYR' },
      ],
      placeholder: '选择订单币种',
    },
    {
      key: 'issuerUserId',
      label: '出单人',
      options: issuerFilterOptions.value.map(user => ({
        label: user.status === 'DISABLED'
          ? `${user.displayName} · 已停用`
          : user.displayName,
        value: user.id,
      })),
      placeholder: '选择出单人',
    },
  ]
  if (props.viewMode === 'all') {
    definitions.push({
      key: 'paymentStatus',
      label: '付款状态',
      options: [
        { label: '未付款', value: 'UNPAID' },
        { label: '部分付款', value: 'PARTIALLY_PAID' },
        { label: '已付清', value: 'PAID' },
      ],
      placeholder: '选择付款状态',
    })
  }
  return definitions
})

const columns: QsGenericTableColumn<SalesOrderListItemDto>[] = [
  {
    accessorKey: 'orderNo',
    id: 'orderSummary',
    fixed: 'left',
    minWidth: 230,
    title: '订单',
  },
  { accessorFn: item => item.issuer.displayName, id: 'issuerSummary', minWidth: 180, title: '出单人' },
  { accessorKey: 'customerName', id: 'customerSummary', minWidth: 300, title: '客户' },
  { accessorFn: item => item.lineSummary.lineCount, id: 'productSummary', minWidth: 160, title: '产品' },
  {
    accessorKey: 'agreedTotalAmount',
    align: 'right',
    id: 'priceSummary',
    minWidth: 240,
    title: '售价',
  },
  {
    accessorFn: item => salesOrderDiscountRate(item)?.formattedValue ?? '',
    align: 'right',
    id: 'discountRateSummary',
    minWidth: 120,
    title: '折扣率',
  },
  {
    accessorKey: 'depositDueAmount',
    align: 'right',
    id: 'termsSummary',
    minWidth: 230,
    title: '约定金额',
  },
  {
    accessorKey: 'receivedAmount',
    align: 'right',
    id: 'collectionSummary',
    minWidth: 230,
    title: '实际收款',
  },
  { accessorKey: 'paymentRecordCount', id: 'paymentRecordsSummary', minWidth: 180, title: '实际收款记录' },
  { accessorKey: 'paymentStatus', id: 'paymentStatusSummary', minWidth: 170, title: '付款状态' },
  { accessorKey: 'orderStatus', id: 'orderStatusSummary', minWidth: 210, title: '订单状态' },
  { accessorFn: item => item.documentSummary.count, id: 'documentSummary', minWidth: 170, title: '订单凭证' },
  { accessorKey: 'remark', id: 'remarkSummary', minWidth: 240, title: '备注' },
  { accessorFn: item => item.statusChangeRecordCount + item.amountChangeRecordCount, id: 'changeRecordsSummary', minWidth: 170, title: '变更记录' },
  { accessorKey: 'updatedAt', id: 'auditSummary', minWidth: 240, title: '审计信息' },
]

function productImageItems(row: SalesOrderListItemDto): readonly ImageGroupItem[] {
  return row.lineSummary.previews.flatMap(preview => preview.mainImage === null
    ? []
    : [{
        alt: preview.productName,
        key: preview.lineId,
        src: preview.mainImage.contentUrl,
        tooltip: preview.productName,
      }])
}

function resolveProductPreview(
  row: SalesOrderListItemDto,
  item: ImageGroupItem,
): SalesOrderLinePreviewDto | undefined {
  // ImageGroup 可能折叠或重新排列可见项，按稳定的订单明细 ID 反查，避免 tooltip 与产品串项。
  return typeof item.key === 'string'
    ? row.lineSummary.previews.find(preview => preview.lineId === item.key)
    : undefined
}

function salesRegionLabel(row: SalesOrderListItemDto): string {
  return row.customerProvinceStateName === row.customerCityName
    ? row.customerCityName
    : `${row.customerProvinceStateName} / ${row.customerCityName}`
}

function changeRecordCount(row: SalesOrderListItemDto): number {
  return row.statusChangeRecordCount + row.amountChangeRecordCount
}

/** 订单折扣率以双方约定总价对比标准价小计，缺少有效标准价时保持空态。 */
function salesOrderDiscountRate(row: SalesOrderListItemDto): MoneyDiscountRate | null {
  return resolveMoneyDiscountRate(
    row.agreedTotalAmount,
    row.standardSubtotalAmount,
  )
}

function discountRateTextClass(trend: MoneyDiscountRateTrend | undefined): string {
  if (trend === 'below') {
    return 'text-destructive'
  }
  if (trend === 'above') {
    return 'text-primary'
  }
  return 'text-foreground'
}

function discountRateTrendIcon(trend: MoneyDiscountRateTrend | undefined): string | null {
  if (trend === 'below') {
    return 'i-lucide:trending-down'
  }
  if (trend === 'above') {
    return 'i-lucide:trending-up'
  }
  return trend === 'equal' ? 'i-lucide:move-right' : null
}

function openRecordsModal(
  kind: SalesOrderRecordsKind,
  order: SalesOrderListItemDto,
): void {
  recordsModalInitialAction.value = null
  recordsModalKind.value = kind
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

/** 表格操作列直接进入对应业务表单；记录弹窗原有标题区入口继续保留。 */
function openRecordsAction(
  action: Exclude<SalesOrderRecordsInitialAction, null>,
  order: SalesOrderListItemDto,
): void {
  recordsModalInitialAction.value = action
  recordsModalKind.value = action === 'payment' ? 'payments' : 'documents'
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

function salesOrderRowActions(
  order: SalesOrderListItemDto,
): readonly SalesOrderPendingActionItem[] {
  if (props.viewMode === 'all') {
    return ALL_ORDER_ROW_ACTIONS
  }
  return resolvePendingSalesOrderActions(
    normalizeSalesOrderStatusSelection(props.viewMode, route.query.status),
    order,
  )
}

/** 已落地动作继续遵守原权限；占位动作不改变数据，仅向有读取权限的用户说明建设状态。 */
function canShowSalesOrderRowAction(action: SalesOrderPendingActionItem): boolean {
  if (action.key === 'RECORD_PAYMENT') {
    return canRecordPayment.value
  }
  if (action.key === 'DELIVERY_RECEIPT') {
    return canSubmitDeliveryReceipt.value
  }
  return true
}

function handleSalesOrderRowAction(
  action: SalesOrderPendingActionItem,
  order: SalesOrderListItemDto,
): void {
  if (action.key === 'RECORD_PAYMENT') {
    openRecordsAction('payment', order)
    return
  }
  if (action.key === 'DELIVERY_RECEIPT') {
    openRecordsAction('receipt', order)
    return
  }
  toast.info(`${action.label}功能正在建设中`)
}

function enumFilter<T extends string>(
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = filters.value[key]
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : undefined
}

function buildListQuery(): SalesOrderListQuery {
  const keyword = searchKeyword.value.trim().normalize('NFKC')
  const currencyCode = enumFilter('currencyCode', ['TWD', 'MYR'] as const)
  const issuerUserId = typeof filters.value.issuerUserId === 'string'
    && issuerFilterOptions.value.some(option => option.id === filters.value.issuerUserId)
    ? filters.value.issuerUserId
    : undefined
  // 待办页由工具栏统一定义付款待办，避免与通用付款筛选形成互相覆盖的查询条件。
  const paymentStatus = props.viewMode === 'all'
    ? enumFilter('paymentStatus', ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const)
    : undefined
  return {
    page: page.value,
    pageSize: pageSize.value,
    ...(keyword === '' ? {} : { keyword }),
    ...(currencyCode === undefined ? {} : { currencyCode }),
    ...(issuerUserId === undefined ? {} : { issuerUserId }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
  }
}

async function loadCompleteQueryTarget(
  baseQuery: SalesOrderListQuery,
  target: SalesOrderQueryTarget,
  signal: AbortSignal,
): Promise<SalesOrderPageDto> {
  const firstResponse = await salesOrdersApi.list({
    ...baseQuery,
    ...target,
    page: 1,
    pageSize: 100,
  }, signal)
  const firstPage = firstResponse.data
  const pageCount = Math.ceil(firstPage.total / firstPage.pageSize)
  if (pageCount <= 1) {
    return firstPage
  }

  // 同一状态的汇总在每页响应中一致，只读取第一页汇总；其余请求仅补齐明细行。
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) => salesOrdersApi.list({
      ...baseQuery,
      ...target,
      page: index + 2,
      pageSize: 100,
    }, signal)),
  )
  return {
    ...firstPage,
    items: [
      ...firstPage.items,
      ...remainingPages.flatMap(response => response.data.items),
    ],
  }
}

/**
 * 单状态沿用服务端分页；“全部待办/全部订单”需要合并多个互斥状态，先完整读取各目标，
 * 再按服务端相同顺序排序、精确汇总并在前端切页，保证总数与汇总不被当前页截断。
 */
async function loadSalesOrderPage(
  signal: AbortSignal,
): Promise<{ data: SalesOrderPageDto }> {
  const selection = normalizeSalesOrderStatusSelection(
    props.viewMode,
    route.query.status,
  )
  const targets = resolveSalesOrderQueryTargets(props.viewMode, selection)
  const baseQuery = buildListQuery()

  if (targets.length === 0) {
    return {
      data: {
        items: [],
        page: page.value,
        pageSize: pageSize.value,
        summariesByCurrency: [],
        total: 0,
      },
    }
  }
  if (targets.length === 1) {
    return salesOrdersApi.list({ ...baseQuery, ...targets[0] }, signal)
  }

  const targetPages = await Promise.all(
    targets.map(target => loadCompleteQueryTarget(baseQuery, target, signal)),
  )
  const allItems = deduplicateSalesOrderItems(
    targetPages.flatMap(result => result.items),
  )
    .sort((left, right) => (
      right.orderDate.localeCompare(left.orderDate)
      || right.id.localeCompare(left.id)
    ))
  const start = (page.value - 1) * pageSize.value
  return {
    data: {
      items: allItems.slice(start, start + pageSize.value),
      page: page.value,
      pageSize: pageSize.value,
      summariesByCurrency: summarizeSalesOrderItemsByCurrency(allItems),
      total: allItems.length,
    },
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
    // 出单人选项只在当前页面生命周期内加载一次，并与首屏列表共用取消与鉴权世代边界。
    // 这样既不会要求用户额外拥有 users:read，也能保留已停用历史出单人的筛选能力。
    const [response, issuerOptionsResponse] = await Promise.all([
      loadSalesOrderPage(controller.signal),
      issuerFilterOptionsLoaded.value
        ? Promise.resolve(null)
        : salesOrdersApi.issuerOptions(controller.signal),
    ])
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || !canRead.value
    ) {
      return
    }
    if (issuerOptionsResponse !== null) {
      issuerFilterOptions.value = issuerOptionsResponse.data.items.map(item => ({ ...item }))
      issuerFilterOptionsLoaded.value = true
    }
    rows.value = response.data.items.map(item => ({
      ...item,
      documentSummary: {
        ...item.documentSummary,
        previews: item.documentSummary.previews.map(preview => ({ ...preview })),
      },
      issuer: { ...item.issuer },
      lineSummary: {
        ...item.lineSummary,
        previews: item.lineSummary.previews.map(preview => ({
          ...preview,
          mainImage: preview.mainImage === null ? null : { ...preview.mainImage },
        })),
      },
    }))
    summariesByCurrency.value = response.data.summariesByCurrency.map(summary => ({ ...summary }))
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || version !== requestVersion) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    summariesByCurrency.value = []
    listError.value = failure.message
    requestId.value = failure.requestId
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
    }
  }
}

function scheduleQueryRefresh(): void {
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadOrders()
  })
}

function openCurrencyModal(): void {
  selectedCurrency.value = null
  currencyModalVisible.value = true
}

function updateSelectedCurrency(value: unknown): void {
  const currencyCode = value === 'TWD' || value === 'MYR' ? value : null
  selectedCurrency.value = currencyCode !== null
    && availableOrderCurrencies.value.some(currency => currency.code === currencyCode)
    ? currencyCode
    : null
}

function enterCreatePage(): void {
  if (!selectedCurrencyAvailable.value || selectedCurrency.value === null) {
    return
  }
  currencyModalVisible.value = false
  void router.push({
    name: 'operationsSalesOrderCreate',
    query: { currency: selectedCurrency.value },
  })
}

function handleSearch(): void {
  page.value = 1
  scheduleQueryRefresh()
}

function handleFilterChange(value: QsGenericTableFilterValues): void {
  filters.value = { ...value }
  page.value = 1
  scheduleQueryRefresh()
}

function handlePaginationChange(): void {
  scheduleQueryRefresh()
}

function orderStatusLabel(value: SalesOrderListItemDto['orderStatus']): string {
  return { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' }[value]
}

function fulfillmentStatusLabel(value: SalesOrderListItemDto['fulfillmentStatus']): string {
  return {
    LAND_TRANSIT: '陆运中',
    PENDING: '待采购',
    PREPARING: '备货中',
    SEA_TRANSIT: '海运中',
    SIGNED: '已签收',
    WAREHOUSE_ARRIVED: '已到仓',
  }[value]
}

function paymentStatusLabel(value: SalesOrderListItemDto['paymentStatus']): string {
  return { UNPAID: '未付款', PARTIALLY_PAID: '部分付款', PAID: '已付清' }[value]
}

// 与币种选择卡片保持相同的视觉身份，文字仍作为主要识别信息，颜色仅用于快速区分。
function currencyTagClass(value: SalesOrderListItemDto['currencyCode']): string {
  return value === 'TWD'
    ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
    : 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300'
}

// 桌面表格与移动卡片共用同一套语义色，颜色仅用于辅助识别，状态含义仍由文字承载。
function orderStatusTagClass(value: SalesOrderListItemDto['orderStatus']): string {
  return {
    DRAFT: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    CONFIRMED: 'border-primary/30 bg-primary/10 text-primary',
    CANCELLED: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[value]
}

function fulfillmentStatusTagClass(
  value: SalesOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    LAND_TRANSIT: 'border-sky-500/30 bg-sky-500/8 text-sky-700 dark:text-sky-300',
    PENDING: 'border-border bg-muted text-muted-foreground',
    PREPARING: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    SEA_TRANSIT: 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300',
    SIGNED: 'border-primary/30 bg-primary/10 text-primary',
    WAREHOUSE_ARRIVED: 'border-teal-500/30 bg-teal-500/8 text-teal-700 dark:text-teal-300',
  }[value]
}

function paymentStatusTagClass(value: SalesOrderListItemDto['paymentStatus']): string {
  return {
    UNPAID: 'border-destructive/30 bg-destructive/10 text-destructive',
    PARTIALLY_PAID: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    PAID: 'border-primary/30 bg-primary/10 text-primary',
  }[value]
}

function paymentProgress(row: SalesOrderListItemDto): SalesOrderPaymentProgress | null {
  return calculateSalesOrderPaymentProgress(
    row.receivedAmount,
    row.agreedTotalAmount,
  )
}

// 进度条沿用付款状态语义色；标签和百分比文字继续承担主要信息，颜色只辅助扫读。
function paymentProgressClass(value: SalesOrderListItemDto['paymentStatus']): string {
  return {
    UNPAID: 'bg-muted [&_[data-slot=progress-indicator]]:bg-muted-foreground',
    PARTIALLY_PAID: 'bg-amber-500/15 [&_[data-slot=progress-indicator]]:bg-amber-500',
    PAID: 'bg-primary/20 [&_[data-slot=progress-indicator]]:bg-primary',
  }[value]
}

function paymentProgressTextClass(value: SalesOrderListItemDto['paymentStatus']): string {
  return {
    UNPAID: 'text-muted-foreground',
    PARTIALLY_PAID: 'text-amber-700 dark:text-amber-300',
    PAID: 'text-primary',
  }[value]
}

watch([
  () => props.viewMode,
  () => route.query.status,
], () => {
  page.value = 1
  const normalized = normalizeSalesOrderStatusSelection(
    props.viewMode,
    route.query.status,
  )
  if (route.query.status !== undefined && normalized === 'ALL') {
    const nextQuery = { ...route.query }
    delete nextQuery.status
    void router.replace({ query: nextQuery })
  }
  scheduleQueryRefresh()
})

onMounted(() => void loadOrders())
onBeforeUnmount(() => {
  requestVersion += 1
  listAbortController?.abort()
})
</script>

<template>
  <div class="sales-order-list-page min-w-0" data-testid="sales-order-list-page">
    <FaPageHeader
      :title="pageTitle"
      :description="pageDescription"
    >
      <FaButton
        v-if="canCreate"
        type="button"
        class="min-h-11 sm:min-h-9"
        @click="openCurrencyModal"
      >
        <FaIcon name="i-lucide:plus" aria-hidden="true" />新增销售订单
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权读取销售订单"
        description="当前身份缺少 sales-orders:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar
        v-model="selectedStatus"
        :items="statusItems"
        :aria-label="`${pageTitle}状态筛选`"
        class="mb-4"
      />

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="searchKeyword"
        v-model:filters="filters"
        data-testid="sales-order-list-table"
        :row-key="item => item.id"
        :addable="false"
        :action-column="{ fixed: 'right', minWidth: 180, title: '操作', width: 180 }"
        :columns="columns"
        :data="rows"
        :empty-title="tableEmptyTitle"
        :empty-description="tableEmptyDescription"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索订单编号、客户姓名或电话"
        :searchable="true"
        :show-column-settings="true"
        :total="total"
        table-class="min-w-[3360px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadOrders"
        @search="handleSearch"
      >
        <template #actions="{ row }">
          <div class="flex flex-wrap gap-1 items-center">
            <template
              v-for="action in salesOrderRowActions(row)"
              :key="action.key"
            >
              <FaButton
                v-if="canShowSalesOrderRowAction(action)"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：${action.label}`"
                @click="handleSalesOrderRowAction(action, row)"
              >
                <FaIcon :name="action.icon" aria-hidden="true" />{{ action.label }}
              </FaButton>
            </template>
          </div>
        </template>

        <template #cell-orderSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine nowrap content-class="qs-type-data-emphasis font-mono">
              {{ row.original.orderNo }}
              <template #suffix>
                <CopyCellButton label="订单编号" :text="row.original.orderNo" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine content-class="qs-type-meta inline-flex gap-2 items-center" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag px-1.5 py-0 shrink-0 !text-[10px] !leading-4"
                :class="currencyTagClass(row.original.currencyCode)"
              >
                {{ row.original.currencyCode }}
              </FaTag>
              <span class="text-muted-foreground">{{ row.original.orderDate }}</span>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-issuerSummary="{ row }">
          <QsPersonDisplay
            :display-name="row.original.issuer.displayName"
            size="md"
            class="max-w-[9rem]"
          />
        </template>

        <template #cell-customerSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine content-class="font-medium truncate" nowrap>
              {{ row.original.customerName }} · {{ row.original.customerPhone }}
              <template #suffix>
                <CopyCellButton label="客户信息" :text="buildSalesOrderCustomerCopyText(row.original)" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>
              <FaTooltip :text="row.original.customerFullAddress">
                <span class="truncate">{{ salesRegionLabel(row.original) }} · {{ row.original.customerFullAddress }}</span>
              </FaTooltip>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-productSummary="{ row }">
          <ImageGroup
            :items="productImageItems(row.original)"
            :max-count="3"
            :size="40"
            radius="md"
          >
            <template #tooltip="{ item, index, total: imageTotal }">
              <QsGoodTooltipContent
                :image-src="item.src"
                :image-alt="item.alt"
              >
                <template v-if="resolveProductPreview(row.original, item)">
                  <div class="min-w-0">
                    <div class="flex gap-3 items-center justify-between">
                      <span class="tracking-[0.08em] font-semibold">订单产品</span>
                      <span class="opacity-60 tabular-nums">{{ index + 1 }} / {{ imageTotal }}</span>
                    </div>
                    <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
                      {{ resolveProductPreview(row.original, item)?.productName }}
                    </p>
                  </div>
                </template>
                <span v-else class="opacity-70">产品信息不可用</span>
              </QsGoodTooltipContent>
            </template>
          </ImageGroup>
        </template>

        <template #cell-priceSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="实际售价" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.agreedTotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="标准售价" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.standardSubtotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-discountRateSummary="{ row }">
          <span
            class="inline-flex gap-1 whitespace-nowrap [font-weight:var(--qs-type-weight-medium,500)] items-center tabular-nums"
            :class="discountRateTextClass(salesOrderDiscountRate(row.original)?.trend)"
          >
            <FaIcon
              v-if="discountRateTrendIcon(salesOrderDiscountRate(row.original)?.trend)"
              :name="discountRateTrendIcon(salesOrderDiscountRate(row.original)?.trend) ?? 'i-lucide:move-right'"
              class="shrink-0 size-3.5 stroke-2"
              aria-hidden="true"
            />
            {{ salesOrderDiscountRate(row.original)?.formattedValue ?? '—' }}
          </span>
        </template>

        <template #cell-termsSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="定金" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.depositDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="尾款" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.balanceDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-collectionSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="已收" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.receivedAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="待收" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.outstandingAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-paymentRecordsSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${row.original.paymentRecordCount} 项实际收款记录`"
            @click="openRecordsModal('payments', row.original)"
          >
            <FaIcon name="i-lucide:hand-coins" class="text-primary size-4" aria-hidden="true" />
            {{ row.original.paymentRecordCount }} 项记录
          </FaButton>
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
            <div v-if="paymentProgress(row.original)" class="flex gap-2 min-w-0 items-center">
              <FaProgress
                :model-value="paymentProgress(row.original)?.progressValue ?? 0"
                :aria-label="`收款进度 ${paymentProgress(row.original)?.formattedPercentage ?? '—'}`"
                class="flex-1 h-1.5 min-w-16"
                :class="paymentProgressClass(row.original.paymentStatus)"
              />
              <span
                class="qs-type-meta shrink-0 tabular-nums"
                :class="paymentProgressTextClass(row.original.paymentStatus)"
              >
                {{ paymentProgress(row.original)?.formattedPercentage }}
              </span>
            </div>
            <span v-else class="qs-type-meta text-muted-foreground">—</span>
          </div>
        </template>

        <template #cell-orderStatusSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="订单状态" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="orderStatusTagClass(row.original.orderStatus)"
              >
                {{ orderStatusLabel(row.original.orderStatus) }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine label="订单进度" tone="muted" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="fulfillmentStatusTagClass(row.original.fulfillmentStatus)"
              >
                {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-documentSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${row.original.documentSummary.count} 项订单凭证`"
            @click="openRecordsModal('documents', row.original)"
          >
            <FaIcon name="i-lucide:files" class="text-primary size-4" aria-hidden="true" />
            {{ row.original.documentSummary.count }} 项凭证
          </FaButton>
        </template>

        <template #cell-remarkSummary="{ row }">
          <FaTooltip
            :text="row.original.remark ?? '未填写备注'"
            :disabled="row.original.remark === null"
          >
            <span class="max-w-[13rem] block truncate">
              {{ row.original.remark ?? '未填写备注' }}
            </span>
          </FaTooltip>
        </template>

        <template #cell-changeRecordsSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${changeRecordCount(row.original)} 项变更记录`"
            @click="openRecordsModal('changes', row.original)"
          >
            <FaIcon name="i-lucide:history" class="text-primary size-4" aria-hidden="true" />
            {{ changeRecordCount(row.original) }} 项记录
          </FaButton>
        </template>

        <template #cell-auditSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="创建" content-class="qs-type-meta" nowrap>
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
            <QsTableStackedLine label="更新" tone="muted" content-class="qs-type-meta flex gap-1" nowrap>
              <DateTimeDisplay :value="row.original.updatedAt" />
              <span>· v{{ row.original.version }}</span>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #summary>
          <!-- 币种作为稳定行维度，六项金额作为列维度，避免在窄表尾中重复币种和挤压标签。 -->
          <section
            data-testid="sales-order-summary-matrix"
            aria-label="销售订单金额汇总"
            class="border-t-2 border-border bg-background overflow-hidden"
          >
            <div class="md:grid md:grid-cols-[12rem_minmax(0,1fr)]">
              <div class="px-4 py-3 border-border flex gap-1 md:border-r md:flex-col md:justify-center">
                <span class="qs-type-meta">筛选结果</span>
                <strong class="qs-type-data-emphasis">共 {{ total }} 张订单</strong>
              </div>

              <div
                data-testid="sales-order-summary-desktop"
                class="min-w-0 hidden overflow-x-auto md:block"
              >
                <table class="text-sm min-w-[840px] w-full border-collapse">
                  <caption class="sr-only">
                    按币种汇总销售订单售价、付款约定与收款金额
                  </caption>
                  <thead class="text-muted-foreground bg-muted/20">
                    <tr class="border-b border-border/70">
                      <th scope="col" rowspan="2" class="font-medium px-4 py-2 text-left">
                        币种
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        售价
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        付款约定
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        收款
                      </th>
                    </tr>
                    <tr class="border-b border-border/70">
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        实际售价
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        标准售价
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        定金
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        尾款
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        已收
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        待收
                      </th>
                    </tr>
                  </thead>
                  <tbody v-if="summariesByCurrency.length > 0">
                    <tr
                      v-for="summary in summariesByCurrency"
                      :key="summary.currencyCode"
                      class="border-b border-border/60 last:border-b-0"
                    >
                      <th scope="row" class="qs-type-data font-semibold px-4 py-3 text-left">
                        {{ summary.currencyCode }}
                      </th>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.agreedTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.standardSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.receivedAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                    </tr>
                  </tbody>
                  <tbody v-else>
                    <tr>
                      <td colspan="7" class="text-muted-foreground px-4 py-5 text-center">
                        暂无金额汇总
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                data-testid="sales-order-summary-mobile"
                class="border-t border-border md:hidden"
              >
                <div v-if="summariesByCurrency.length > 0">
                  <section
                    v-for="summary in summariesByCurrency"
                    :key="summary.currencyCode"
                    class="p-4 border-b border-border last:border-b-0"
                    :aria-label="`${summary.currencyCode} 金额汇总`"
                  >
                    <h3 class="qs-type-data-emphasis m-0 mb-3">
                      {{ summary.currencyCode }}
                    </h3>
                    <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2">
                      <div>
                        <dt class="qs-type-meta">
                          实际售价
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.agreedTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          标准售价
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.standardSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          定金
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          尾款
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          已收
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.receivedAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          待收
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <p v-else class="text-sm text-muted-foreground m-0 px-4 py-5 text-center">
                  暂无金额汇总
                </p>
              </div>
            </div>
          </section>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <article data-testid="sales-order-mobile-summary">
            <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
              <QsTableStackedCell class="group min-w-0">
                <QsTableStackedLine content-class="qs-type-data-emphasis font-mono break-all">
                  {{ row.orderNo }}
                  <template #suffix>
                    <CopyCellButton always-visible label="订单编号" :text="row.orderNo" />
                  </template>
                </QsTableStackedLine>
                <QsTableStackedLine content-class="qs-type-meta inline-flex gap-2 items-center">
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag px-1.5 py-0 shrink-0 !text-[10px] !leading-4"
                    :class="currencyTagClass(row.currencyCode)"
                  >
                    {{ row.currencyCode }}
                  </FaTag>
                  <span class="text-muted-foreground">{{ row.orderDate }}</span>
                </QsTableStackedLine>
              </QsTableStackedCell>
              <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
            </div>

            <dl class="m-0 gap-x-4 gap-y-4 grid grid-cols-2">
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  出单人
                </dt>
                <dd class="m-0">
                  <QsPersonDisplay
                    :display-name="row.issuer.displayName"
                    size="md"
                    class="max-w-full"
                  />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  客户
                </dt>
                <dd class="group m-0">
                  <div class="font-medium flex gap-2 items-center">
                    {{ row.customerName }} · {{ row.customerPhone }}
                    <CopyCellButton always-visible label="客户信息" :text="buildSalesOrderCustomerCopyText(row)" />
                  </div>
                  <div class="qs-type-meta mt-1 break-all">
                    {{ salesRegionLabel(row) }} · {{ row.customerFullAddress }}
                  </div>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  产品
                </dt>
                <dd class="m-0">
                  <ImageGroup :items="productImageItems(row)" :max-count="3" :size="40" radius="md">
                    <template #tooltip="{ item, index, total: imageTotal }">
                      <QsGoodTooltipContent
                        :image-src="item.src"
                        :image-alt="item.alt"
                      >
                        <template v-if="resolveProductPreview(row, item)">
                          <div class="min-w-0">
                            <div class="flex gap-3 items-center justify-between">
                              <span class="tracking-[0.08em] font-semibold">订单产品</span>
                              <span class="opacity-60 tabular-nums">{{ index + 1 }} / {{ imageTotal }}</span>
                            </div>
                            <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
                              {{ resolveProductPreview(row, item)?.productName }}
                            </p>
                          </div>
                        </template>
                        <span v-else class="opacity-70">产品信息不可用</span>
                      </QsGoodTooltipContent>
                    </template>
                  </ImageGroup>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  售价
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="实际售价" nowrap>
                      <AmountDisplay :value="row.agreedTotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="标准售价" nowrap>
                      <AmountDisplay :value="row.standardSubtotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  折扣率
                </dt>
                <dd
                  class="m-0 inline-flex gap-1 whitespace-nowrap [font-weight:var(--qs-type-weight-medium,500)] items-center tabular-nums"
                  :class="discountRateTextClass(salesOrderDiscountRate(row)?.trend)"
                >
                  <FaIcon
                    v-if="discountRateTrendIcon(salesOrderDiscountRate(row)?.trend)"
                    :name="discountRateTrendIcon(salesOrderDiscountRate(row)?.trend) ?? 'i-lucide:move-right'"
                    class="shrink-0 size-3.5 stroke-2"
                    aria-hidden="true"
                  />
                  {{ salesOrderDiscountRate(row)?.formattedValue ?? '—' }}
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  约定金额
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="定金" nowrap>
                      <AmountDisplay :value="row.depositDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="尾款" nowrap>
                      <AmountDisplay :value="row.balanceDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  实际收款
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="已收" nowrap>
                      <AmountDisplay :value="row.receivedAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="待收" nowrap>
                      <AmountDisplay :value="row.outstandingAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  实际收款记录
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('payments', row)"
                  >
                    <FaIcon name="i-lucide:hand-coins" class="text-primary size-4" aria-hidden="true" />
                    {{ row.paymentRecordCount }} 项记录
                  </FaButton>
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  付款状态
                </dt>
                <dd class="m-0">
                  <div class="flex flex-col gap-2 min-w-0">
                    <FaTag
                      variant="outline"
                      class="qs-type-status-tag self-start"
                      :class="paymentStatusTagClass(row.paymentStatus)"
                    >
                      {{ paymentStatusLabel(row.paymentStatus) }}
                    </FaTag>
                    <div v-if="paymentProgress(row)" class="flex gap-2 min-w-0 items-center">
                      <FaProgress
                        :model-value="paymentProgress(row)?.progressValue ?? 0"
                        :aria-label="`收款进度 ${paymentProgress(row)?.formattedPercentage ?? '—'}`"
                        class="flex-1 h-1.5 min-w-16"
                        :class="paymentProgressClass(row.paymentStatus)"
                      />
                      <span
                        class="qs-type-meta shrink-0 tabular-nums"
                        :class="paymentProgressTextClass(row.paymentStatus)"
                      >
                        {{ paymentProgress(row)?.formattedPercentage }}
                      </span>
                    </div>
                    <span v-else class="qs-type-meta text-muted-foreground">—</span>
                  </div>
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  订单状态
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="订单状态" nowrap>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="orderStatusTagClass(row.orderStatus)"
                      >
                        {{ orderStatusLabel(row.orderStatus) }}
                      </FaTag>
                    </QsTableStackedLine>
                    <QsTableStackedLine label="订单进度" tone="muted" nowrap>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="fulfillmentStatusTagClass(row.fulfillmentStatus)"
                      >
                        {{ fulfillmentStatusLabel(row.fulfillmentStatus) }}
                      </FaTag>
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  订单凭证
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('documents', row)"
                  >
                    <FaIcon name="i-lucide:files" class="text-primary size-4" aria-hidden="true" />
                    {{ row.documentSummary.count }} 项凭证
                  </FaButton>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  备注
                </dt>
                <dd class="m-0 min-w-0">
                  <FaTooltip :text="row.remark ?? '未填写备注'" :disabled="row.remark === null">
                    <span class="block truncate">{{ row.remark ?? '未填写备注' }}</span>
                  </FaTooltip>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  变更记录
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('changes', row)"
                  >
                    <FaIcon name="i-lucide:history" class="text-primary size-4" aria-hidden="true" />
                    {{ changeRecordCount(row) }} 项记录
                  </FaButton>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  审计信息
                </dt>
                <dd class="qs-type-meta m-0 flex flex-wrap gap-x-3 gap-y-1">
                  <span>创建 <DateTimeDisplay :value="row.createdAt" /></span>
                  <span>更新 <DateTimeDisplay :value="row.updatedAt" /> · v{{ row.version }}</span>
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <SalesOrderRecordsModal
      v-model="recordsModalVisible"
      :kind="recordsModalKind"
      :initial-action="recordsModalInitialAction"
      :order="recordsModalOrder"
      :currencies="currencyCatalog.currencies.value"
      @detail-updated="loadOrders"
    />

    <QsGenericModal
      v-model="currencyModalVisible"
      title="选择订单币种"
      description="一张订单只允许一个币种，进入新增页后不可切换。产品选择不限制币种，本单售价按订单币种填写。"
      size="xl"
    >
      <template #header-leading>
        <FaIcon name="i-lucide:coins" class="size-5" aria-hidden="true" />
      </template>

      <FaForm :model="currencyFormModel">
        <div class="gap-5 grid">
          <FaFormItem name="salesOrderCurrency" label="订单币种" required>
            <fieldset
              class="m-0 p-0 border-0 min-w-0 w-full"
              :disabled="currencySelectionUnavailable"
            >
              <legend class="sr-only">
                订单币种
              </legend>
              <div class="gap-5 grid grid-cols-2">
                <label
                  v-for="option in orderCurrencyCardOptions"
                  :key="option.value"
                  class="min-w-0 cursor-pointer relative"
                  :class="(currencySelectionUnavailable || option.disabled) && 'cursor-not-allowed'"
                >
                  <input
                    type="radio"
                    name="sales-order-currency"
                    :value="option.value"
                    :checked="selectedCurrency === option.value"
                    :disabled="currencySelectionUnavailable || option.disabled"
                    class="peer sr-only"
                    @change="updateSelectedCurrency(option.value)"
                  >
                  <span
                    data-testid="sales-order-currency-card"
                    :data-currency-code="option.code"
                    class="p-5 text-left border rounded-xl bg-background flex flex-col min-h-64 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out relative overflow-hidden sm:p-6 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
                    :class="currencySelectionUnavailable || option.disabled
                      ? 'border-border bg-muted/30 opacity-60'
                      : selectedCurrency === option.value
                        ? 'border-primary bg-primary/[0.035] shadow-md ring-1 ring-primary/20'
                        : 'border-border shadow-sm hover:border-primary/40 hover:bg-muted/20 hover:shadow-md'"
                  >
                    <span class="flex gap-4 min-w-0 items-start relative">
                      <span
                        data-testid="sales-order-currency-emblem"
                        class="rounded-xl flex shrink-0 size-16 ring-2 shadow-sm items-center justify-center"
                        :class="option.emblemClass"
                        aria-hidden="true"
                      >
                        <span class="text-2xl tracking-tight font-semibold tabular-nums">
                          {{ option.symbol }}
                        </span>
                      </span>

                      <span class="pt-0.5 flex-1 min-w-0">
                        <strong class="text-lg leading-7 font-semibold block truncate">
                          {{ option.name }}
                        </strong>
                        <span
                          data-testid="sales-order-currency-region"
                          class="text-xs font-medium mt-1.5 px-2 py-0.5 border rounded-md inline-flex max-w-full items-center"
                          :class="option.regionTextClass"
                        >
                          {{ option.regionLabel }}
                        </span>
                      </span>

                      <FaIcon
                        v-if="selectedCurrency === option.value && !option.disabled"
                        name="i-lucide:circle-check-big"
                        class="text-primary shrink-0 size-7"
                        aria-hidden="true"
                      />
                      <FaIcon
                        v-else-if="currencySelectionUnavailable || option.disabled"
                        name="i-lucide:circle-slash-2"
                        class="text-muted-foreground shrink-0 size-7"
                        aria-hidden="true"
                      />
                    </span>

                    <span class="mt-6 pt-5 border-t border-dashed flex flex-1 flex-col min-w-0 relative">
                      <span class="flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline relative z-10">
                        <strong class="text-3xl leading-none tracking-wide font-semibold">{{ option.code }}</strong>
                        <span class="text-sm text-muted-foreground truncate">{{ option.name }}</span>
                      </span>

                      <span
                        class="text-sm font-medium mt-auto pt-7 flex gap-2 items-center relative z-10"
                        :class="selectedCurrency === option.value && !option.disabled
                          ? 'text-primary'
                          : 'text-muted-foreground'"
                      >
                        <FaIcon name="i-lucide:mouse-pointer-click" class="size-4" aria-hidden="true" />
                        {{ selectedCurrency === option.value && !option.disabled
                          ? '已选中'
                          : currencyCatalog.loading.value
                            ? '正在加载'
                            : currencyCatalog.errorMessage.value !== null
                              ? '暂时不可用'
                              : option.disabled
                                ? '当前不可用'
                                : '点击选择' }}
                      </span>

                      <span
                        class="size-28 absolute -bottom-8 -right-5"
                        :class="option.motifClass"
                        aria-hidden="true"
                      >
                        <FaIcon :name="option.icon" class="size-full" />
                      </span>
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </FaFormItem>
          <p v-if="currencyCatalog.loading.value" class="text-sm text-muted-foreground m-0" role="status">
            正在加载可用币种…
          </p>
          <FaAlert
            v-else-if="currencyCatalog.errorMessage.value"
            title="币种资料加载失败"
            :description="currencyCatalog.errorMessage.value"
            variant="destructive"
          />
          <FaAlert
            v-else-if="availableOrderCurrencies.length === 0"
            title="暂无可用销售币种"
            description="请先在基础资料中启用 TWD 或 MYR。"
            variant="destructive"
          />
          <FaAlert
            v-else
            icon="i-lucide:info"
            title="币种确定后不可在订单编辑页修改，请谨慎选择。"
            class="text-blue-900 border-blue-200 bg-blue-50/70 dark:text-blue-100 dark:border-blue-800/70 dark:bg-blue-950/30"
          />
        </div>
      </FaForm>
      <template #footer>
        <FaButton type="button" variant="outline" class="px-7 min-h-11" @click="currencyModalVisible = false">
          取消
        </FaButton>
        <FaButton
          type="button"
          class="px-7 min-h-11"
          :disabled="!selectedCurrencyAvailable || currencySelectionUnavailable"
          @click="enterCreatePage"
        >
          进入新增订单
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
