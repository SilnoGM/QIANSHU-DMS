import type {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../generated/prisma/enums'

export const SALES_ORDER_LIST_STATUS_SELECTIONS = [
  'ALL',
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
  'SEA_TRANSIT',
  'WAITING_PAYMENT',
  'AWAITING_PURCHASE_REVIEW',
  'CONFIRMED',
  'PENDING_RECONCILIATION',
  'CANCELLED',
  'COMPLETED',
] as const

export type SalesOrderListStatusSelection
  = typeof SALES_ORDER_LIST_STATUS_SELECTIONS[number]

export interface SalesOrderQueryTarget {
  readonly orderStatus?: SalesOrderStatus
  readonly fulfillmentStatus?: SalesOrderFulfillmentStatus
  readonly paymentStatus?: SalesOrderPaymentStatus
  readonly purchaseHold?: 'AWAITING_PURCHASE_REVIEW' | 'EXCLUDE_AWAITING_PURCHASE_REVIEW'
}

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

/**
 * 与服务端分页共用同一份状态分桶语义。
 *
 * 这里输出的是 OR 目标而不是多个独立查询：单表 OR 不会产生重复订单，
 * 因此总数、分页和金额汇总可以一次完成，不再需要前端合并与去重。
 */
export function resolveSalesOrderQueryTargets(
  viewMode: 'all' | 'pending',
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
