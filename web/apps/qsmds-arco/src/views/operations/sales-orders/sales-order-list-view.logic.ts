import type {
  FactoryShipmentResultDto,
  SalesOrderCurrencySummaryDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type {
  SalesOrderListQuery,
  SalesOrderStatusCountsQuery,
} from '@/api/modules/sales-orders'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'

export type SalesOrderListViewMode = 'all' | 'pending'
export type SalesOrderListStatusSelection
  = | 'ALL'
    | 'AWAITING_PURCHASE_REVIEW'
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
  'fulfillmentStatus' | 'orderStatus' | 'paymentStatus' | 'purchaseHold'
>

export type SalesOrderPendingActionKey
  = | 'DELIVERY_RECEIPT'
    | 'FACTORY_SHIPMENT'
    | 'RECORD_PAYMENT'
    | 'SUBMIT_PURCHASE'
    | 'URGE_PURCHASE_REVIEW'
    | 'WAREHOUSE_RECEIPT'

export interface SalesOrderPendingActionItem {
  icon: string
  key: SalesOrderPendingActionKey
  label: string
}

type SalesOrderPendingActionSource = Pick<
  SalesOrderListItemDto,
  'fulfillmentStatus' | 'paymentStatus' | 'purchaseHold'
>

type SalesOrderPendingActionGuardSource = Pick<
  SalesOrderListItemDto,
  'fulfillmentStatus' | 'orderStatus' | 'paymentStatus' | 'purchaseHold'
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
  { label: '待采购', value: 'PENDING' },
  { label: '采购审核中', value: 'AWAITING_PURCHASE_REVIEW' },
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

const FORMAL_ORDER_STATUSES = [
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'CANCELLED',
  'COMPLETED',
] as const

const PENDING_ACTION_BY_FULFILLMENT_STATUS: Partial<Record<
  SalesOrderListItemDto['fulfillmentStatus'],
  SalesOrderPendingActionItem
>> = {
  PENDING: {
    icon: 'i-lucide:clipboard-plus',
    key: 'SUBMIT_PURCHASE',
    label: '新增采购',
  },
  PREPARING: {
    icon: 'i-lucide:factory',
    key: 'FACTORY_SHIPMENT',
    label: '工厂发货',
  },
  LAND_TRANSIT: {
    icon: 'i-lucide:warehouse',
    key: 'WAREHOUSE_RECEIPT',
    label: '货物入仓',
  },
  // 待装柜不提供行内动作：装柜在采运工作台的柜次管理执行，货件全部装柜后订单自动进入海运在途。
  SEA_TRANSIT: {
    icon: 'i-lucide:package-check',
    key: 'DELIVERY_RECEIPT',
    label: '货物签收',
  },
}

const RECORD_PAYMENT_ACTION: SalesOrderPendingActionItem = {
  icon: 'i-lucide:hand-coins',
  key: 'RECORD_PAYMENT',
  label: '表外收款',
}

/**
 * 催办只是占位动作：当前没有通知通道，点击后只给轻提示；它不写数据，
 * 因此不需要额外权限点。
 */
const URGE_PURCHASE_REVIEW_ACTION: SalesOrderPendingActionItem = {
  icon: 'i-lucide:bell-ring',
  key: 'URGE_PURCHASE_REVIEW',
  label: '催办',
}

/** 旧服务端响应没有该字段时按“无停留原因”处理，保证混合版本部署期间行为不退化。 */
function isAwaitingPurchaseReview(order: SalesOrderPendingActionSource): boolean {
  const hold = order.purchaseHold ?? null
  return hold?.reason === 'AWAITING_PURCHASE_REVIEW'
}

const SUMMARY_AMOUNT_FIELDS = [
  'standardSubtotalAmount',
  'agreedTotalAmount',
  'depositDueAmount',
  'balanceDueAmount',
  'receivedAmount',
  'outstandingAmount',
] as const

const AMOUNT_SCALE = 100n
const AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u

export function getSalesOrderStatusItems(
  viewMode: SalesOrderListViewMode,
): readonly QsStatusSwitchItem[] {
  return viewMode === 'pending' ? PENDING_STATUS_ITEMS : ALL_ORDER_STATUS_ITEMS
}

/** 计数使用与列表相同的基础筛选，但不能携带分页或当前工具栏状态。 */
export function buildSalesOrderStatusCountsQuery(
  listQuery: SalesOrderListQuery,
  view: SalesOrderListViewMode,
): SalesOrderStatusCountsQuery {
  const {
    fulfillmentStatus: _fulfillmentStatus,
    orderStatus: _orderStatus,
    page: _page,
    pageSize: _pageSize,
    purchaseHold: _purchaseHold,
    ...baseQuery
  } = listQuery
  return { ...baseQuery, view }
}

/**
 * URL 查询参数属于不可信输入。这里只接受当前页面工具栏实际声明的值，避免两个页面
 * 互相复用到不属于自己的状态；待办页默认进入首个有效分类“待采购”，全部订单页
 * 继续默认进入“全部订单”。
 */
export function normalizeSalesOrderStatusSelection(
  viewMode: SalesOrderListViewMode,
  value: unknown,
): SalesOrderListStatusSelection {
  const defaultSelection: SalesOrderListStatusSelection = viewMode === 'pending'
    ? 'PENDING'
    : 'ALL'
  if (typeof value !== 'string') {
    return defaultSelection
  }
  return getSalesOrderStatusItems(viewMode).some(item => item.value === value)
    ? value as SalesOrderListStatusSelection
    : defaultSelection
}

/**
 * 具体待办筛选只暴露与筛选语义一致的单一操作；“全部待办”则根据订单当前状态
 * 同时组合履约推进与收款入口。已付清订单不再出现收款操作。
 */
export function resolvePendingSalesOrderActions(
  selection: SalesOrderListStatusSelection,
  order: SalesOrderPendingActionSource,
): readonly SalesOrderPendingActionItem[] {
  // 「采购审核中」是独立分类：采购已提交但未审核，唯一可做的是催办，
  // 不再提供必然失败的「新增采购」，也不与收款等其它待办动作复合。
  if (selection === 'AWAITING_PURCHASE_REVIEW') {
    return [URGE_PURCHASE_REVIEW_ACTION]
  }

  if (selection === 'WAITING_PAYMENT') {
    return order.paymentStatus === 'PAID' ? [] : [RECORD_PAYMENT_ACTION]
  }

  if (selection !== 'ALL') {
    // 待采购已按服务端分桶排除审核中订单；若因并发仍出现该行，也不给出必然失败的入口。
    if (selection === 'PENDING' && isAwaitingPurchaseReview(order)) {
      return [URGE_PURCHASE_REVIEW_ACTION]
    }
    const fulfillmentAction = PENDING_ACTION_BY_FULFILLMENT_STATUS[
      selection as SalesOrderListItemDto['fulfillmentStatus']
    ]
    return fulfillmentAction === undefined ? [] : [fulfillmentAction]
  }

  const actions: SalesOrderPendingActionItem[] = []
  if (isAwaitingPurchaseReview(order)) {
    actions.push(URGE_PURCHASE_REVIEW_ACTION)
  }
  else {
    const fulfillmentAction = PENDING_ACTION_BY_FULFILLMENT_STATUS[order.fulfillmentStatus]
    if (fulfillmentAction !== undefined) {
      actions.push(fulfillmentAction)
    }
  }
  if (order.paymentStatus !== 'PAID') {
    actions.push(RECORD_PAYMENT_ACTION)
  }
  return actions
}

/**
 * 待办操作列固定占用一个业务动作槽位。这里不按付款状态裁掉收款入口，
 * 让同一 Tab 的按钮位置保持稳定；是否可执行由点击守卫说明原因。
 */
export function resolvePendingSalesOrderActionSlot(
  selection: SalesOrderListStatusSelection,
  order: SalesOrderPendingActionSource,
): SalesOrderPendingActionItem | null {
  if (selection === 'AWAITING_PURCHASE_REVIEW') {
    return URGE_PURCHASE_REVIEW_ACTION
  }
  if (selection === 'WAITING_PAYMENT') {
    return RECORD_PAYMENT_ACTION
  }
  if (selection === 'PENDING') {
    return isAwaitingPurchaseReview(order)
      ? URGE_PURCHASE_REVIEW_ACTION
      : PENDING_ACTION_BY_FULFILLMENT_STATUS.PENDING ?? null
  }
  return PENDING_ACTION_BY_FULFILLMENT_STATUS[
    selection as SalesOrderListItemDto['fulfillmentStatus']
  ] ?? null
}

/**
 * 列表快照只用于点击前提示；采购审核中、待审核收款等并发事实仍以服务端拒绝为准。
 */
export function resolvePendingSalesOrderActionBlockedReason(
  key: SalesOrderPendingActionKey,
  order: SalesOrderPendingActionGuardSource,
): string | null {
  if (key === 'URGE_PURCHASE_REVIEW') {
    return null
  }
  if (order.orderStatus !== 'CONFIRMED') {
    return '只有已确认订单可以执行该操作'
  }
  if (key === 'SUBMIT_PURCHASE') {
    if (isAwaitingPurchaseReview(order)) {
      return '采购正在审核中，请先催办'
    }
    return order.fulfillmentStatus === 'PENDING'
      ? null
      : '订单当前不在待采购阶段'
  }
  if (key === 'FACTORY_SHIPMENT') {
    return order.fulfillmentStatus === 'PREPARING'
      ? null
      : '订单当前不在待发货阶段'
  }
  if (key === 'WAREHOUSE_RECEIPT') {
    return order.fulfillmentStatus === 'LAND_TRANSIT'
      ? null
      : '订单当前不在待入仓阶段'
  }
  if (key === 'DELIVERY_RECEIPT') {
    return order.fulfillmentStatus === 'SEA_TRANSIT'
      ? null
      : '订单当前不在待签收阶段'
  }
  return order.paymentStatus === 'PAID'
    ? '订单已付清，无需再登记收款'
    : null
}

/**
 * 销售履约状态由 Server 在发货事务中统一重算，Web 只把返回结果翻译为轻提示，
 * 不根据本地采购单快照重复实现覆盖和全量发货判断。
 */
export function formatSalesFactoryShipmentSuccess(
  result: FactoryShipmentResultDto,
): string {
  if (result.changedPurchaseOrderCount === 0) {
    return '所选货件已发货，未重复处理'
  }
  if (result.salesOrder?.advancedToLandTransit === true) {
    return `已完成 ${result.changedPurchaseOrderCount} 张采购单的本次货件发货，销售订单已进入陆运中`
  }
  return `已完成 ${result.changedPurchaseOrderCount} 张采购单的本次货件发货，仍有 ${result.remainingPendingShipmentCount} 张采购单待发货`
}

/**
 * 当前公开列表接口只接受单个订单状态与单个履约状态，因此“全部”视图拆成互斥查询目标，
 * 页面再做精确聚合。正式订单明确排除历史草稿，四类目标均来自服务端真实枚举。
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
    // 「采购审核中」是待采购的互斥分桶：服务端按覆盖事实过滤，不是持久化状态。
    if (selection === 'AWAITING_PURCHASE_REVIEW') {
      return [{
        fulfillmentStatus: 'PENDING',
        orderStatus: 'CONFIRMED',
        purchaseHold: 'AWAITING_PURCHASE_REVIEW',
      }]
    }
    const statuses = selection === 'ALL'
      ? PENDING_FULFILLMENT_STATUSES
      : PENDING_FULFILLMENT_STATUSES.filter(status => status === selection)
    const fulfillmentTargets: SalesOrderQueryTarget[] = statuses.map(fulfillmentStatus => ({
      fulfillmentStatus,
      orderStatus: 'CONFIRMED',
      // 单看「待采购」时排除审核中订单；「全部待办」仍是所有分桶的并集。
      ...(selection === 'PENDING'
        ? { purchaseHold: 'EXCLUDE_AWAITING_PURCHASE_REVIEW' as const }
        : {}),
    }))
    return selection === 'ALL'
      ? [...fulfillmentTargets, ...paymentTargets]
      : fulfillmentTargets
  }

  if (selection === 'ALL') {
    // 首版正式订单无草稿机制；显式查询四个已落地状态，防止历史草稿混入全部订单。
    return FORMAL_ORDER_STATUSES.map(orderStatus => ({ orderStatus }))
  }
  const orderStatus = FORMAL_ORDER_STATUSES.find(status => status === selection)
  if (orderStatus !== undefined) {
    return [{ orderStatus }]
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
    + BigInt(fractionPart.padEnd(2, '0'))
  return sign === '-' ? -units : units
}

function formatAmountUnits(units: bigint): string {
  const sign = units < 0n ? '-' : ''
  const absolute = units < 0n ? -units : units
  const integerPart = absolute / AMOUNT_SCALE
  const fractionPart = (absolute % AMOUNT_SCALE).toString().padStart(2, '0')
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
      agreedTotalAmount: '0.00',
      balanceDueAmount: '0.00',
      currencyCode: item.currencyCode,
      depositDueAmount: '0.00',
      orderCount: 0,
      outstandingAmount: '0.00',
      receivedAmount: '0.00',
      standardSubtotalAmount: '0.00',
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
