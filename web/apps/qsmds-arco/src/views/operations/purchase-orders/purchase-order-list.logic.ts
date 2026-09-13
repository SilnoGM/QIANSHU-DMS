import type {
  FactoryShipmentResultDto,
  PurchaseOrderListItemDto,
} from '../../../api/generated/types.gen'
import type {
  PurchaseOrderListQuery,
  PurchaseOrderStatusCountsQuery,
} from '../../../api/modules/purchase-orders'
import type { CurrencyAmountValue } from '../../../components/base/AmountDisplay/format'
import type { CurrencyDescriptor } from '../../../components/base/currency'
import type { QsGenericTableFilterValues } from '../../../components/business/QsGenericTable/logic'
import type { QsStatusSwitchItem } from '../../../components/business/QsStatusSwitchToolbar/types'

import Decimal from 'decimal.js'

import { formatCurrencyAmount } from '../../../components/base/AmountDisplay/format'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export type PurchaseOrderListViewMode = 'all' | 'pending'
export type PurchaseOrderPendingTask
  = | 'AWAITING_REVIEW'
    | 'AWAITING_PAYMENT'
    | 'AWAITING_SHIPMENT'
    | 'AWAITING_WAREHOUSE'
type PurchaseOrderOrderStatusSelection = 'CANCELLED' | 'COMPLETED' | 'CONFIRMED' | 'PENDING_REVIEW'
export type PurchaseOrderListStatusSelection
  = | 'ALL'
    | PurchaseOrderOrderStatusSelection
    | PurchaseOrderPendingTask

export type PurchaseOrderPendingActionKey = 'PAYMENT' | 'SHIPMENT' | 'WAREHOUSE_RECEIPT'

export interface PurchaseOrderPendingActionItem {
  readonly icon: string
  readonly key: PurchaseOrderPendingActionKey
  readonly label: string
}

export interface PurchaseOrderListDateRange {
  readonly orderDateFrom?: string
  readonly orderDateTo?: string
}

export interface PurchaseOrderListQuerySource {
  readonly dateRange: PurchaseOrderListDateRange
  readonly filters: QsGenericTableFilterValues
  readonly page: number
  readonly pageSize: number
  readonly searchKeyword: string
  readonly statusSelection: PurchaseOrderListStatusSelection
  readonly viewMode: PurchaseOrderListViewMode
}

export interface PurchaseOrderPaymentProgress {
  readonly formattedPercentage: string
  readonly progressValue: number
}

export interface PurchaseOrderApiFailure {
  readonly message: string
  readonly requestId?: string
}

/**
 * 汇总矩阵已经以币种作为行标题，因此金额单元格移除末尾重复的币种代码。
 * 底层仍复用 AmountDisplay 的精确十进制格式化，避免列表另建舍入规则。
 */
export function formatPurchaseOrderSummaryAmount(
  value: CurrencyAmountValue,
  currency: string,
  currencies: readonly CurrencyDescriptor[],
): string {
  const formatted = formatCurrencyAmount(value, currency, currencies)
  const normalizedCurrency = currency.trim()
  const currencySuffix = ` ${normalizedCurrency}`

  return normalizedCurrency.length > 0 && formatted.endsWith(currencySuffix)
    ? formatted.slice(0, -currencySuffix.length)
    : formatted
}

const PURCHASE_TYPES = ['SALES_LINKED', 'STOCK'] as const
const FULFILLMENT_STATUSES = [
  'ORDERED',
  'PREPARING',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'SIGNED',
] as const
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const

const PENDING_TASK_ITEMS: readonly QsStatusSwitchItem[] = [
  { label: '采购审核中', value: 'AWAITING_REVIEW' },
  { label: '待发货', value: 'AWAITING_SHIPMENT' },
  { label: '待入仓', value: 'AWAITING_WAREHOUSE' },
  { label: '待付款', value: 'AWAITING_PAYMENT' },
]

