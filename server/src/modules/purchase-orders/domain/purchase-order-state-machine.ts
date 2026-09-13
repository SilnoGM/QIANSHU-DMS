import type {
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
} from '../../../generated/prisma/enums'
import { parsePurchaseOrderAmountUnits } from './purchase-order-decimal'
import { purchaseOrderRuleFailure } from './purchase-order-errors'

const ORDER_TRANSITIONS: Readonly<
  Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>
> = {
  PENDING_REVIEW: ['CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

const FULFILLMENT_TRANSITIONS: Readonly<
  Record<PurchaseOrderFulfillmentStatus, readonly PurchaseOrderFulfillmentStatus[]>
> = {
  ORDERED: ['PREPARING'],
  PREPARING: ['PARTIALLY_SHIPPED', 'SHIPPED'],
  PARTIALLY_SHIPPED: ['SHIPPED'],
  SHIPPED: ['SIGNED'],
  SIGNED: [],
}

export function assertPurchaseOrderStatusTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
  context: { readonly activePaidAmount: string },
): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
      '采购订单状态流转无效',
    )
  }
  if (
    to === 'CANCELLED'
    && parsePurchaseOrderAmountUnits(context.activePaidAmount) > 0n
  ) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS',
      '已有有效付款的采购订单不能取消',
    )
  }
}

export function assertPurchaseOrderFulfillmentTransition(
  from: PurchaseOrderFulfillmentStatus,
  to: PurchaseOrderFulfillmentStatus,
  context: { readonly orderStatus: PurchaseOrderStatus },
): void {
  if (context.orderStatus === 'PENDING_REVIEW') {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
      '采购订单审核通过后才能继续履约',
    )
  }
  if (context.orderStatus === 'CANCELLED') {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CANCELLED',
      '已取消的采购订单不能继续履约',
    )
  }
  if (!FULFILLMENT_TRANSITIONS[from].includes(to)) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_FULFILLMENT_TRANSITION_INVALID',
      '采购履约状态必须按顺序流转',
    )
  }
}

export interface PurchaseOrderPendingState {
  readonly orderStatus: PurchaseOrderStatus
  readonly fulfillmentStatus: PurchaseOrderFulfillmentStatus
  readonly paymentStatus: PurchaseOrderPaymentStatus
}

/**
 * 审核通过后的采购订单状态由已锁定的履约和付款事实派生。
 * 审核中只能由审核命令解除；`CANCELLED` 是人工终态，不允许被后续事实重新打开。
 * 审核通过的其余状态则保持事实一致性，
 * 因此付款作废后可从 `COMPLETED` 自动回到 `CONFIRMED`。
 */
export function derivePurchaseOrderStatus(
  state: PurchaseOrderPendingState,
): PurchaseOrderStatus {
  if (state.orderStatus === 'CANCELLED') return 'CANCELLED'
  if (state.orderStatus === 'PENDING_REVIEW') return 'PENDING_REVIEW'
  return state.fulfillmentStatus === 'SIGNED' && state.paymentStatus === 'PAID'
    ? 'COMPLETED'
    : 'CONFIRMED'
}

export function isPendingPurchaseOrder(state: PurchaseOrderPendingState): boolean {
  return state.orderStatus === 'PENDING_REVIEW'
    || (state.orderStatus === 'CONFIRMED'
      && (state.fulfillmentStatus !== 'SIGNED' || state.paymentStatus !== 'PAID'))
}
