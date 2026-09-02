import type { SalesOrderFulfillmentStatus } from '../../../generated/prisma/enums'

/**
 * 采购域选择销售来源时允许的两个可信视图。
 *
 * 前端只提交视图意图，真实履约状态集合固定在服务端，避免调用方通过任意状态
 * 组合绕过采购阶段限制。这里不判断是否存在采购单，严格遵循销售订单当前履约状态。
 */
export const PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS = [
  'INITIAL_PURCHASE',
  'SUPPLEMENTAL_PURCHASE',
] as const

export type PurchaseOrderSourceSalesOrderView =
  typeof PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS[number]

export const PURCHASE_ORDER_SOURCE_FULFILLMENT_STATUSES: Readonly<
  Record<PurchaseOrderSourceSalesOrderView, readonly SalesOrderFulfillmentStatus[]>
> = {
  INITIAL_PURCHASE: ['PENDING'],
  SUPPLEMENTAL_PURCHASE: ['PREPARING', 'LAND_TRANSIT', 'WAREHOUSE_ARRIVED'],
}
