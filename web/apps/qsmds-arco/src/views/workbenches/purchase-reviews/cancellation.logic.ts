import type { PurchaseOrderDetailDto } from '../../../api/generated/types.gen'
import type { PurchaseOrderCancelBlockedReason } from '../../operations/purchase-orders/purchase-order-cancel.logic'
import { getPurchaseOrderCancelBlockedReason } from '../../operations/purchase-orders/purchase-order-cancel.logic'

// 取消通知与运营列表共用同一模板，避免两个入口复制出不同文本。
export { buildPurchaseCancellationText } from '../../operations/purchase-orders/purchase-order-cancel.logic'

/** 审核工作台只在「已通过」页签提供取消，因此不允许审核中订单。 */
export function purchaseCancellationBlockReason(
  detail: Pick<PurchaseOrderDetailDto, 'orderStatus' | 'fulfillmentStatus' | 'paidAmount'>,
): PurchaseOrderCancelBlockedReason | null {
  return getPurchaseOrderCancelBlockedReason(detail, {
    allowPendingReview: false,
  })
}
