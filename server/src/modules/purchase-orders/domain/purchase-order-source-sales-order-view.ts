import type {
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'

/**
 * 采购域选择销售来源时允许的三个可信视图。
 *
 * 前端只提交视图意图，分类必须由服务端基于订单状态、履约阶段和有效采购事实得出，
 * 避免调用方通过任意状态组合或产品 ID 聚合绕过逐销售明细的剩余数量边界。
 */
export const PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS = [
  'UNPURCHASED',
  'PARTIALLY_PURCHASED',
  'COMPLETED_PURCHASE_ADD_ON',
] as const

export type PurchaseOrderSourceSalesOrderView =
  typeof PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS[number]

export interface SalesOrderPurchaseFacts {
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly activePurchaseOrderCount: number
  readonly purchasedQuantity: number
  readonly remainingQuantity: number
}

export const SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES = [
  'PENDING',
  'PREPARING',
  'LAND_TRANSIT',
  'WAREHOUSE_ARRIVED',
] as const satisfies readonly SalesOrderFulfillmentStatus[]

const PRE_SEA_FULFILLMENT_STATUS_SET = new Set<SalesOrderFulfillmentStatus>(
  SALES_ORDER_PRE_SEA_FULFILLMENT_STATUSES,
)

/**
 * 把数据库聚合出的销售订单采购事实映射为唯一视图。
 *
 * 该函数刻意拒绝互相矛盾的数量事实，不尝试“猜测”最接近的视图；调用方应先修复
 * 聚合或并发状态，再让用户重新选择，避免把已采购行错误地当作可采购行。
 */
export function classifyPurchaseSourceView(
  facts: SalesOrderPurchaseFacts,
): PurchaseOrderSourceSalesOrderView | null {
  if (
    facts.orderStatus !== 'CONFIRMED'
    || !PRE_SEA_FULFILLMENT_STATUS_SET.has(facts.fulfillmentStatus)
    || !Number.isInteger(facts.activePurchaseOrderCount)
    || !Number.isInteger(facts.purchasedQuantity)
    || !Number.isInteger(facts.remainingQuantity)
    || facts.activePurchaseOrderCount < 0
    || facts.purchasedQuantity < 0
    || facts.remainingQuantity < 0
  ) {
    return null
  }

  if (
    facts.fulfillmentStatus === 'PENDING'
    && facts.activePurchaseOrderCount === 0
    && facts.purchasedQuantity === 0
    && facts.remainingQuantity > 0
  ) {
    return 'UNPURCHASED'
  }
  if (
    facts.activePurchaseOrderCount > 0
    && facts.purchasedQuantity > 0
    && facts.remainingQuantity > 0
  ) {
    return 'PARTIALLY_PURCHASED'
  }
  if (
    facts.activePurchaseOrderCount > 0
    && facts.remainingQuantity === 0
  ) {
    return 'COMPLETED_PURCHASE_ADD_ON'
  }
  return null
}