const ALL_ORDER_STATUS_ITEMS: readonly QsStatusSwitchItem[] = [
  { label: '全部采购', value: 'ALL' },
  { label: '采购审核中', value: 'PENDING_REVIEW' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已取消', value: 'CANCELLED' },
]

const PAYMENT_ACTION: PurchaseOrderPendingActionItem = {
  icon: 'i-lucide:hand-coins',
  key: 'PAYMENT',
  label: '付款',
}

const TASK_ACTION: Readonly<Record<
  Exclude<PurchaseOrderPendingTask, 'AWAITING_PAYMENT' | 'AWAITING_REVIEW'>,
  PurchaseOrderPendingActionItem
>> = {
  AWAITING_SHIPMENT: {
    icon: 'i-lucide:truck',
    key: 'SHIPMENT',
    label: '发货',
  },
  AWAITING_WAREHOUSE: {
    icon: 'i-lucide:warehouse',
    key: 'WAREHOUSE_RECEIPT',
    label: '到仓',
  },
}

export function getPurchaseOrderStatusItems(
  viewMode: PurchaseOrderListViewMode,
): readonly QsStatusSwitchItem[] {
  return viewMode === 'pending' ? PENDING_TASK_ITEMS : ALL_ORDER_STATUS_ITEMS
}

/** URL 查询值只接受当前工具栏声明的稳定编码，非法值回落到该视图的默认状态。 */
export function normalizePurchaseOrderStatusSelection(
  viewMode: PurchaseOrderListViewMode,
  value: unknown,
): PurchaseOrderListStatusSelection {
  const items = getPurchaseOrderStatusItems(viewMode)
  return typeof value === 'string' && items.some(item => item.value === value)
    ? value as PurchaseOrderListStatusSelection
    : viewMode === 'pending' ? 'AWAITING_SHIPMENT' : 'ALL'
}

/**
 * 待办动作严格由当前任务决定，避免“待发货 / 待入仓”行混入付款操作。
 * 待付款额外防御已付清的陈旧列表行，避免展示已经没有业务意义的入口。
 */
export function resolvePurchaseOrderPendingActions(
  task: PurchaseOrderPendingTask,
  order: Pick<PurchaseOrderListItemDto, 'orderStatus' | 'paymentStatus'>,
): readonly PurchaseOrderPendingActionItem[] {
  if (task === 'AWAITING_REVIEW') {
    return []
  }
  if (order.orderStatus !== 'CONFIRMED') {
    return []
  }
  if (task === 'AWAITING_PAYMENT') {
    return order.paymentStatus === 'PAID' ? [] : [PAYMENT_ACTION]
  }
  return [TASK_ACTION[task]]
}

/** 审核中与已确认订单可取消，最终提交前仍由详情接口重新校验最新状态。 */
export function canCancelPurchaseOrderFromList(
  order: Pick<PurchaseOrderListItemDto, 'orderStatus' | 'fulfillmentStatus'>,
): boolean {
  return order.orderStatus === 'PENDING_REVIEW' || (order.orderStatus === 'CONFIRMED' && ['ORDERED', 'PREPARING'].includes(order.fulfillmentStatus))
}

/**
 * 发货结果的销售联动只能以 Server 返回值为准。Web 不根据当前列表自行推断
 * 销售订单是否进入陆运中，避免并发采购变化时展示错误业务事实。
 */
export function formatPurchaseFactoryShipmentSuccess(
  result: FactoryShipmentResultDto,
): string {
  if (result.changedPurchaseOrderCount === 0) {
    return '所选货件已发货，未重复处理'
  }
  if (result.salesOrder === null) {
    return '所选货件已发货'
  }
  if (result.salesOrder.advancedToLandTransit) {
    return '所选货件已发货，关联销售订单已进入陆运中'
  }
  return `所选货件已发货，关联销售订单仍有 ${result.remainingPendingShipmentCount} 张采购单待发货`
}

function enumFilter<T extends string>(
  filters: QsGenericTableFilterValues,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = filters[key]
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : undefined
}

function textFilter(
  filters: QsGenericTableFilterValues,
  key: string,
): string | undefined {
  const value = filters[key]
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().normalize('NFKC')
  return normalized === '' ? undefined : normalized
}

function dateFilter(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? value
    : undefined
}

/** 页面只把公开契约允许的筛选值发给 Server；字典供应商保留稳定 value 原文。 */
export function buildPurchaseOrderListQuery(
  source: PurchaseOrderListQuerySource,
): PurchaseOrderListQuery {
  const statusSelection = normalizePurchaseOrderStatusSelection(
    source.viewMode,
    source.statusSelection,
  )
  const keyword = source.searchKeyword.trim().normalize('NFKC')
  const supplierValue = textFilter(source.filters, 'supplierValue')
  const purchaseType = enumFilter(source.filters, 'purchaseType', PURCHASE_TYPES)
  const fulfillmentStatus = enumFilter(
    source.filters,
    'fulfillmentStatus',
    FULFILLMENT_STATUSES,
  )
  const paymentStatus = enumFilter(source.filters, 'paymentStatus', PAYMENT_STATUSES)
  const orderDateFrom = dateFilter(source.dateRange.orderDateFrom)
  const orderDateTo = dateFilter(source.dateRange.orderDateTo)

  return {
    view: source.viewMode,
    page: source.page,
    pageSize: source.pageSize,
    ...(source.viewMode === 'pending'
      ? { pendingTask: statusSelection as PurchaseOrderPendingTask }
      : statusSelection === 'ALL'
        ? {}
        : { orderStatus: statusSelection as PurchaseOrderOrderStatusSelection }),
    ...(keyword === '' ? {} : { keyword }),
    ...(supplierValue === undefined ? {} : { supplierValue }),
    ...(purchaseType === undefined ? {} : { purchaseType }),
    ...(fulfillmentStatus === undefined ? {} : { fulfillmentStatus }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
    ...(orderDateFrom === undefined ? {} : { orderDateFrom }),
    ...(orderDateTo === undefined ? {} : { orderDateTo }),
  }
}

/** 状态计数排除分页和当前工具栏选择，只继承搜索、日期及通用筛选。 */
export function buildPurchaseOrderStatusCountsQuery(
  listQuery: PurchaseOrderListQuery,
): PurchaseOrderStatusCountsQuery {
  const {
    orderStatus: _orderStatus,
    page: _page,
    pageSize: _pageSize,
    pendingTask: _pendingTask,
    ...baseQuery
  } = listQuery
  return baseQuery
}

export function purchaseTypeLabel(
  value: PurchaseOrderListItemDto['purchaseType'],
): string {
  return value === 'SALES_LINKED' ? '销售关联采购' : '备货采购'
}

export function orderStatusLabel(
  value: PurchaseOrderListItemDto['orderStatus'],
): string {
  return {
    CANCELLED: '已取消',
    COMPLETED: '已完成',
    CONFIRMED: '已确认',
    PENDING_REVIEW: '采购审核中',
  }[value]
}

export function fulfillmentStatusLabel(
  value: PurchaseOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    ORDERED: '已下单',
    PREPARING: '备货中',
    PARTIALLY_SHIPPED: '部分发货',
    SHIPPED: '已发货',
    SIGNED: '已签收',
  }[value]
}

export function paymentStatusLabel(
  value: PurchaseOrderListItemDto['paymentStatus'],
): string {
  return {
    PAID: '已付清',
    PARTIALLY_PAID: '部分付款',
    UNPAID: '未付款',
  }[value]
}

export function orderStatusTagClass(
  value: PurchaseOrderListItemDto['orderStatus'],
): string {
  return {
    CANCELLED: 'border-destructive/35 bg-destructive/10 text-destructive',
    COMPLETED: 'border-primary/35 bg-primary/10 text-primary',
    CONFIRMED: 'border-primary/35 bg-primary/10 text-primary',
    PENDING_REVIEW: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  }[value]
}

export function fulfillmentStatusTagClass(
  value: PurchaseOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    ORDERED: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    PREPARING: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    PARTIALLY_SHIPPED: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    SHIPPED: 'border-teal-500/35 bg-teal-500/10 text-teal-700 dark:text-teal-300',
    SIGNED: 'border-primary/35 bg-primary/10 text-primary',
  }[value]
}

