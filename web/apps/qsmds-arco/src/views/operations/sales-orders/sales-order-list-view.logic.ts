import type {
  SalesOrderCurrencySummaryDto,
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
    | 'WAREHOUSE_ARRIVED'

export type SalesOrderQueryTarget = Pick<
  SalesOrderListQuery,
  'fulfillmentStatus' | 'orderStatus'
>

const PENDING_STATUS_ITEMS: readonly QsStatusSwitchItem[] = [
  { label: '全部待办', value: 'ALL' },
  { label: '待采购', value: 'PENDING' },
  { label: '待发货', value: 'PREPARING' },
  { label: '待入仓', value: 'LAND_TRANSIT' },
  { label: '待装柜', value: 'WAREHOUSE_ARRIVED' },
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
    const statuses = selection === 'ALL'
      ? PENDING_FULFILLMENT_STATUSES
      : PENDING_FULFILLMENT_STATUSES.filter(status => status === selection)
    return statuses.map(fulfillmentStatus => ({
      fulfillmentStatus,
      orderStatus: 'CONFIRMED',
    }))
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

/** 多个互斥状态的服务端全量汇总按币种合并，金额坚持使用定点整数避免浮点误差。 */
export function mergeSalesOrderCurrencySummaries(
  groups: readonly (readonly SalesOrderCurrencySummaryDto[])[],
): SalesOrderCurrencySummaryDto[] {
  const merged = new Map<
    SalesOrderCurrencySummaryDto['currencyCode'],
    SalesOrderCurrencySummaryDto
  >()

  for (const summaries of groups) {
    for (const summary of summaries) {
      const current = merged.get(summary.currencyCode)
      if (!current) {
        merged.set(summary.currencyCode, { ...summary })
        continue
      }
      const next = { ...current, orderCount: current.orderCount + summary.orderCount }
      for (const field of SUMMARY_AMOUNT_FIELDS) {
        next[field] = formatAmountUnits(
          parseAmountUnits(current[field]) + parseAmountUnits(summary[field]),
        )
      }
      merged.set(summary.currencyCode, next)
    }
  }

  return ['TWD', 'MYR'].flatMap((currencyCode) => {
    const summary = merged.get(currencyCode as SalesOrderCurrencySummaryDto['currencyCode'])
    return summary ? [summary] : []
  })
}
