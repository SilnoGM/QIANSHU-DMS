import type {
  SalesOrderCurrencySummaryDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { SalesOrderListQuery } from '@/api/modules/sales-orders'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'

export type SalesOrderListViewMode = 'all' | 'pending'
export type SalesOrderListStatusSelection
  = | 'ALL'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'CONFIRMED'
    | 'LAND_TRANSIT'
    | 'PENDING'
    | 'PENDING_RECONCILIATION'
    | 'PREPARING'
    | 'SEA_TRANSIT'
    | 'WAITING_PAYMENT'
    | 'WAREHOUSE_ARRIVED'

export type SalesOrderQueryTarget = Pick<
  SalesOrderListQuery,
  'fulfillmentStatus' | 'orderStatus' | 'paymentStatus'
>

type SalesOrderSummarySource = Pick<
  SalesOrderListItemDto,
  | 'agreedTotalAmount'
  | 'balanceDueAmount'
  | 'currencyCode'
  | 'depositDueAmount'
  | 'id'
  | 'outstandingAmount'
  | 'receivedAmount'
  | 'standardSubtotalAmount'
>

const PENDING_STATUS_ITEMS: readonly QsStatusSwitchItem[] = [
  { label: '全部待办', value: 'ALL' },
  { label: '待采购', value: 'PENDING' },
  { label: '待发货', value: 'PREPARING' },
  { label: '待入仓', value: 'LAND_TRANSIT' },
  { label: '待装柜', value: 'WAREHOUSE_ARRIVED' },
  { label: '待签收', value: 'SEA_TRANSIT' },
  { label: '待收款', value: 'WAITING_PAYMENT' },
]

const ALL_ORDER_STATUS_ITEMS: readonly QsStatusSwitchItem[] = [
  { label: '全部订单', value: 'ALL' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '待对账', value: 'PENDING_RECONCILIATION' },
  { label: '已取消', value: 'CANCELLED' },
  { label: '已完成', value: 'COMPLETED' },
]

const PENDING_FULFILLMENT_STATUSES = [
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
] as const

const SUMMARY_AMOUNT_FIELDS = [
  'standardSubtotalAmount',
  'agreedTotalAmount',
  'depositDueAmount',
  'balanceDueAmount',
  'receivedAmount',
  'outstandingAmount',
] as const

const AMOUNT_SCALE = 10_000n
const AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d{1,4}))?$/u

export function getSalesOrderStatusItems(
  viewMode: SalesOrderListViewMode,
): readonly QsStatusSwitchItem[] {
  return viewMode === 'pending' ? PENDING_STATUS_ITEMS : ALL_ORDER_STATUS_ITEMS
}

/**
 * URL 查询参数属于不可信输入。这里只接受当前页面工具栏实际声明的值，避免两个页面
 * 互相复用到不属于自己的状态，刷新或浏览器回退时也能稳定落到“全部”。
 */
export function normalizeSalesOrderStatusSelection(
  viewMode: SalesOrderListViewMode,
  value: unknown,
): SalesOrderListStatusSelection {
  if (typeof value !== 'string') {
    return 'ALL'
  }
  return getSalesOrderStatusItems(viewMode).some(item => item.value === value)
    ? value as SalesOrderListStatusSelection
    : 'ALL'
}

/**
 * 当前公开列表接口只接受单个订单状态与单个履约状态，因此“全部”视图拆成互斥查询目标，
 * 页面再做精确聚合。待对账与已完成尚未进入当前 API/数据库契约，保留入口但不发送非法值。
 */
export function resolveSalesOrderQueryTargets(
  viewMode: SalesOrderListViewMode,
  selection: SalesOrderListStatusSelection,
): readonly SalesOrderQueryTarget[] {
  if (viewMode === 'pending') {
    const paymentTargets: readonly SalesOrderQueryTarget[] = [
      { orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID' },
      { orderStatus: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID' },
    ]
    if (selection === 'WAITING_PAYMENT') {
      return paymentTargets
    }
    const statuses = selection === 'ALL'
      ? PENDING_FULFILLMENT_STATUSES
      : PENDING_FULFILLMENT_STATUSES.filter(status => status === selection)
    const fulfillmentTargets: SalesOrderQueryTarget[] = statuses.map(fulfillmentStatus => ({
      fulfillmentStatus,
      orderStatus: 'CONFIRMED',
    }))
    return selection === 'ALL'
      ? [...fulfillmentTargets, ...paymentTargets]
      : fulfillmentTargets
  }

  if (selection === 'ALL') {
    // 首版正式订单无草稿机制；显式查询两个已落地状态，防止历史草稿混入全部订单。
    return [{ orderStatus: 'CONFIRMED' }, { orderStatus: 'CANCELLED' }]
  }
  if (selection === 'CONFIRMED' || selection === 'CANCELLED') {
    return [{ orderStatus: selection }]
  }
  return []
}

function parseAmountUnits(value: string): bigint {
  const match = AMOUNT_PATTERN.exec(value)
  if (!match) {
    throw new TypeError(`Invalid sales order summary amount: ${value}`)
  }
  const [, sign, integerPart = '0', fractionPart = ''] = match
  const units = BigInt(integerPart) * AMOUNT_SCALE
    + BigInt(fractionPart.padEnd(4, '0'))
  return sign === '-' ? -units : units
}

function formatAmountUnits(units: bigint): string {
  const sign = units < 0n ? '-' : ''
  const absolute = units < 0n ? -units : units
  const integerPart = absolute / AMOUNT_SCALE
  const fractionPart = (absolute % AMOUNT_SCALE).toString().padStart(4, '0')
  return `${sign}${integerPart}.${fractionPart}`
}

/** 多个待办条件允许重叠，按稳定订单 ID 保留首次出现的数据，避免列表与总数重复。 */
export function deduplicateSalesOrderItems<T extends { id: string }>(
  items: readonly T[],
): T[] {
  const uniqueItems = new Map<string, T>()
  for (const item of items) {
    if (!uniqueItems.has(item.id)) {
      uniqueItems.set(item.id, item)
    }
  }
  return [...uniqueItems.values()]
}

/**
 * 全部待办不能直接相加各查询响应的汇总，因为同一订单可能同时待签收和待收款。
 * 这里从去重后的订单重新按币种汇总，并保持四位定点小数。
 */
export function summarizeSalesOrderItemsByCurrency(
  items: readonly SalesOrderSummarySource[],
): SalesOrderCurrencySummaryDto[] {
  const grouped = new Map<
    SalesOrderCurrencySummaryDto['currencyCode'],
    SalesOrderCurrencySummaryDto
  >()

  for (const item of items) {
    const current = grouped.get(item.currencyCode) ?? {
      agreedTotalAmount: '0.0000',
      balanceDueAmount: '0.0000',
      currencyCode: item.currencyCode,
      depositDueAmount: '0.0000',
      orderCount: 0,
      outstandingAmount: '0.0000',
      receivedAmount: '0.0000',
      standardSubtotalAmount: '0.0000',
    }
    const next = { ...current, orderCount: current.orderCount + 1 }
    for (const field of SUMMARY_AMOUNT_FIELDS) {
      next[field] = formatAmountUnits(
        parseAmountUnits(current[field]) + parseAmountUnits(item[field]),
      )
    }
    grouped.set(item.currencyCode, next)
  }

  return ['TWD', 'MYR'].flatMap((currencyCode) => {
    const summary = grouped.get(currencyCode as SalesOrderCurrencySummaryDto['currencyCode'])
    return summary ? [summary] : []
  })
}
