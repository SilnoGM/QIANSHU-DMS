import type {
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'

/**
 * 待采购订单停在「采购审核中」的可见原因。
 *
 * 口径与采购覆盖推进保持一致：有效采购（含审核中）已经占满全部销售数量时订单
 * 无法再发起采购，但只有已审核采购才会把履约状态推进到 `PREPARING`。两者之间
 * 的窗口必须由界面解释，否则运营会在待采购里看到一张“点不动”的订单。
 */
export type SalesOrderPurchaseHoldReason = 'AWAITING_PURCHASE_REVIEW'

export interface SalesOrderPurchaseHold {
  readonly reason: SalesOrderPurchaseHoldReason
  readonly pendingReviewOrderCount: number
}

/**
 * 覆盖率查询只会收录「已确认 + 待采购 + 无可采购余额 + 存在审核中占用」的订单。
 * 装配列表时仍复核订单状态，避免把其它状态的订单误标成审核中；数量缺失或为零
 * 一律返回 `null`，不显示没有依据的停留原因。
 */
export function resolveSalesOrderPurchaseHold(
  order: {
    readonly orderStatus: SalesOrderStatus
    readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  },
  pendingReviewOrderCount: number | undefined,
): SalesOrderPurchaseHold | null {
  if (order.orderStatus !== 'CONFIRMED' || order.fulfillmentStatus !== 'PENDING') {
    return null
  }
  if (pendingReviewOrderCount === undefined || pendingReviewOrderCount <= 0) {
    return null
  }
  return { reason: 'AWAITING_PURCHASE_REVIEW', pendingReviewOrderCount }
}
