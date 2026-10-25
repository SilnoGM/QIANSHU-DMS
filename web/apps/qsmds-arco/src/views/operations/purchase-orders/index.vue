<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type {
  PurchaseOrderListStatusSelection,
  PurchaseOrderListViewMode,
  PurchaseOrderPendingActionItem,
  PurchaseOrderPendingTask,
} from './purchase-order-list.logic'
import type { PurchaseOrderRecordsKind } from './purchase-order-records-modal.logic'
import type {
  FactoryShipmentResultDto,
  PurchaseOrderCurrencySummaryDto,
  PurchaseOrderDetailDto,
  PurchaseOrderLinePreviewDto,
  PurchaseOrderListItemDto,
  PurchaseOrderStatusCountItemDto,
} from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type {
  FactoryShipmentIntent,
  FactoryShipmentModalContext,
} from '@/components/business/QsFactoryShipmentModal/types'
import type { ActionMenuItem, ActionWidthSpec } from '@/components/business/QsGenericTable/action-column-width'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import type {
  PurchaseStartPurchaseType,
  PurchaseStartSelection,
} from '@/components/business/QsPurchaseStartModal/types'
import { getLocalTimeZone, today } from '@internationalized/date'

import purchaseOrdersApi from '@/api/modules/purchase-orders'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import QsFactoryShipmentModal from '@/components/business/QsFactoryShipmentModal/index.vue'
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
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { mediaThumbnailUrl } from '@/utils/media-variant'
import PurchaseOrderCancelModal from './purchase-order-cancel-modal.vue'
import {
  getPurchaseOrderCancelBlockedReason,
  purchaseOrderCancelBlockedMessage,
} from './purchase-order-cancel.logic'
import PurchaseOrderDetailDrawer from './purchase-order-detail-drawer.vue'
import PurchaseOrderListPaymentAction from './purchase-order-list-payment-action.vue'
import {
  buildPurchaseOrderListQuery,
  buildPurchaseOrderStatusCountsQuery,
  calculatePurchaseOrderPaymentProgress,
  formatPurchaseFactoryShipmentSuccess,
  formatPurchaseOrderSummaryAmount,
  fulfillmentStatusLabel,
  fulfillmentStatusTagClass,
  getPurchaseOrderApiFailure,
  getPurchaseOrderStatusItems,
  isPurchaseOrderAbortError,
  normalizePurchaseOrderStatusSelection,
  orderStatusLabel,
  orderStatusTagClass,
  paymentStatusLabel,
  paymentStatusTagClass,
  purchaseTypeShortLabel,
  purchaseTypeTagClass,
  resolvePurchaseOrderPendingActionBlockedReason,
  resolvePurchaseOrderPendingActionSlot,
  resolvePurchaseOrderWarehouseReceiptBlockedReason,
} from './purchase-order-list.logic'
import PurchaseOrderRecordSummaryCell from './purchase-order-record-summary-cell.vue'
import PurchaseOrderRecordsModal from './purchase-order-records-modal.vue'
import PurchaseOrderShippingMarksCell from './purchase-order-shipping-marks-cell.vue'
import PurchaseShipmentSummary from './purchase-shipment-summary.vue'
import PurchaseWarehouseReceiptAction from './purchase-warehouse-receipt-action.vue'

defineOptions({ name: 'QsOperationsPurchaseOrders' })

const props = withDefaults(defineProps<{
  viewMode?: PurchaseOrderListViewMode
}>(), {
  viewMode: 'all',
})

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const { t } = useI18n()
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
const canCancel = computed(() => auth('purchase-orders:update') || auth('purchase-orders:review'))
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const pageTitle = computed(() => props.viewMode === 'pending' ? '待办采购' : '全部采购')
const pageDescription = computed(() => props.viewMode === 'pending'
  ? '按采购审核中、待发货、待入仓和待付款分类处理采购订单。'
  : '查询所有采购订单及其销售来源、履约和付款状态。')
const selectedStatus = computed<string>({
  get: () => normalizePurchaseOrderStatusSelection(
    props.viewMode,
    props.viewMode === 'pending' ? route.query.task : route.query.status,
  ),
  set: (value) => {
    const normalized = normalizePurchaseOrderStatusSelection(props.viewMode, value)
    if (normalized === selectedStatus.value) {
      return
    }
    const nextQuery = { ...route.query }
    if (props.viewMode === 'pending') {
      delete nextQuery.status
      nextQuery.task = normalized
    }
    else {
      delete nextQuery.task
      if (normalized === 'ALL') {
        delete nextQuery.status
      }
      else {
        nextQuery.status = normalized
      }
    }
    void router.push({ query: nextQuery })
  },
})

