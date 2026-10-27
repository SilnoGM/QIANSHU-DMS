<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type {
  SalesOrderListStatusSelection,
  SalesOrderListViewMode,
  SalesOrderPendingActionItem,
  SalesOrderPendingActionKey,
} from './sales-order-list-view.logic'
import type { SalesOrderPaymentProgress } from './sales-order-list.logic'
import type {
  SalesOrderReceiptTab,
  SalesOrderRecordsInitialAction,
  SalesOrderRecordsKind,
} from './sales-order-records-modal.logic'
import type {
  FactoryShipmentResultDto,
  SalesOrderCurrencySummaryDto,
  SalesOrderFactoryShipmentContextDto,
  SalesOrderIssuerOptionDto,
  SalesOrderLinePreviewDto,
  SalesOrderListItemDto,
  SalesOrderStatusCountItemDto,
} from '@/api/generated/types.gen'
import type { SalesOrderListQuery } from '@/api/modules/sales-orders'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type {
  MoneyDiscountRate,
  MoneyDiscountRateTrend,
} from '@/components/base/MoneyInput/logic'
import type {
  FactoryShipmentIntent,
  FactoryShipmentModalContext,
} from '@/components/business/QsFactoryShipmentModal/types'
import type { ActionMenuItem, ActionWidthSpec } from '@/components/business/QsGenericTable/action-column-width'
import type {
  QsGenericTableActionColumn,
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'
import type {
  PurchaseStartPresetSalesOrder,
  PurchaseStartPresetValidationResult,
  PurchaseStartSelection,
} from '@/components/business/QsPurchaseStartModal/types'
import type {
  SalesOrderProductEditIntent,
  SalesOrderProductEditModalContext,
} from '@/components/business/QsSalesOrderProductsEditorModal/types'

import { getLocalTimeZone, today } from '@internationalized/date'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { resolveMoneyDiscountRate } from '@/components/base/MoneyInput/logic'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import QsFactoryShipmentModal from '@/components/business/QsFactoryShipmentModal/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsPurchaseStartModal from '@/components/business/QsPurchaseStartModal/index.vue'
import { buildPurchaseStartRouteQuery } from '@/components/business/QsPurchaseStartModal/logic'
import PendingPurchaseProducts from '@/components/business/QsPurchaseStartModal/pending-purchase-products.vue'
import QsSalesOrderProductsEditorModal from '@/components/business/QsSalesOrderProductsEditorModal/index.vue'
import {
  createSalesOrderProductEditLines,
  reconcileSalesOrderProductEditLines,
} from '@/components/business/QsSalesOrderProductsEditorModal/logic'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'

import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { mediaThumbnailUrl } from '@/utils/media-variant'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'
import SalesOrderCancelModal from './sales-order-cancel-modal.vue'
import { getSalesOrderCancelBlockedReason } from './sales-order-cancel.logic'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import SalesOrderDetailDrawer from './sales-order-detail-drawer.vue'
import {
  buildSalesOrderStatusCountsQuery,
  formatSalesFactoryShipmentSuccess,
  getSalesOrderStatusItems,
  normalizeSalesOrderStatusSelection,
  resolvePendingSalesOrderActionBlockedReason,
  resolvePendingSalesOrderActionSlot,
} from './sales-order-list-view.logic'
import {
  buildSalesOrderCustomerCopyText,
  calculateSalesOrderPaymentProgress,
  formatSalesOrderSummaryAmount,
} from './sales-order-list.logic'
import SalesOrderRecordsModal from './sales-order-records-modal.vue'
import SalesOrderWarehouseReceiptModal from './sales-order-warehouse-receipt-modal.vue'
import { formatSalesWarehouseReceiptSuccess } from './sales-order-warehouse-receipt.logic'
import { useSalesWarehouseReceipt } from './use-sales-warehouse-receipt'

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

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()

const canRead = computed(() => auth('sales-orders:read'))
const canCreate = computed(() => auth('sales-orders:create'))
const canUpdateProducts = computed(() => auth('sales-orders:update'))
const canCancelOrders = computed(() => auth('sales-orders:update'))
const canCreatePurchase = computed(() => auth('purchase-orders:create'))
const canFactoryShipment = computed(() => (
  auth('sales-orders:update')
  && auth('purchase-orders:update')
  && auth('purchase-orders:read')
))
const canWarehouseReceipt = computed(() => (
  auth('sales-orders:update')
  && auth('purchase-orders:update')
  && auth('purchase-orders:read')
))
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
const statusCountItems = ref<SalesOrderStatusCountItemDto[]>([])
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
const detailOrder = shallowRef<SalesOrderListItemDto | null>(null)
const currencyModalVisible = ref(false)
const selectedCurrency = ref<SalesOrderCurrencyCode | null>(null)
const recordsModalVisible = ref(false)
const recordsModalKind = ref<SalesOrderRecordsKind>('payments')
const recordsModalOrder = ref<SalesOrderListItemDto | null>(null)
const recordsModalInitialAction = ref<SalesOrderRecordsInitialAction>(null)
const recordsModalInitialReceiptTab = ref<SalesOrderReceiptTab>('payments')
const cancelModalVisible = ref(false)
const cancelOrder = shallowRef<SalesOrderListItemDto | null>(null)
const productEditVisible = ref(false)
const purchaseStartVisible = ref(false)
const purchaseStartPreset = shallowRef<PurchaseStartPresetSalesOrder | null>(null)
const productEditOrder = shallowRef<SalesOrderListItemDto | null>(null)
const productEditContext = shallowRef<SalesOrderProductEditModalContext | null>(null)
const productEditLines = ref<readonly OrderProductLineModel[]>([])
const productEditReason = ref('客户调整产品')
const productEditLoading = ref(false)
const productEditSubmitting = ref(false)
const productEditError = ref<string | null>(null)
const shipmentVisible = ref(false)
const shipmentOrder = shallowRef<SalesOrderListItemDto | null>(null)
const shipmentContext = shallowRef<FactoryShipmentModalContext | null>(null)
const shipmentLoading = ref(false)
const shipmentSubmitting = ref(false)
const shipmentError = ref<string | null>(null)
let requestVersion = 0
let countRequestVersion = 0
let listAbortController: AbortController | null = null
let countAbortController: AbortController | null = null
let productEditAbortController: AbortController | null = null
let productEditSubmitAbortController: AbortController | null = null
let shipmentContextAbortController: AbortController | null = null
let shipmentSubmitAbortController: AbortController | null = null
let queryRefreshPending = false
let queryRefreshIncludesCounts = false
const todayDate = today(getLocalTimeZone())

const {
  visible: warehouseReceiptVisible,
  context: warehouseReceiptContext,
  loading: warehouseReceiptLoading,
  submitting: warehouseReceiptSubmitting,
  error: warehouseReceiptError,
  timeError: warehouseReceiptTimeError,
  open: openWarehouseReceipt,
  reload: reloadWarehouseReceipt,
  submit: submitWarehouseReceipt,
  setVisible: setWarehouseReceiptVisible,
  dismissTimeError: dismissWarehouseReceiptTimeError,
} = useSalesWarehouseReceipt(
  canWarehouseReceipt,
  computed(() => appAccountStore.authEpoch),
  (result) => {
    toast.success(formatSalesWarehouseReceiptSuccess(result))
    scheduleQueryRefresh(true)
  },
)

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
const pageTitle = computed(() => props.viewMode === 'pending' ? '待办订单' : '全部订单')
const pageDescription = computed(() => props.viewMode === 'pending'
  ? '聚合当前需要推进的销售订单，并按履约阶段快速筛选。'
  : '订单、履约与付款状态独立展示；实际收款与定金/尾款分开统计。')
const tableEmptyTitle = computed(() => props.viewMode === 'pending'
  ? '暂无待办订单'
  : '暂无销售订单')
const tableEmptyDescription = computed(() => {
  return props.viewMode === 'pending'
    ? '当前筛选条件下没有需要处理的销售订单。'
    : '当前筛选条件下没有可展示的销售订单。'
})
/**
 * 状态切换写入 URL，保证刷新与浏览器前进/后退可恢复；“全部”使用无查询参数的规范地址。
 */
const selectedStatus = computed({
  get: () => normalizeSalesOrderStatusSelection(props.viewMode, route.query.status),
  set: (value: string) => {
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
/**
 * 待办每个 Tab 固定一个任务槽位 + 详情；待装柜没有行内任务，只保留详情。
 * 槽位按权限而不是行状态决定，避免同一 Tab 内按钮忽有忽无。
 */
const actionColumn = computed<QsGenericTableActionColumn>(() => {
  const actions: ActionWidthSpec[] = []
  if (props.viewMode === 'all') {
    if (canUpdateProducts.value && canCancelOrders.value) {
      actions.push(
        { chars: 2, kind: 'text' },
        { chars: 2, kind: 'text' },
        { kind: 'icon' },
      )
    }
    else if (canUpdateProducts.value || canCancelOrders.value) {
      actions.push({ chars: 2, kind: 'text' }, { chars: 2, kind: 'text' })
    }
    else {
      actions.push({ chars: 2, kind: 'text' })
    }
  }
  else {
    const slotKey = pendingSlotActionKey(selectedStatus.value)
    if (slotKey !== null && canShowSalesOrderRowActionKey(slotKey)) {
      actions.push({
        chars: slotKey === 'RECORD_PAYMENT' ? 4 : 2,
        kind: 'text',
      })
    }
    actions.push({ chars: 2, kind: 'text' })
  }
  const width = resolveActionColumnWidth(actions)
  return { fixed: 'right', maxWidth: width, minWidth: width, title: '操作', width }
})

const statusItems = computed(() => withStatusSwitchCounts(
  getSalesOrderStatusItems(props.viewMode),
  statusCountItems.value,
  {
    selectedValue: selectedStatus.value,
    selectedCount: loading.value ? undefined : total.value,
  },
))

/**
 * 首次打开、刷新和浏览器回退都可能带入旧状态参数。先清理当前工具栏未声明的值，
 * 再加载列表，避免界面已经回落到默认项而地址栏仍保留失效状态。
 */
function ensureCanonicalSalesOrderStatusQuery(): boolean {
  // 全部订单与待办订单共用本组件；另一个视图在 KeepAlive 停用期间仍可能读到
  // 新路由的查询参数，必须只让当前视图处理自己的状态值，避免把对方的 status 删掉。
  const ownRouteName = props.viewMode === 'pending'
    ? 'qsOperationsPendingSalesOrders'
    : 'qsOperationsSalesOrders'
  if (route.name !== ownRouteName) {
    return false
  }
  // 无 status 时仍要继续加载默认视图；只有查询参数需要规范化时才处理 URL。
  if (route.query.status === undefined) {
    return true
  }
  const normalized = normalizeSalesOrderStatusSelection(
    props.viewMode,
    route.query.status,
  )
  const declaredStatus = getSalesOrderStatusItems(props.viewMode)
    .some(item => item.value === route.query.status)
  if (normalized !== 'ALL' && declaredStatus) {
    return true
  }
  const nextQuery = { ...route.query }
  delete nextQuery.status
  void router.replace({ query: nextQuery })
  return false
}

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
    minWidth: 168,
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
  { accessorKey: 'paymentRecordCount', align: 'right', id: 'paymentRecordsSummary', minWidth: 180, title: '收款申请记录' },
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
        // 列表位下发缩略图，点击预览仍读取原件。
        previewSrc: preview.mainImage.contentUrl,
        src: mediaThumbnailUrl(preview.mainImage.contentUrl) ?? preview.mainImage.contentUrl,
        tooltip: preview.productName,
      }])
}