export function paymentStatusTagClass(
  value: PurchaseOrderListItemDto['paymentStatus'],
): string {
  return {
    PAID: 'border-primary/35 bg-primary/10 text-primary',
    PARTIALLY_PAID: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    UNPAID: 'border-destructive/35 bg-destructive/10 text-destructive',
  }[value]
}

export function calculatePurchaseOrderPaymentProgress(
  paidAmount: string | null,
  purchaseTotalAmount: string | null,
): PurchaseOrderPaymentProgress | null {
  const paidResult = validateMoneyString(paidAmount, { precision: 4 })
  const totalResult = validateMoneyString(purchaseTotalAmount, { precision: 4 })
  if (
    !paidResult.valid
    || !totalResult.valid
    || paidResult.normalizedValue === null
    || totalResult.normalizedValue === null
  ) {
    return null
  }
  const total = new Decimal(totalResult.normalizedValue)
  if (total.isZero()) {
    return null
  }
  const percentage = new Decimal(paidResult.normalizedValue)
    .dividedBy(total)
    .times(100)
  return {
    formattedPercentage: `${percentage.toFixed(2, Decimal.ROUND_HALF_UP)}%`,
    progressValue: Decimal.min(percentage, 100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
  }
}

export function nextPurchaseOrderFulfillmentStatus(
  order: Pick<PurchaseOrderListItemDto, 'fulfillmentStatus' | 'orderStatus'>,
): PurchaseOrderListItemDto['fulfillmentStatus'] | null {
  if (order.orderStatus !== 'CONFIRMED') {
    return null
  }
  const nextByStatus: Record<
    PurchaseOrderListItemDto['fulfillmentStatus'],
    PurchaseOrderListItemDto['fulfillmentStatus'] | null
  > = {
    ORDERED: 'PREPARING',
    PREPARING: 'SHIPPED',
    PARTIALLY_SHIPPED: 'SHIPPED',
    SHIPPED: 'SIGNED',
    SIGNED: null,
  }
  return nextByStatus[order.fulfillmentStatus]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isPurchaseOrderAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    ))
}

export function getPurchaseOrderApiFailure(error: unknown): PurchaseOrderApiFailure {
  const fallback = { message: '采购订单请求失败，请稍后重试' }
  if (!isRecord(error)) {
    return fallback
  }
  const body = isRecord(error.body) ? error.body : undefined
  return {
    message: typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : fallback.message,
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
  }
}
