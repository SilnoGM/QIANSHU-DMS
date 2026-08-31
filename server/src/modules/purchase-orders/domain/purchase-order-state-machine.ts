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
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
}

const FULFILLMENT_TRANSITIONS: Readonly<
  Record<PurchaseOrderFulfillmentStatus, readonly PurchaseOrderFulfillmentStatus[]>
> = {
  ORDERED: ['PREPARING'],
  PREPARING: ['SHIPPED'],
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

export function isPendingPurchaseOrder(state: PurchaseOrderPendingState): boolean {
  return state.orderStatus !== 'CANCELLED'
    && (state.fulfillmentStatus !== 'SIGNED' || state.paymentStatus !== 'PAID')
}