const rows = ref<PurchaseOrderListItemDto[]>([])
const summariesByCurrency = ref<PurchaseOrderCurrencySummaryDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const statusCountItems = ref<PurchaseOrderStatusCountItemDto[]>([])
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
const cancelModalVisible = ref(false)
const cancelOrderId = ref<string | null>(null)
const recordsModalVisible = ref(false)
const recordsModalKind = ref<PurchaseOrderRecordsKind>('payments')
const recordsModalOrder = shallowRef<PurchaseOrderListItemDto | null>(null)
const purchaseStartVisible = ref(false)
const purchaseStartType = ref<PurchaseStartPurchaseType>('SALES_LINKED')
const shipmentVisible = ref(false)
const shipmentContext = shallowRef<FactoryShipmentModalContext | null>(null)
const shipmentDetail = shallowRef<PurchaseOrderDetailDto | null>(null)
const shipmentTarget = shallowRef<PurchaseOrderListItemDto | null>(null)
const shipmentContextLoading = ref(false)
const shipmentSubmitting = ref(false)
const shipmentError = ref<string | null>(null)
const warehouseActionRef = useTemplateRef<InstanceType<typeof PurchaseWarehouseReceiptAction>>('warehouseActionRef')
watch(() => route.fullPath, () => warehouseActionRef.value?.reset())
const warehouseLoadingOrderId = computed(() => warehouseActionRef.value?.loadingOrderId ?? null)
const paymentActionRef = useTemplateRef<InstanceType<typeof PurchaseOrderListPaymentAction>>('paymentActionRef')
const paymentLoadingOrderId = computed(() => paymentActionRef.value?.loadingOrderId ?? null)
const todayDate = today(getLocalTimeZone())
let requestVersion = 0
let countRequestVersion = 0
let listAbortController: AbortController | null = null
let countAbortController: AbortController | null = null
let shipmentAbortController: AbortController | null = null

const statusItems = computed(() => withStatusSwitchCounts(
  getPurchaseOrderStatusItems(props.viewMode),
  statusCountItems.value,
  {
    selectedValue: selectedStatus.value,
    selectedCount: loading.value ? undefined : total.value,
  },
))