// 行数据不变时复用同一份图片数组，避免每次渲染都触发 ImageGroup 的深度监听。
const productImageItemsByOrderId = computed(() => new Map(
  rows.value.map(row => [row.id, productImageItems(row)] as const),
))

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
  initialReceiptTab: SalesOrderReceiptTab = 'payments',
): void {
  recordsModalInitialAction.value = null
  recordsModalInitialReceiptTab.value = initialReceiptTab
  recordsModalKind.value = kind
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

function paymentRecordRows(order: SalesOrderListItemDto) {
  return [
    {
      ariaLabel: `查看 ${order.validPaymentRecordCount} 项有效实际收款记录`,
      count: order.validPaymentRecordCount,
      countClass: order.validPaymentRecordCount > 0 ? 'text-primary' : 'text-foreground',
      key: 'valid',
      label: '有效',
      tab: 'payments' as const,
    },
    {
      ariaLabel: `查看 ${order.pendingReceiptRequestCount} 项待审收款申请`,
      count: order.pendingReceiptRequestCount,
      countClass: order.pendingReceiptRequestCount > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
      key: 'pending',
      label: '待审',
      tab: 'requests' as const,
    },
  ]
}

function openSalesOrderDetail(order: SalesOrderListItemDto): void {
  detailOrder.value = { ...order }
  detailVisible.value = true
}

function salesOrderCancelBlockedReason(order: SalesOrderListItemDto): string | null {
  return getSalesOrderCancelBlockedReason({
    viewMode: props.viewMode,
    canUpdate: canCancelOrders.value,
    orderStatus: order.orderStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    activePurchaseOrderCount: order.activePurchaseOrderCount,
  })
}

function openSalesOrderCancel(order: SalesOrderListItemDto): void {
  const blockedReason = salesOrderCancelBlockedReason(order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  cancelOrder.value = { ...order }
  cancelModalVisible.value = true
}

function handleSalesOrderCancelled(): void {
  scheduleQueryRefresh(true)
}

function detailMenuItems(order: SalesOrderListItemDto): ActionMenuItem[][] {
  return [[{ label: '详情', handle: () => openSalesOrderDetail(order) }]]
}

const PRODUCT_EDIT_FULFILLMENT_STATUSES = new Set([
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
])

function salesOrderProductEditBlockedReason(order: SalesOrderListItemDto): string | null {
  if (props.viewMode !== 'all') {
    return '待办视图不提供修改产品入口'
  }
  if (!canUpdateProducts.value) {
    return '当前账号无权修改销售订单产品'
  }
  if (order.orderStatus !== 'CONFIRMED') {
    return '只有已确认订单可以修改产品'
  }
  return PRODUCT_EDIT_FULFILLMENT_STATUSES.has(order.fulfillmentStatus)
    ? null
    : '订单已进入海运或已签收，不能修改产品'
}

function copyProductEditContext(
  context: import('@/api/generated/types.gen').SalesOrderProductEditContextDto,
): SalesOrderProductEditModalContext {
  return {
    ...context,
    salesOrder: { ...context.salesOrder },
    amounts: { ...context.amounts },
    existingLines: context.existingLines.map(line => ({
      ...line,
      mainImage: line.mainImage ?? null,
    })),
  }
}

async function loadProductEditContext(preserveDraft = false): Promise<void> {
  const order = productEditOrder.value
  if (order === null) {
    return
  }
  productEditAbortController?.abort()
  const controller = new AbortController()
  productEditAbortController = controller
  productEditLoading.value = true
  productEditError.value = null
  const previousContext = productEditContext.value
  const previousLines = productEditLines.value
  try {
    const response = await salesOrdersApi.productEditContext(order.id, controller.signal)
    if (controller.signal.aborted || productEditOrder.value?.id !== order.id) {
      return
    }
    const nextContext = copyProductEditContext(response.data)
    const freshLines = createSalesOrderProductEditLines(nextContext)
    productEditContext.value = nextContext
    productEditLines.value = preserveDraft && previousContext !== null
      ? reconcileSalesOrderProductEditLines({
          previousContext,
          nextContext,
          previousLines,
        })
      : freshLines
  }
  catch (error) {
    if (isSalesOrderAbortError(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    productEditError.value = failure.requestId === undefined
      ? failure.message
      : `${failure.message}（requestId: ${failure.requestId}）`
  }
  finally {
    if (productEditAbortController === controller) {
      productEditAbortController = null
      productEditLoading.value = false
    }
  }
}

function openProductEdit(order: SalesOrderListItemDto): void {
  const blockedReason = salesOrderProductEditBlockedReason(order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  productEditOrder.value = { ...order }
  productEditContext.value = null
  productEditLines.value = []
  productEditReason.value = '客户调整产品'
  productEditError.value = null
  productEditVisible.value = true
  void loadProductEditContext()
}

const loadProductEditProducts: ProductPageLoader = async (query, signal) => {
  const order = productEditOrder.value
  if (order === null || query.currencyCode === 'CNY') {
    return {
      items: [],
      categories: [],
      unclassifiedCount: 0,
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
    }
  }
  const response = await salesOrdersApi.productEditOptions(order.id, {
    ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    supplierValue: query.supplierValue,
    ...(query.categoryName === undefined ? {} : { categoryName: query.categoryName }),
    ...(query.productHeadName === undefined ? {} : { productHeadName: query.productHeadName }),
    ...(query.unclassified === true ? { unclassified: true } : {}),
    page: query.page,
    pageSize: query.pageSize,
  }, signal)
  return {
    ...response.data,
    items: response.data.items.map(item => ({
      ...item,
      mainImage: item.mainImage ?? null,
    })),
  }
}

async function submitProductEdit(intent: SalesOrderProductEditIntent): Promise<void> {
  const order = productEditOrder.value
  if (order === null || productEditSubmitting.value) {
    return
  }
  productEditSubmitAbortController?.abort()
  const controller = new AbortController()
  productEditSubmitAbortController = controller
  productEditSubmitting.value = true
  productEditError.value = null
  try {
    await salesOrdersApi.updateProducts(order.id, {
      expectedVersion: intent.expectedVersion,
      reason: intent.reason,
      confirmDepositReduction: intent.confirmDepositReduction,
      existingLines: intent.existingLines.map(line => ({ ...line })),
      newLines: intent.newLines.map(line => ({ ...line })),
    }, controller.signal)
    if (controller.signal.aborted || productEditOrder.value?.id !== order.id) {
      return
    }
    productEditVisible.value = false
    productEditOrder.value = null
    productEditContext.value = null
    productEditLines.value = []
    toast.success('销售订单产品已更新')
    scheduleQueryRefresh(true)
  }
  catch (error) {
    if (isSalesOrderAbortError(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    productEditError.value = failure.requestId === undefined
      ? failure.message
      : `${failure.message}（requestId: ${failure.requestId}）`
  }
  finally {
    if (productEditSubmitAbortController === controller) {
      productEditSubmitAbortController = null
      productEditSubmitting.value = false
    }
  }
}

function handleProductEditVisibility(value: boolean): void {
  productEditVisible.value = value
  if (value) {
    return
  }
  productEditAbortController?.abort()
  productEditSubmitAbortController?.abort()
  productEditOrder.value = null
  productEditContext.value = null
  productEditLines.value = []
  productEditError.value = null
}

function handleSalesOrderDetailClosed(): void {
  detailOrder.value = null
}

/** 表格操作列直接进入对应业务表单；记录弹窗原有标题区入口继续保留。 */
function openRecordsAction(
  action: Exclude<SalesOrderRecordsInitialAction, null>,
  order: SalesOrderListItemDto,
): void {
  recordsModalInitialAction.value = action
  recordsModalInitialReceiptTab.value = 'payments'
  recordsModalKind.value = action === 'payment' ? 'payments' : 'documents'
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

function pendingSlotActionKey(
  selection: SalesOrderListStatusSelection,
): SalesOrderPendingActionKey | null {
  switch (selection) {
    case 'AWAITING_PURCHASE_REVIEW': return 'URGE_PURCHASE_REVIEW'
    case 'WAITING_PAYMENT': return 'RECORD_PAYMENT'
    case 'PENDING': return 'SUBMIT_PURCHASE'
    case 'PREPARING': return 'FACTORY_SHIPMENT'
    case 'LAND_TRANSIT': return 'WAREHOUSE_RECEIPT'
    case 'SEA_TRANSIT': return 'DELIVERY_RECEIPT'
    default: return null
  }
}

/** 已落地动作继续遵守原权限；催办不改变数据，仅向有读取权限的用户说明能力状态。 */
function canShowSalesOrderRowActionKey(key: SalesOrderPendingActionKey): boolean {
  if (key === 'SUBMIT_PURCHASE') {
    return canCreatePurchase.value
  }
  if (key === 'RECORD_PAYMENT') {
    return canRecordPayment.value
  }
  if (key === 'DELIVERY_RECEIPT') {
    return canSubmitDeliveryReceipt.value
  }
  if (key === 'FACTORY_SHIPMENT') {
    return canFactoryShipment.value
  }
  if (key === 'WAREHOUSE_RECEIPT') {
    return canWarehouseReceipt.value
  }
  return true
}

function pendingSlotActions(order: SalesOrderListItemDto): SalesOrderPendingActionItem[] {
  if (props.viewMode !== 'pending') {
    return []
  }
  const selection = selectedStatus.value
  const slotKey = pendingSlotActionKey(selection)
  if (slotKey === null || !canShowSalesOrderRowActionKey(slotKey)) {
    return []
  }
  const action = resolvePendingSalesOrderActionSlot(selection, order)
  return action === null ? [] : [action]
}

function shortPendingActionLabel(action: SalesOrderPendingActionItem): string {
  switch (action.key) {
    case 'SUBMIT_PURCHASE': return '采购'
    case 'FACTORY_SHIPMENT': return '发货'
    case 'WAREHOUSE_RECEIPT': return '入仓'
    case 'DELIVERY_RECEIPT': return '签收'
    case 'RECORD_PAYMENT': return '表外收款'
    case 'URGE_PURCHASE_REVIEW': return '催办'
  }
  return action.label
}

function copyFactoryShipmentContext(
  context: SalesOrderFactoryShipmentContextDto,
): FactoryShipmentModalContext {
  return {
    salesOrder: { ...context.salesOrder },
    purchaseOrders: context.purchaseOrders.map(order => ({
      ...order,
      supplier: { label: order.supplier.label },
      lineSummary: {
        ...order.lineSummary,
        previews: order.lineSummary.previews.map(preview => ({
          ...preview,
          mainImage: preview.mainImage === null ? null : { ...preview.mainImage },
        })),
      },
    })),
  }
}

function factoryShipmentFailureMessage(error: unknown): string {
  const failure = getSalesOrderApiFailure(error)
  const message = failure.requestId === undefined
    ? failure.message
    : `${failure.message}（requestId: ${failure.requestId}）`
  return `${message}。请重新加载最新发货范围后再次确认。`
}

async function loadSalesFactoryShipmentContext(): Promise<void> {
  const order = shipmentOrder.value
  if (order === null || !canFactoryShipment.value) {
    return
  }
  shipmentContextAbortController?.abort()
  const controller = new AbortController()
  shipmentContextAbortController = controller
  shipmentLoading.value = true
  shipmentError.value = null
  const authEpoch = appAccountStore.authEpoch
  try {
    const response = await salesOrdersApi.factoryShipmentContext(order.id, controller.signal)
    if (
      controller.signal.aborted
      || shipmentOrder.value?.id !== order.id
      || authEpoch !== appAccountStore.authEpoch
      || !shipmentVisible.value
    ) {
      return
    }
    shipmentContext.value = copyFactoryShipmentContext(response.data)
  }
  catch (error) {
    if (!controller.signal.aborted && !isSalesOrderAbortError(error)) {
      shipmentError.value = factoryShipmentFailureMessage(error)
    }
  }
  finally {
    if (shipmentContextAbortController === controller) {
      shipmentContextAbortController = null
      shipmentLoading.value = false
    }
  }
}

function openSalesFactoryShipment(order: SalesOrderListItemDto): void {
  if (!canFactoryShipment.value) {
    return
  }
  shipmentContextAbortController?.abort()
  shipmentSubmitAbortController?.abort()
  shipmentOrder.value = { ...order }
  shipmentContext.value = null
  shipmentError.value = null
  shipmentVisible.value = true
  void loadSalesFactoryShipmentContext()
}

function closeSalesFactoryShipment(force = false): void {
  if (shipmentSubmitting.value && !force) {
    return
  }
  shipmentContextAbortController?.abort()
  shipmentSubmitAbortController?.abort()
  shipmentContextAbortController = null
  shipmentSubmitAbortController = null
  shipmentVisible.value = false
  shipmentOrder.value = null
  shipmentContext.value = null
  shipmentError.value = null
  shipmentLoading.value = false
}

async function submitSalesFactoryShipment(intent: FactoryShipmentIntent): Promise<void> {
  const order = shipmentOrder.value
  if (order === null || shipmentSubmitting.value || !canFactoryShipment.value) {
    return
  }
  shipmentSubmitAbortController?.abort()
  const controller = new AbortController()
  shipmentSubmitAbortController = controller
  shipmentSubmitting.value = true
  shipmentError.value = null
  try {
    const response = await salesOrdersApi.factoryShipment(order.id, {
      mode: intent.mode,
      targets: intent.targets.map(target => ({
        ...target,
        partIds: [...target.partIds],
        trackingNumbers: target.trackingNumbers?.map(item => ({ ...item })),
        destinationWarehouses: target.destinationWarehouses.map(item => ({ ...item })),
      })),
      reason: intent.reason,
    }, controller.signal)
    if (
      controller.signal.aborted
      || shipmentOrder.value?.id !== order.id
      || !shipmentVisible.value
    ) {
      return
    }
    const result: FactoryShipmentResultDto = response.data
    toast.success(formatSalesFactoryShipmentSuccess(result))
    shipmentSubmitting.value = false
    closeSalesFactoryShipment()
    scheduleQueryRefresh(true)
  }
  catch (error) {
    if (!controller.signal.aborted && !isSalesOrderAbortError(error)) {
      shipmentError.value = factoryShipmentFailureMessage(error)
    }
  }
  finally {
    if (shipmentSubmitAbortController === controller) {
      shipmentSubmitAbortController = null
      shipmentSubmitting.value = false
    }
  }
}

function handleSalesOrderRowAction(
  action: SalesOrderPendingActionItem,
  order: SalesOrderListItemDto,
): void {
  if (!canShowSalesOrderRowActionKey(action.key)) {
    toast.info('当前账号无权执行该操作')
    return
  }
  const blockedReason = resolvePendingSalesOrderActionBlockedReason(action.key, order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  if (action.key === 'SUBMIT_PURCHASE') {
    const { id, orderNo } = order
    purchaseStartPreset.value = { id, orderNo }
    purchaseStartVisible.value = true
    return
  }
  if (action.key === 'RECORD_PAYMENT') {
    openRecordsModal('payments', order)
    return
  }
  if (action.key === 'DELIVERY_RECEIPT') {
    openRecordsAction('receipt', order)
    return
  }
  if (action.key === 'FACTORY_SHIPMENT') {
    openSalesFactoryShipment(order)
    return
  }
  if (action.key === 'WAREHOUSE_RECEIPT') {
    void openWarehouseReceipt(order.id)
    return
  }
  // 催办尚无通知通道：只提示能力状态，不写数据、不打开任何表单。
  if (action.key === 'URGE_PURCHASE_REVIEW') {
    toast.info('催办功能开发中')
  }
}

async function validatePresetPurchaseSource(
  selection: PurchaseStartSelection,
  presetSalesOrder: PurchaseStartPresetSalesOrder,
  signal: AbortSignal,
): Promise<PurchaseStartPresetValidationResult> {
  try {
    const views = ['UNPURCHASED', 'PARTIALLY_PURCHASED'] as const
    for (const view of views) {
      const response = await purchaseOrdersApi.sourceSalesOrders({
        page: 1,
        pageSize: 1,
        productMode: selection.productMode,
        salesOrderId: presetSalesOrder.id,
        ...(selection.productMode === 'CATALOG'
          ? { supplierValue: selection.supplierValue! }
          : {}),
        view,
      }, signal)
      if (response.data.items.some(item => item.id === presetSalesOrder.id)) {
        return { eligible: true }
      }
    }
    return {
      eligible: false,
      message: '该销售订单没有符合当前产品类型和供应商条件的待采购产品',
    }
  }
  catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new Error(getPurchaseOrderApiFailure(error).message)
  }
}

async function enterPresetPurchaseCreate(selection: PurchaseStartSelection): Promise<void> {
  const preset = purchaseStartPreset.value
  if (preset === null) {
    return
  }
  purchaseStartVisible.value = false
  try {
    await router.push({
      name: 'operationsPurchaseOrderCreate',
      query: buildPurchaseStartRouteQuery(selection, preset),
    })
  }
  catch {
    toast.error('无法进入新增采购页面，请重试')
    purchaseStartVisible.value = true
  }
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
    // 出单人选项只在当前页面生命周期内加载一次，并与首屏列表共用取消与鉴权世代边界。
    // 这样既不会要求用户额外拥有 users:read，也能保留已停用历史出单人的筛选能力。
    const [response, issuerOptionsResponse] = await Promise.all([
      salesOrdersApi.list({
        ...buildListQuery(),
        view: props.viewMode,
        statusSelection: selectedStatus.value,
      }, controller.signal),
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

async function loadStatusCounts(): Promise<void> {
  if (!canRead.value) {
    return
  }
  countAbortController?.abort()
  closeSalesFactoryShipment(true)
  const controller = new AbortController()
  countAbortController = controller
  const version = ++countRequestVersion
  const authEpoch = appAccountStore.authEpoch
  try {
    const response = await salesOrdersApi.statusCounts(
      buildSalesOrderStatusCountsQuery(buildListQuery(), props.viewMode),
      controller.signal,
    )
    if (
      controller.signal.aborted
      || version !== countRequestVersion
      || authEpoch !== appAccountStore.authEpoch
      || !canRead.value
    ) {
      return
    }
    statusCountItems.value = response.data.items.map(item => ({ ...item }))
  }
  catch (error) {
    // 计数是列表的辅助信息；失败时保留上次快照或初始 0，不覆盖列表主错误。
    if (!isSalesOrderAbortError(error) && version === countRequestVersion) {
      statusCountItems.value = []
    }
  }
  finally {
    if (countAbortController === controller) {
      countAbortController = null
    }
  }
}

function scheduleQueryRefresh(refreshCounts = false): void {
  queryRefreshIncludesCounts ||= refreshCounts
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    const shouldRefreshCounts = queryRefreshIncludesCounts
    queryRefreshPending = false
    queryRefreshIncludesCounts = false
    void loadOrders()
    if (shouldRefreshCounts) {
      void loadStatusCounts()
    }
  })
}

function retryOrders(): void {
  scheduleQueryRefresh(true)
}

function handleSalesOrderDetailUpdated(): void {
  scheduleQueryRefresh(true)
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
  scheduleQueryRefresh(true)
}

function handleFilterChange(value: QsGenericTableFilterValues): void {
  filters.value = { ...value }
  page.value = 1
  scheduleQueryRefresh(true)
}

function handlePaginationChange(): void {
  scheduleQueryRefresh()
}

function handleDateRangeComplete(): void {
  page.value = 1
  scheduleQueryRefresh(true)
}

function clearDateRange(): void {
  dateRange.value = { end: undefined, start: undefined }
  page.value = 1
  scheduleQueryRefresh(true)
}

function orderStatusLabel(value: SalesOrderListItemDto['orderStatus']): string {
  return {
    DRAFT: '草稿',
    CONFIRMED: '已确认',
    PENDING_RECONCILIATION: '待对账',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  }[value]
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

/**
 * 停留原因由服务端按完成判定（口径 R3）下发，只有待对账订单会有值：
 * 短标签进单元格、完整解释放 tooltip，避免表格行高被长文案撑开。
 */
function completionHoldLabel(hold: SalesOrderListItemDto['completionHold']): string {
  if (hold === null) {
    return ''
  }
  return {
    PAYMENT_INCOMPLETE: '等待收齐款项',
    RECONCILIATION_IN_PROGRESS: '对账进行中',
    AWAITING_RECONCILIATION_COVERAGE: '等待账单对账',
  }[hold.reason]
}

function completionHoldHint(hold: SalesOrderListItemDto['completionHold']): string {
  if (hold === null) {
    return ''
  }
  if (hold.reason === 'PAYMENT_INCOMPLETE') {
    return '订单需已签收且已收齐款项，系统才会在对账完成后自动推进为已完成'
  }
  if (hold.reason === 'RECONCILIATION_IN_PROGRESS') {
    return hold.unreconciledMemberCount > 0
      ? `还有 ${hold.pendingBatchCount} 个对账批次未结束、${hold.unreconciledMemberCount} 行待核对，批次全部结束后自动完成`
      : `还有 ${hold.pendingBatchCount} 个对账批次未结束，批次全部结束后自动完成`
  }
  return '该订单尚未被账单对账覆盖，账单对账完成后自动完成'
}

/**
 * 采购审核中原因与停留原因同构：短标签进单元格、完整解释放 tooltip。
 * 该原因只由服务端按采购覆盖事实下发，前端不根据本地状态重新推断。
 */
function purchaseHoldLabel(hold: SalesOrderListItemDto['purchaseHold']): string {
  if (hold === null) {
    return ''
  }
  return { AWAITING_PURCHASE_REVIEW: '采购审核中' }[hold.reason]
}

function purchaseHoldHint(hold: SalesOrderListItemDto['purchaseHold']): string {
  if (hold === null) {
    return ''
  }
  return `该订单的待采购数量已被 ${hold.pendingReviewOrderCount} 张采购单占用，审核通过后自动进入待发货`
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
    PENDING_RECONCILIATION: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    COMPLETED: 'border-primary/30 bg-primary/10 text-primary',
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

watch(() => appAccountStore.authEpoch, () => {
  requestVersion += 1
  countRequestVersion += 1
  listAbortController?.abort()
  countAbortController?.abort()
  rows.value = []
  purchaseStartVisible.value = false
  purchaseStartPreset.value = null
  statusCountItems.value = []
  total.value = 0
  if (canRead.value) {
    scheduleQueryRefresh(true)
  }
})

watch([
  () => props.viewMode,
  () => route.query.status,
], ([nextMode], [previousMode]) => {
  page.value = 1
  if (!ensureCanonicalSalesOrderStatusQuery()) {
    return
  }
  scheduleQueryRefresh(nextMode !== previousMode)
})

onMounted(() => {
  if (ensureCanonicalSalesOrderStatusQuery()) {
    scheduleQueryRefresh(true)
  }
})
// 页面被 KeepAlive 缓存后，返回时 onMounted 不会再次触发；首次激活由 onMounted 负责。
let pageActivated = false
onActivated(() => {
  if (!pageActivated) {
    pageActivated = true
    return
  }
  if (ensureCanonicalSalesOrderStatusQuery()) {
    scheduleQueryRefresh(true)
  }
})
onBeforeUnmount(() => {
  requestVersion += 1
  countRequestVersion += 1
  listAbortController?.abort()
  countAbortController?.abort()
  productEditAbortController?.abort()
  productEditSubmitAbortController?.abort()
  shipmentContextAbortController?.abort()
  shipmentSubmitAbortController?.abort()
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
        :action-column="actionColumn"
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
        table-class="w-max min-w-full"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="retryOrders"
        @search="handleSearch"
      >
        <template #query-leading>
          <QsDateRangeFilter
            v-model="dateRange"
            :max-value="todayDate"
            calendar-label="出单日期范围"
            placeholder="出单日期范围"
            @complete="handleDateRangeComplete"
            @clear="clearDateRange"
          />
        </template>

        <template #actions="{ row }">
          <div class="flex flex-wrap gap-1 items-center">
            <template v-if="props.viewMode === 'all'">
              <FaButton
                v-if="canUpdateProducts"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：编辑`"
                @click="openProductEdit(row)"
              >
                编辑
              </FaButton>
              <FaTooltip
                v-if="canCancelOrders"
                :text="salesOrderCancelBlockedReason(row) ?? ''"
                :disabled="salesOrderCancelBlockedReason(row) === null"
              >
                <span class="inline-flex">
                  <FaButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="text-destructive min-h-11 sm:min-h-8"
                    :disabled="salesOrderCancelBlockedReason(row) !== null"
                    :aria-label="`${row.orderNo}：取消订单`"
                    @click="openSalesOrderCancel(row)"
                  >
                    取消
                  </FaButton>
                </span>
              </FaTooltip>
              <FaButton
                v-if="!(canUpdateProducts && canCancelOrders)"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：详情`"
                @click="openSalesOrderDetail(row)"
              >
                详情
              </FaButton>
              <FaButton
                v-if="canUpdateProducts && canCancelOrders"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8 md:hidden"
                :aria-label="`${row.orderNo}：详情`"
                @click="openSalesOrderDetail(row)"
              >
                详情
              </FaButton>
              <FaDropdown
                v-if="canUpdateProducts && canCancelOrders"
                :items="detailMenuItems(row)"
                align="end"
              >
                <FaButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="min-h-11 min-w-11 hidden md:inline-flex sm:min-h-8 sm:min-w-8"
                  :aria-label="`${row.orderNo}：更多操作`"
                >
                  <FaIcon name="i-lucide:ellipsis-vertical" class="size-4" aria-hidden="true" />
                </FaButton>
              </FaDropdown>
            </template>
            <template v-else>
              <FaButton
                v-for="action in pendingSlotActions(row)"
                :key="action.key"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：${action.label}`"
                @click="handleSalesOrderRowAction(action, row)"
              >
                {{ shortPendingActionLabel(action) }}
              </FaButton>
              <FaButton
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：详情`"
                @click="openSalesOrderDetail(row)"
              >
                详情
              </FaButton>
            </template>
          </div>
        </template>

        <template #cell-orderSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine nowrap content-class="qs-type-data-emphasis">
              <QsCopyableText label="订单编号" :text="row.original.orderNo" />
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
            class="max-w-[9rem]" :avatar-url="row.original.issuer.avatarUrl"
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
            :items="productImageItemsByOrderId.get(row.original.id) ?? []"
            :max-count="3"
            :size="40"
            radius="md"
            tooltip-mode="native"
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
          <QsTableStackedCell class="w-full">
            <button
              v-for="item in paymentRecordRows(row.original)"
              :key="item.key"
              type="button"
              class="group px-1 py-0.5 text-left border-0 rounded-sm bg-transparent flex gap-3 w-full transition-colors items-center justify-end -mx-1 focus-visible:outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-primary/40"
              :aria-label="item.ariaLabel"
              @click="openRecordsModal('payments', row.original, item.tab)"
            >
              <span class="qs-type-meta shrink-0">{{ item.label }}</span>
              <span class="flex gap-1 items-baseline">
                <span class="qs-type-data-emphasis" :class="item.countClass">{{ item.count }}</span>
                <span class="text-xs text-foreground">项记录</span>
              </span>
              <FaIcon
                name="i-lucide:chevron-right"
                class="text-muted-foreground shrink-0 size-3"
                aria-hidden="true"
              />
            </button>
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
            <QsTableStackedLine
              v-if="row.original.completionHold"
              label="停留原因"
              tone="muted"
              nowrap
            >
              <FaTooltip :text="completionHoldHint(row.original.completionHold)">
                <span class="qs-type-meta underline underline-offset-4 decoration-dotted">
                  {{ completionHoldLabel(row.original.completionHold) }}
                </span>
              </FaTooltip>
            </QsTableStackedLine>
            <QsTableStackedLine
              v-if="row.original.purchaseHold"
              label="采购状态"
              tone="muted"
              nowrap
            >
              <FaTooltip :text="purchaseHoldHint(row.original.purchaseHold)">
                <span class="qs-type-meta underline underline-offset-4 decoration-dotted">
                  {{ purchaseHoldLabel(row.original.purchaseHold) }}
                </span>
              </FaTooltip>
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
                <QsTableStackedLine content-class="qs-type-data-emphasis break-all">
                  <QsCopyableText label="订单编号" :text="row.orderNo" />
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
                    class="max-w-full" :avatar-url="row.issuer.avatarUrl"
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
                  <ImageGroup :items="productImageItemsByOrderId.get(row.id) ?? []" :max-count="3" :size="40" radius="md" tooltip-mode="native">
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
                  <QsTableStackedCell class="w-full">
                    <button
                      v-for="item in paymentRecordRows(row)"
                      :key="item.key"
                      type="button"
                      class="group px-1 py-1 text-left border-0 rounded-sm bg-transparent flex gap-3 w-full transition-colors items-center justify-end -mx-1 focus-visible:outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-primary/40"
                      :aria-label="item.ariaLabel"
                      @click="openRecordsModal('payments', row, item.tab)"
                    >
                      <span class="qs-type-meta shrink-0">{{ item.label }}</span>
                      <span class="flex gap-1 items-baseline">
                        <span class="qs-type-data-emphasis" :class="item.countClass">{{ item.count }}</span>
                        <span class="text-xs text-foreground">项记录</span>
                      </span>
                      <FaIcon
                        name="i-lucide:chevron-right"
                        class="text-muted-foreground shrink-0 size-3"
                        aria-hidden="true"
                      />
                    </button>
                  </QsTableStackedCell>
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
                    <QsTableStackedLine
                      v-if="row.completionHold"
                      label="停留原因"
                      tone="muted"
                      nowrap
                    >
                      <FaTooltip :text="completionHoldHint(row.completionHold)">
                        <span class="qs-type-meta underline underline-offset-4 decoration-dotted">
                          {{ completionHoldLabel(row.completionHold) }}
                        </span>
                      </FaTooltip>
                    </QsTableStackedLine>
                    <QsTableStackedLine
                      v-if="row.purchaseHold"
                      label="采购状态"
                      tone="muted"
                      nowrap
                    >
                      <FaTooltip :text="purchaseHoldHint(row.purchaseHold)">
                        <span class="qs-type-meta underline underline-offset-4 decoration-dotted">
                          {{ purchaseHoldLabel(row.purchaseHold) }}
                        </span>
                      </FaTooltip>
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

    <SalesOrderDetailDrawer
      v-model="detailVisible"
      :order="detailOrder"
      :currencies="currencyCatalog.currencies.value"
      @closed="handleSalesOrderDetailClosed"
    />

    <SalesOrderRecordsModal
      v-model="recordsModalVisible"
      :kind="recordsModalKind"
      :initial-action="recordsModalInitialAction"
      :initial-receipt-tab="recordsModalInitialReceiptTab"
      :order="recordsModalOrder"
      :currencies="currencyCatalog.currencies.value"
      @detail-updated="handleSalesOrderDetailUpdated"
    />

    <SalesOrderCancelModal
      v-model="cancelModalVisible"
      :order="cancelOrder"
      :currencies="currencyCatalog.currencies.value"
      @cancelled="handleSalesOrderCancelled"
    />

    <QsSalesOrderProductsEditorModal
      :model-value="productEditVisible"
      :context="productEditContext"
      :lines="productEditLines"
      :reason="productEditReason"
      :currencies="currencyCatalog.currencies.value"
      :load-products="loadProductEditProducts"
      :loading="productEditLoading"
      :error="productEditError"
      :submitting="productEditSubmitting"
      @update:model-value="handleProductEditVisibility"
      @update:lines="productEditLines = $event"
      @update:reason="productEditReason = $event"
      @validation-error="toast.warning($event)"
      @retry="loadProductEditContext(true)"
      @confirm="submitProductEdit"
    />

    <QsFactoryShipmentModal
      v-model="shipmentVisible"
      mode="SALES_ORDER"
      :context="shipmentContext"
      :loading="shipmentLoading"
      :submitting="shipmentSubmitting"
      :error="shipmentError"
      @submit="submitSalesFactoryShipment"
      @cancel="closeSalesFactoryShipment"
      @retry="loadSalesFactoryShipmentContext"
    />

    <SalesOrderWarehouseReceiptModal
      :model-value="warehouseReceiptVisible"
      :context="warehouseReceiptContext"
      :loading="warehouseReceiptLoading"
      :submitting="warehouseReceiptSubmitting"
      :error="warehouseReceiptError"
      :time-error="warehouseReceiptTimeError"
      @update:model-value="setWarehouseReceiptVisible"
      @submit="submitWarehouseReceipt"
      @retry="reloadWarehouseReceipt"
      @dismiss-time-error="dismissWarehouseReceiptTimeError"
    />

    <QsPurchaseStartModal
      v-model="purchaseStartVisible"
      purchase-type="SALES_LINKED"
      :preset-sales-order="purchaseStartPreset"
      :validate-preset="validatePresetPurchaseSource"
      @confirm="enterPresetPurchaseCreate"
      @validation-error="toast.warning($event)"
    >
      <template #preset-products>
        <PendingPurchaseProducts v-if="purchaseStartPreset" :order-id="purchaseStartPreset.id" :active="purchaseStartVisible" />
      </template>
    </QsPurchaseStartModal>

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
