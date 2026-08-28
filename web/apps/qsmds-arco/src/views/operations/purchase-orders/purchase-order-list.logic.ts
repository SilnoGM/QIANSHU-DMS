import type { PurchaseOrderListItemDto } from '../../../api/generated/types.gen'
import type { PurchaseOrderListQuery } from '../../../api/modules/purchase-orders'
import type { QsGenericTableFilterValues } from '../../../components/business/QsGenericTable/logic'

import Decimal from 'decimal.js'

import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export type PurchaseOrderListViewMode = 'all' | 'pending'

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

const PURCHASE_TYPES = ['SALES_LINKED', 'STOCK'] as const
const ORDER_STATUSES = ['CONFIRMED', 'CANCELLED'] as const
const FULFILLMENT_STATUSES = [
  'PENDING_ORDER',
  'ORDERED',
  'PREPARING',
  'SHIPPED',
  'SIGNED',
] as const
const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const

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
  const keyword = source.searchKeyword.trim().normalize('NFKC')
  const supplierValue = textFilter(source.filters, 'supplierValue')
  const purchaseType = enumFilter(source.filters, 'purchaseType', PURCHASE_TYPES)
  const orderStatus = enumFilter(source.filters, 'orderStatus', ORDER_STATUSES)
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
    ...(keyword === '' ? {} : { keyword }),
    ...(supplierValue === undefined ? {} : { supplierValue }),
    ...(purchaseType === undefined ? {} : { purchaseType }),
    ...(orderStatus === undefined ? {} : { orderStatus }),
    ...(fulfillmentStatus === undefined ? {} : { fulfillmentStatus }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
    ...(orderDateFrom === undefined ? {} : { orderDateFrom }),
    ...(orderDateTo === undefined ? {} : { orderDateTo }),
  }
}

export function purchaseTypeLabel(
  value: PurchaseOrderListItemDto['purchaseType'],
): string {
  return value === 'SALES_LINKED' ? '销售关联采购' : '备货采购'
}

export function orderStatusLabel(
  value: PurchaseOrderListItemDto['orderStatus'],
): string {
  return value === 'CONFIRMED' ? '已确认' : '已取消'
}

export function fulfillmentStatusLabel(
  value: PurchaseOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    ORDERED: '已下单',
    PENDING_ORDER: '待下单',
    PREPARING: '备货中',
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
  return value === 'CONFIRMED'
    ? 'border-primary/35 bg-primary/10 text-primary'
    : 'border-destructive/35 bg-destructive/10 text-destructive'
}

export function fulfillmentStatusTagClass(
  value: PurchaseOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    ORDERED: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    PENDING_ORDER: 'border-border bg-muted/60 text-muted-foreground',
    PREPARING: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
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
  if (order.orderStatus === 'CANCELLED') {
    return null
  }
  const nextByStatus: Record<
    PurchaseOrderListItemDto['fulfillmentStatus'],
    PurchaseOrderListItemDto['fulfillmentStatus'] | null
  > = {
    ORDERED: 'PREPARING',
    PENDING_ORDER: 'ORDERED',
    PREPARING: 'SHIPPED',
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