// 详情始终可达；双权限时桌面收进更多菜单，移动端保持行内，避免操作列过宽。
const actionColumnWidth = computed(() => {
  if (props.viewMode === 'all') {
    const actions: ActionWidthSpec[] = []
    if (canUpdate.value && canCancel.value) {
      actions.push(
        { chars: 2, kind: 'text' },
        { chars: 2, kind: 'text' },
        { kind: 'icon' },
      )
    }
    else if (canUpdate.value || canCancel.value) {
      actions.push({ chars: 2, kind: 'text' }, { chars: 2, kind: 'text' })
    }
    else {
      actions.push({ chars: 2, kind: 'text' })
    }
    return resolveActionColumnWidth(actions)
  }
  const task = normalizePurchaseOrderStatusSelection(
    'pending',
    selectedStatus.value,
  ) as PurchaseOrderPendingTask
  const slotAction = resolvePurchaseOrderPendingActionSlot(task)
  return resolveActionColumnWidth(slotAction !== null && canShowPendingAction(slotAction)
    ? [{ chars: 2, kind: 'text' }, { chars: 2, kind: 'text' }]
    : [{ chars: 2, kind: 'text' }])
})

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
  key: 'fulfillmentStatus',
  label: '履约状态',
  options: [
    { label: '已下单', value: 'ORDERED' },
    { label: '备货中', value: 'PREPARING' },
    { label: '部分发货', value: 'PARTIALLY_SHIPPED' },
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

// 编号包含复制按钮，付款列包含标签和完整币种金额；最小宽度需覆盖这些复合内容。
// 记录列只承载图标数量入口，保持紧凑，不再沿用多行摘要的预留宽度。
const columns: QsGenericTableColumn<PurchaseOrderListItemDto>[] = [{
  accessorKey: 'orderNo',
  fixed: 'left',
  id: 'orderSummary',
  minWidth: 168,
  title: '采购订单',
}, {
  accessorKey: 'salesOrderNo',
  id: 'sourceSummary',
  minWidth: 260,
  title: '销售来源',
}, {
  accessorFn: item => item.supplier.label,
  id: 'supplierSummary',
  minWidth: 120,
  title: '供应商',
}, {
  accessorFn: item => item.createdBy.displayName,
  id: 'buyerSummary',
  minWidth: 140,
  title: '采购人',
}, {
  accessorFn: item => item.lineSummary.lineCount,
  id: 'productSummary',
  minWidth: 160,
  title: '产品',
}, {
  accessorKey: 'purchaseTotalAmount',
  align: 'right',
  id: 'amountSummary',
  minWidth: 200,
  title: '采购金额',
}, {
  accessorKey: 'depositDueAmount',
  align: 'right',
  id: 'termsSummary',
  minWidth: 240,
  title: '付款约定',
}, {
  accessorKey: 'paidAmount',
  align: 'right',
  id: 'paymentAmountSummary',
  minWidth: 240,
  title: '实际付款',
}, {
  accessorFn: item => item.paymentRecordSummary.totalCount,
  id: 'paymentRecordsSummary',
  minWidth: 150,
  title: t('purchaseOrderList.records.payments'),
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
  accessorKey: 'shippedPartCount',
  id: 'shipmentProgressSummary',
  minWidth: 180,
  title: t('purchaseOrderList.shipmentProgress.title'),
}, {
  accessorFn: item => item.documentSummary.count,
  id: 'documentRecordsSummary',
  minWidth: 140,
  title: t('purchaseOrderList.records.documents'),
}, {
  accessorFn: item => item.shippingMarkText ?? item.shippingMarks.join('\n'),
  id: 'shippingMarkSummary',
  minWidth: 200,
  title: '采购唛头',
}, {
  accessorKey: 'remark',
  id: 'remarkSummary',
  minWidth: 240,
  title: '备注',
}, {
  accessorFn: item => item.changeSummary.statusCount + item.changeSummary.amountCount,
  id: 'changeRecordsSummary',
  minWidth: 140,
  title: t('purchaseOrderList.records.changes'),
}, {
  accessorKey: 'updatedAt',
  id: 'auditSummary',
  minWidth: 260,
  title: '审计信息',
}]

const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : requestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${requestId.value}）`)

function productImageItems(row: PurchaseOrderListItemDto): readonly ImageGroupItem[] {
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
  row: PurchaseOrderListItemDto,
  item: ImageGroupItem,
): PurchaseOrderLinePreviewDto | undefined {
  // 图片组折叠后可见位置会变化，必须按稳定采购明细 ID 反查，避免 Tooltip 与产品串项。
  return typeof item.key === 'string'
    ? row.lineSummary.previews.find(preview => preview.lineId === item.key)
    : undefined
}

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

function currentListQuery() {
  return buildPurchaseOrderListQuery({
    dateRange: currentDateRange(),
    filters: filters.value,
    page: page.value,
    pageSize: pageSize.value,
    searchKeyword: searchKeyword.value,
    statusSelection: selectedStatus.value as PurchaseOrderListStatusSelection,
    viewMode: props.viewMode,
  })
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
    const response = await purchaseOrdersApi.list(currentListQuery(), controller.signal)
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || !canRead.value
    ) {
      return
    }
    rows.value = response.data.items
    summariesByCurrency.value = response.data.summariesByCurrency.map(summary => ({
      ...summary,
    }))
    total.value = response.data.total
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    const failure = getPurchaseOrderApiFailure(error)
    summariesByCurrency.value = []
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

async function loadStatusCounts(): Promise<void> {
  if (!canRead.value) {
    return
  }
  countAbortController?.abort()
  const controller = new AbortController()
  countAbortController = controller
  const version = ++countRequestVersion
  const authEpoch = appAccountStore.authEpoch
  try {
    const response = await purchaseOrdersApi.statusCounts(
      buildPurchaseOrderStatusCountsQuery(currentListQuery()),
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
    // 状态数量不遮蔽主列表错误；请求失败时由共享映射显式展示 0。
    if (!isPurchaseOrderAbortError(error) && version === countRequestVersion) {
      statusCountItems.value = []
    }
  }
  finally {
    if (countAbortController === controller) {
      countAbortController = null
    }
  }
}

function refreshOrdersAndCounts(): void {
  void loadOrders()
  void loadStatusCounts()
}

function retryOrders(): void {
  refreshOrdersAndCounts()
}

function handleSearch(): void {
  page.value = 1
  refreshOrdersAndCounts()
}

function handleFilterChange(): void {
  page.value = 1
  refreshOrdersAndCounts()
}

function handlePaginationChange(): void {
  void loadOrders()
}

function handleDateRangeComplete(): void {
  page.value = 1
  refreshOrdersAndCounts()
}

function clearDateRange(): void {
  page.value = 1
  refreshOrdersAndCounts()
}

function openPurchaseStart(type: PurchaseStartPurchaseType): void {
  if (!canCreate.value || (type === 'STOCK' && !canCreateStock.value)) {
    return
  }
  purchaseStartType.value = type
  purchaseStartVisible.value = true
}

async function enterPurchaseCreate(selection: PurchaseStartSelection): Promise<void> {
  purchaseStartVisible.value = false
  try {
    await router.push({
      name: 'operationsPurchaseOrderCreate',
      query: buildPurchaseStartRouteQuery(selection),
    })
  }
  catch {
    toast.error('无法进入新增采购页面，请重试')
    purchaseStartVisible.value = true
  }
}

function openPurchaseOrderDetail(order: PurchaseOrderListItemDto): void {
  selectedOrder.value = { ...order }
  detailVisible.value = true
}

function purchaseOrderCancelBlockedReason(order: PurchaseOrderListItemDto): string | null {
  if (props.viewMode !== 'all') {
    return '待办视图不提供取消采购单入口'
  }
  if (!canCancel.value) {
    return '当前账号无权取消采购单'
  }
  const blockedReason = getPurchaseOrderCancelBlockedReason(order, {
    allowPendingReview: true,
  })
  return blockedReason === null
    ? null
    : purchaseOrderCancelBlockedMessage(blockedReason)
}

function openPurchaseOrderCancel(order: PurchaseOrderListItemDto): void {
  const blockedReason = purchaseOrderCancelBlockedReason(order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  cancelOrderId.value = order.id
  cancelModalVisible.value = true
}

function handlePurchaseOrderCancelled(): void {
  refreshOrdersAndCounts()
}

function detailMenuItems(order: PurchaseOrderListItemDto): ActionMenuItem[][] {
  return [[{ label: '详情', handle: () => openPurchaseOrderDetail(order) }]]
}

function currentPendingTask(): PurchaseOrderPendingTask {
  return normalizePurchaseOrderStatusSelection(
    'pending',
    selectedStatus.value,
  ) as PurchaseOrderPendingTask
}

function canShowPendingAction(action: PurchaseOrderPendingActionItem): boolean {
  return action.key === 'PAYMENT' ? canManagePayment.value : canUpdate.value
}

function pendingSlotActions(): PurchaseOrderPendingActionItem[] {
  if (props.viewMode !== 'pending') {
    return []
  }
  const action = resolvePurchaseOrderPendingActionSlot(currentPendingTask())
  return action === null || !canShowPendingAction(action) ? [] : [action]
}

function openPurchaseWarehouseReceipt(order: PurchaseOrderListItemDto): void {
  const blockedReason = resolvePurchaseOrderWarehouseReceiptBlockedReason(order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  void warehouseActionRef.value?.open(order.id)
}

function shortPendingActionLabel(action: PurchaseOrderPendingActionItem): string {
  switch (action.key) {
    case 'PAYMENT': return '付款'
    case 'SHIPMENT': return '发货'
    case 'WAREHOUSE_RECEIPT': return '入仓'
  }
}

function createPurchaseShipmentContext(
  order: PurchaseOrderDetailDto,
): FactoryShipmentModalContext {
  return {
    // 单采购模式只核对当前采购订单；销售联动结果由 Server 提交结果统一返回。
    salesOrder: null,
    purchaseOrders: [{
      id: order.id,
      orderNo: order.orderNo,
      orderDate: order.orderDate,
      supplier: { label: order.supplier.label },
      fulfillmentStatus: order.fulfillmentStatus,
      version: order.version,
      lineSummary: {
        ...order.lineSummary,
        previews: order.lineSummary.previews.map((preview) => {
          const line = order.lines.find(item => item.id === preview.lineId)
          return { ...preview, productNo: line?.productNo, description: line?.description }
        }),
      },
      shippingMarkText: order.shippingMarkText,
      parts: order.parts,
    }],
  }
}

function cancelShipmentRequest(): void {
  shipmentAbortController?.abort()
  shipmentAbortController = null
  shipmentContextLoading.value = false
  shipmentSubmitting.value = false
}

function openPurchaseFactoryShipment(order: PurchaseOrderListItemDto): void {
  if (!canUpdate.value || order.orderStatus !== 'CONFIRMED') {
    return
  }
  cancelShipmentRequest()
  shipmentTarget.value = order
  shipmentDetail.value = null
  shipmentContext.value = null
  shipmentError.value = null
  shipmentVisible.value = true
  void retryPurchaseFactoryShipment()
}

function closePurchaseFactoryShipment(): void {
  if (shipmentSubmitting.value) {
    return
  }
  cancelShipmentRequest()
  shipmentVisible.value = false
  shipmentError.value = null
  shipmentTarget.value = null
  shipmentDetail.value = null
  shipmentContext.value = null
}

function shipmentFailureMessage(error: unknown): string {
  const failure = getPurchaseOrderApiFailure(error)
  const message = failure.requestId === undefined
    ? failure.message
    : `${failure.message}（requestId: ${failure.requestId}）`
  return `${message}。请重新加载最新订单后再次确认。`
}

async function submitPurchaseFactoryShipment(intent: FactoryShipmentIntent): Promise<void> {
  const target = intent.targets[0]
  if (target === undefined || shipmentSubmitting.value || shipmentContextLoading.value || shipmentDetail.value === null || shipmentError.value) {
    return
  }
  cancelShipmentRequest()
  const controller = new AbortController()
  shipmentAbortController = controller
  shipmentSubmitting.value = true
  shipmentError.value = null
  try {
    const response = await purchaseOrdersApi.factoryShipment(target.purchaseOrderId, {
      expectedVersion: target.expectedVersion,
      partIds: [...target.partIds],
      trackingNumbers: target.trackingNumbers?.map(item => ({ ...item })),
      destinationWarehouses: target.destinationWarehouses.map(item => ({ ...item })),
      reason: intent.reason,
    }, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    const result: FactoryShipmentResultDto = response.data
    toast.success(formatPurchaseFactoryShipmentSuccess(result))
    shipmentVisible.value = false
    shipmentTarget.value = null
    shipmentDetail.value = null
    shipmentContext.value = null
    refreshOrdersAndCounts()
  }
  catch (error) {
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(error)) {
      shipmentError.value = shipmentFailureMessage(error)
    }
  }
  finally {
    if (shipmentAbortController === controller) {
      shipmentAbortController = null
      shipmentSubmitting.value = false
    }
  }
}

async function retryPurchaseFactoryShipment(): Promise<void> {
  const targetId = shipmentTarget.value?.id
  if (targetId === undefined || shipmentSubmitting.value || !shipmentVisible.value || !canUpdate.value) {
    return
  }
  shipmentAbortController?.abort()
  const controller = new AbortController()
  shipmentAbortController = controller
  const epoch = appAccountStore.authEpoch
  shipmentContextLoading.value = true
  shipmentError.value = null
  shipmentDetail.value = null
  shipmentContext.value = null
  try {
    const response = await purchaseOrdersApi.getById(targetId, controller.signal)
    if (controller.signal.aborted || epoch !== appAccountStore.authEpoch || !shipmentVisible.value || shipmentTarget.value?.id !== targetId || !canUpdate.value) {
      return
    }
    const detail = response.data
    if (detail.orderStatus !== 'CONFIRMED' || !['ORDERED', 'PREPARING', 'PARTIALLY_SHIPPED'].includes(detail.fulfillmentStatus)) {
      shipmentError.value = '采购订单状态已变化，当前不可发货。请关闭弹窗后查看最新订单。'
      refreshOrdersAndCounts()
      return
    }
    // 唛头、货件分配与提交版本来自同一次详情读取，避免核对旧列表后提交新版本。
    shipmentDetail.value = detail
    shipmentContext.value = createPurchaseShipmentContext(detail)
  }
  catch (error) {
    if (!controller.signal.aborted && epoch === appAccountStore.authEpoch && !isPurchaseOrderAbortError(error)) {
      shipmentError.value = shipmentFailureMessage(error)
    }
  }
  finally {
    if (shipmentAbortController === controller) {
      shipmentAbortController = null
      shipmentContextLoading.value = false
    }
  }
}

/** 待办付款先选择定金或尾款，再复制对应付款信息；发货与入仓进入对应业务入口。 */
function handlePendingActionFromRow(
  action: PurchaseOrderPendingActionItem,
  order: PurchaseOrderListItemDto,
): void {
  const blockedReason = resolvePurchaseOrderPendingActionBlockedReason(action.key, order)
  if (blockedReason !== null) {
    toast.info(blockedReason)
    return
  }
  handlePendingAction(action, order)
}

function handlePendingAction(
  action: PurchaseOrderPendingActionItem,
  order: PurchaseOrderListItemDto,
): void {
  if (!canShowPendingAction(action)) {
    return
  }
  if (order.orderStatus !== 'CONFIRMED') {
    return
  }
  if (action.key === 'SHIPMENT') {
    openPurchaseFactoryShipment(order)
    return
  }
  if (action.key === 'PAYMENT') {
    void paymentActionRef.value?.open(order)
    return
  }
  if (action.key === 'WAREHOUSE_RECEIPT') {
    void warehouseActionRef.value?.open(order.id)
  }
}

function handleDetailUpdated(_detail: PurchaseOrderDetailDto): void {
  // 待办谓词和筛选均由 Server 负责；mutation 后重取当前页，避免本地复制查询规则。
  refreshOrdersAndCounts()
}

function openRecordsModal(kind: PurchaseOrderRecordsKind, order: PurchaseOrderListItemDto): void {
  recordsModalKind.value = kind
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

/** 弹窗拿到新快照后同步三个入口数量，不触发列表筛选或写入。 */
function handleRecordsLoaded(detail: PurchaseOrderDetailDto): void {
  rows.value = rows.value.map(row => row.id === detail.id
    ? {
        ...row,
        paymentRecordSummary: detail.paymentRecordSummary,
        documentSummary: detail.documentSummary,
        changeSummary: detail.changeSummary,
      }
    : row)
}

watch(() => appAccountStore.authEpoch, () => {
  requestVersion += 1
  countRequestVersion += 1
  listAbortController?.abort()
  countAbortController?.abort()
  cancelShipmentRequest()
  shipmentVisible.value = false
  shipmentTarget.value = null
  shipmentDetail.value = null
  shipmentContext.value = null
  shipmentError.value = null
  detailVisible.value = false
  recordsModalVisible.value = false
  recordsModalOrder.value = null
  selectedOrder.value = null
  purchaseStartVisible.value = false
  rows.value = []
  summariesByCurrency.value = []
  statusCountItems.value = []
  total.value = 0
  if (canRead.value) {
    refreshOrdersAndCounts()
  }
})

watch(
  () => [
    props.viewMode,
    route.name,
    props.viewMode === 'pending' ? route.query.task : route.query.status,
  ] as const,
  ([nextMode, nextRouteName, nextStatus], [previousMode, previousRouteName, previousStatus]) => {
    // 路由过渡和 KeepAlive 停用期间仍可能触发 watch；旧视图不得删除新视图的
    // status/task，否则导航会再次 replace，导致刚打开的审核弹窗随页面销毁。
    const ownRouteName = nextMode === 'pending'
      ? 'qsOperationsPendingPurchaseOrders'
      : 'qsOperationsPurchaseOrders'
    if (nextRouteName !== ownRouteName) {
      return
    }
    if (nextMode === previousMode && nextRouteName === previousRouteName && nextStatus === previousStatus) {
      return
    }
    page.value = 1
    const normalized = normalizePurchaseOrderStatusSelection(nextMode, nextStatus)
    const nextQuery = { ...route.query }
    let shouldReplaceQuery = false
    if (nextMode === 'pending') {
      if (nextQuery.status !== undefined) {
        delete nextQuery.status
        shouldReplaceQuery = true
      }
      if (nextStatus !== undefined && normalized === 'AWAITING_SHIPMENT'
        && nextStatus !== normalized) {
        delete nextQuery.task
        shouldReplaceQuery = true
      }
    }
    else {
      if (nextQuery.task !== undefined) {
        delete nextQuery.task
        shouldReplaceQuery = true
      }
      if (nextStatus !== undefined && normalized === 'ALL') {
        delete nextQuery.status
        shouldReplaceQuery = true
      }
    }
    if (shouldReplaceQuery) {
      void router.replace({ query: nextQuery })
    }
    void loadOrders()
    if (nextMode !== previousMode || nextRouteName !== previousRouteName) {
      void loadStatusCounts()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    refreshOrdersAndCounts()
  }
})

// KeepAlive 返回列表时刷新，避免停留在离开前的数据快照；首次激活由 onMounted 负责。
let pageActivated = false
onActivated(() => {
  if (!pageActivated) {
    pageActivated = true
    return
  }
  if (canRead.value) {
    refreshOrdersAndCounts()
  }
})

onBeforeUnmount(() => {
  requestVersion += 1
  countRequestVersion += 1
  listAbortController?.abort()
  countAbortController?.abort()
  cancelShipmentRequest()
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
          @click="openPurchaseStart('SALES_LINKED')"
        >
          <FaIcon name="i-lucide:link-2" aria-hidden="true" />新增采购
        </FaButton>
        <FaButton
          v-if="canCreate && canCreateStock"
          type="button"
          variant="outline"
          class="min-h-[44px] sm:min-h-9"
          @click="openPurchaseStart('STOCK')"
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
        v-model="selectedStatus"
        :items="statusItems"
        :aria-label="`${pageTitle}状态筛选`"
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

      <!-- 复合单元格按完整内容参与列宽计算；溢出仅在表格容器内滚动，不改变页面宽度。 -->
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="searchKeyword"
        v-model:filters="filters"
        data-testid="purchase-order-list-table"
        :row-key="item => item.id"
        :addable="false"
        :action-column="{ fixed: 'right', minWidth: actionColumnWidth, title: '操作', width: actionColumnWidth }"
        :columns="columns"
        :data="rows"
        :empty-title="viewMode === 'pending' ? '暂无待办采购' : '暂无采购订单'"
        :empty-description="viewMode === 'pending' ? '当前分类下暂无需要处理的采购订单。' : '请先创建采购订单。'"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索采购单号、销售单号、客户名或采购唛头"
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
            calendar-label="采购日期范围"
            placeholder="采购日期范围"
            @complete="handleDateRangeComplete"
            @clear="clearDateRange"
          />
        </template>

        <template #actions="{ row }">
          <div class="flex flex-wrap gap-1 items-center">
            <template v-if="props.viewMode === 'all'">
              <FaButton
                v-if="canUpdate"
                type="button"
                variant="ghost"
                size="sm"
                class="text-primary min-h-11 sm:min-h-8"
                :loading="warehouseLoadingOrderId === row.id"
                :disabled="warehouseLoadingOrderId !== null"
                @click="openPurchaseWarehouseReceipt(row)"
              >
                入仓
              </FaButton>
              <FaTooltip
                v-if="canCancel"
                :text="purchaseOrderCancelBlockedReason(row) ?? ''"
                :disabled="purchaseOrderCancelBlockedReason(row) === null"
              >
                <span class="inline-flex">
                  <FaButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="text-destructive min-h-11 sm:min-h-8"
                    :disabled="purchaseOrderCancelBlockedReason(row) !== null"
                    :aria-label="`${row.orderNo}：取消采购单`"
                    @click="openPurchaseOrderCancel(row)"
                  >
                    取消
                  </FaButton>
                </span>
              </FaTooltip>
              <FaButton
                v-if="!(canUpdate && canCancel)"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：详情`"
                @click="openPurchaseOrderDetail(row)"
              >
                详情
              </FaButton>
              <FaButton
                v-if="canUpdate && canCancel"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8 md:hidden"
                :aria-label="`${row.orderNo}：详情`"
                @click="openPurchaseOrderDetail(row)"
              >
                详情
              </FaButton>
              <FaDropdown
                v-if="canUpdate && canCancel"
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
                v-for="action in pendingSlotActions()"
                :key="action.key"
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：${action.label}`"
                :loading="(action.key === 'PAYMENT' && paymentLoadingOrderId === row.id) || (action.key === 'WAREHOUSE_RECEIPT' && warehouseLoadingOrderId === row.id)"
                :disabled="(action.key === 'PAYMENT' && paymentLoadingOrderId !== null) || (action.key === 'WAREHOUSE_RECEIPT' && warehouseLoadingOrderId !== null)"
                @click="handlePendingActionFromRow(action, row)"
              >
                {{ shortPendingActionLabel(action) }}
              </FaButton>
              <FaButton
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.orderNo}：详情`"
                @click="openPurchaseOrderDetail(row)"
              >
                详情
              </FaButton>
            </template>
          </div>
        </template>

        <template #cell-orderSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine nowrap content-class="qs-type-data-emphasis">
              <QsCopyableText label="采购订单号" :text="row.original.orderNo" />
            </QsTableStackedLine>
            <QsTableStackedLine content-class="qs-type-meta inline-flex gap-2 items-center" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag px-1.5 py-0 shrink-0 !text-[10px] !leading-4"
                :class="purchaseTypeTagClass(row.original.purchaseType)"
              >
                {{ purchaseTypeShortLabel(row.original.purchaseType) }}
              </FaTag>
              <span class="text-muted-foreground">{{ row.original.orderDate }}</span>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-sourceSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine
              :content-class="row.original.salesOrderNo === null
                ? 'font-medium'
                : 'qs-type-data-emphasis'"
              nowrap
            >
              {{ row.original.salesOrderNo ?? '独立备货' }}
              <template #suffix>
                <CopyCellButton
                  v-if="row.original.salesOrderNo !== null"
                  label="销售订单号"
                  :text="row.original.salesOrderNo ?? ''"
                />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>
              {{ row.original.customerName ?? '不关联销售客户' }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-supplierSummary="{ row }">
          <span class="font-medium">
            {{ row.original.supplier.label }}
          </span>
        </template>

        <template #cell-buyerSummary="{ row }">
          <QsPersonDisplay
            :display-name="row.original.createdBy.displayName"
            size="md"
            class="max-w-[9rem]" :avatar-url="row.original.createdBy.avatarUrl"
          />
        </template>

        <template #cell-productSummary="{ row }">
          <ImageGroup
            :items="productImageItemsByOrderId.get(row.original.id) ?? []"
            :max-count="3"
            tooltip-mode="native"
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
                      <span class="tracking-[0.08em] font-semibold">采购产品</span>
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

        <template #cell-paymentRecordsSummary="{ row }">
          <PurchaseOrderRecordSummaryCell kind="payments" :order="row.original" @open="openRecordsModal('payments', row.original)" />
        </template>
        <template #cell-documentRecordsSummary="{ row }">
          <PurchaseOrderRecordSummaryCell kind="documents" :order="row.original" @open="openRecordsModal('documents', row.original)" />
        </template>
        <template #cell-changeRecordsSummary="{ row }">
          <PurchaseOrderRecordSummaryCell kind="changes" :order="row.original" @open="openRecordsModal('changes', row.original)" />
        </template>

        <template #cell-statusSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="订单状态" nowrap>
              <FaTag variant="outline" class="qs-type-status-tag" :class="orderStatusTagClass(row.original.orderStatus)">
                {{ row.original.rejection ? '已驳回' : orderStatusLabel(row.original.orderStatus) }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine label="履约状态" tone="muted" nowrap>
              <FaTag variant="outline" class="qs-type-status-tag" :class="fulfillmentStatusTagClass(row.original.fulfillmentStatus)">
                {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-shipmentProgressSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine :label="t('purchaseOrderList.shipmentProgress.shipped')" content-class="qs-type-data" nowrap>
              {{ t('purchaseOrderList.shipmentProgress.count', { count: row.original.shippedPartCount, total: row.original.partCount }) }}
            </QsTableStackedLine>
            <QsTableStackedLine :label="t('purchaseOrderList.shipmentProgress.received')" content-class="qs-type-data" nowrap>
              {{ t('purchaseOrderList.shipmentProgress.count', { count: row.original.warehouseReceivedPartCount, total: row.original.partCount }) }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-shippingMarkSummary="{ row }">
          <PurchaseOrderShippingMarksCell :order="row.original" />
        </template>

        <template #cell-remarkSummary="{ row }">
          <FaTooltip :text="row.original.remark ?? '-'" :disabled="row.original.remark === null">
            <span class="max-w-[13rem] block truncate">{{ row.original.remark ?? '-' }}</span>
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

        <template #summary>
          <!-- 采购币种固定为 CNY，仍保留币种行维度，与销售汇总矩阵形成一致阅读路径。 -->
          <section
            data-testid="purchase-order-summary-matrix"
            aria-label="采购订单金额汇总"
            class="border-t-2 border-border bg-background overflow-hidden"
          >
            <div class="md:grid md:grid-cols-[12rem_minmax(0,1fr)]">
              <div class="px-4 py-3 border-border flex gap-1 md:border-r md:flex-col md:justify-center">
                <span class="qs-type-meta">筛选结果</span>
                <strong class="qs-type-data-emphasis">共 {{ total }} 张订单</strong>
              </div>

              <div
                data-testid="purchase-order-summary-desktop"
                class="min-w-0 hidden overflow-x-auto md:block"
              >
                <table class="text-sm min-w-[840px] w-full border-collapse">
                  <caption class="sr-only">
                    按币种汇总采购订单采购价、付款约定与付款金额
                  </caption>
                  <thead class="text-muted-foreground bg-muted/20">
                    <tr class="border-b border-border/70">
                      <th scope="col" rowspan="2" class="font-medium px-4 py-2 text-left">
                        币种
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        采购价
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        付款约定
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        付款
                      </th>
                    </tr>
                    <tr class="border-b border-border/70">
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        本单采购
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        采购定价
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        定金
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        尾款
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        已付
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        待付
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
                        {{ formatPurchaseOrderSummaryAmount(summary.purchaseTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatPurchaseOrderSummaryAmount(summary.referenceSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatPurchaseOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatPurchaseOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatPurchaseOrderSummaryAmount(summary.paidAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatPurchaseOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
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
                data-testid="purchase-order-summary-mobile"
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
                          本单采购
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.purchaseTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          采购定价
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.referenceSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          定金
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          尾款
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          已付
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.paidAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          待付
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatPurchaseOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
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
          <article data-testid="purchase-order-mobile-summary">
            <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
              <div class="group min-w-0">
                <div class="qs-type-data-emphasis flex gap-2 break-all items-center">
                  <QsCopyableText label="采购订单号" :text="row.orderNo" />
                </div>
                <div class="qs-type-meta mt-1 inline-flex gap-2 items-center">
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag px-1.5 py-0 shrink-0 !text-[10px] !leading-4"
                    :class="purchaseTypeTagClass(row.purchaseType)"
                  >
                    {{ purchaseTypeShortLabel(row.purchaseType) }}
                  </FaTag>
                  <span class="text-muted-foreground">{{ row.orderDate }}</span>
                </div>
              </div>
              <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
            </div>
            <dl class="m-0 gap-x-4 gap-y-4 grid grid-cols-2">
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  销售来源
                </dt>
                <dd class="m-0">
                  <div class="group flex gap-1 min-w-0 items-center">
                    <span
                      class="min-w-0 break-all"
                      :class="row.salesOrderNo === null
                        ? 'font-medium'
                        : 'qs-type-data-emphasis'"
                    >
                      {{ row.salesOrderNo ?? '独立备货' }}
                    </span>
                    <CopyCellButton
                      v-if="row.salesOrderNo !== null"
                      always-visible
                      label="销售订单号"
                      :text="row.salesOrderNo ?? ''"
                    />
                  </div>
                  <div class="qs-type-meta mt-1">
                    {{ row.customerName ?? '不关联销售客户' }}
                  </div>
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
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  采购人
                </dt>
                <dd class="m-0">
                  <QsPersonDisplay
                    :display-name="row.createdBy.displayName"
                    size="md"
                    class="max-w-full" :avatar-url="row.createdBy.avatarUrl"
                  />
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
                              <span class="tracking-[0.08em] font-semibold">采购产品</span>
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
                    {{ row.rejection ? '已驳回' : orderStatusLabel(row.orderStatus) }}
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
                  <span class="qs-type-meta text-muted-foreground">已发 {{ row.shippedPartCount }} / {{ row.partCount }} 件 · {{ t('purchaseWarehouseReceipt.progress', { received: row.warehouseReceivedPartCount, total: row.partCount }) }}</span>
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
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  采购唛头
                </dt>
                <dd class="m-0 min-w-0">
                  <PurchaseOrderShippingMarksCell :order="row" />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  备注
                </dt>
                <dd class="m-0 whitespace-pre-wrap break-words">
                  {{ row.remark ?? '-' }}
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  {{ t('purchaseOrderList.records.payments') }}
                </dt>
                <dd class="m-0">
                  <PurchaseOrderRecordSummaryCell kind="payments" :order="row" @open="openRecordsModal('payments', row)" />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  {{ t('purchaseOrderList.records.documents') }}
                </dt>
                <dd class="m-0">
                  <PurchaseOrderRecordSummaryCell kind="documents" :order="row" @open="openRecordsModal('documents', row)" />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  {{ t('purchaseOrderList.records.changes') }}
                </dt>
                <dd class="m-0">
                  <PurchaseOrderRecordSummaryCell kind="changes" :order="row" @open="openRecordsModal('changes', row)" />
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <PurchaseOrderRecordsModal
      v-model="recordsModalVisible"
      :kind="recordsModalKind"
      :order="recordsModalOrder"
      :currencies="currencyCatalog.currencies.value"
      @detail-loaded="handleRecordsLoaded"
    />

    <PurchaseOrderDetailDrawer
      v-model="detailVisible"
      :order="selectedOrder"
      :currencies="currencyCatalog.currencies.value"
      @detail-updated="handleDetailUpdated"
    />

    <PurchaseOrderCancelModal
      v-model="cancelModalVisible"
      :order-id="cancelOrderId"
      @cancelled="handlePurchaseOrderCancelled"
    />

    <PurchaseWarehouseReceiptAction ref="warehouseActionRef" :active="canRead" @detail-updated="handleDetailUpdated" />
    <PurchaseOrderListPaymentAction
      ref="paymentActionRef"
      :active="viewMode === 'pending' && route.name === 'qsOperationsPendingPurchaseOrders' && selectedStatus === 'AWAITING_PAYMENT'"
      @stale="refreshOrdersAndCounts"
    />

    <QsFactoryShipmentModal
      v-model="shipmentVisible"
      mode="PURCHASE_ORDER"
      :context="shipmentContext"
      :loading="shipmentContextLoading"
      :submitting="shipmentSubmitting"
      :error="shipmentError"
      @submit="submitPurchaseFactoryShipment"
      @cancel="closePurchaseFactoryShipment"
      @retry="retryPurchaseFactoryShipment"
    >
      <template #purchase-content>
        <PurchaseShipmentSummary v-if="shipmentDetail" :detail="shipmentDetail" />
      </template>
    </QsFactoryShipmentModal>

    <QsPurchaseStartModal
      v-model="purchaseStartVisible"
      :purchase-type="purchaseStartType"
      @confirm="enterPurchaseCreate"
      @validation-error="toast.warning($event)"
    />
  </div>
</template>
