import type {
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import { parseSalesOrderAmountUnits } from './sales-order-decimal'
import { salesOrderRuleFailure } from './sales-order-errors'

const ORDER_TRANSITIONS: Readonly<Record<SalesOrderStatus, readonly SalesOrderStatus[]>> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
}

const FULFILLMENT_TRANSITIONS: Readonly<
  Record<SalesOrderFulfillmentStatus, readonly SalesOrderFulfillmentStatus[]>
> = {
  PENDING: ['PREPARING'],
  PREPARING: ['SHIPPED'],
  SHIPPED: ['SIGNED'],
  SIGNED: [],
}

export function assertSalesOrderStatusTransition(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
  context: { readonly activeReceivedAmount: string },
): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return salesOrderRuleFailure(
      'SALES_ORDER_STATUS_TRANSITION_INVALID',
      '订单状态流转无效',
    )
  }
  if (
    to === 'CANCELLED'
    && parseSalesOrderAmountUnits(context.activeReceivedAmount) > 0n
  ) {
    return salesOrderRuleFailure(
      'SALES_ORDER_CANCEL_HAS_PAYMENTS',
      '已有有效收款的订单不能取消',
    )
  }
}

export function assertSalesOrderFulfillmentTransition(
  from: SalesOrderFulfillmentStatus,
  to: SalesOrderFulfillmentStatus,
  context: { readonly hasActiveDeliveryReceipt: boolean },
): void {
  if (!FULFILLMENT_TRANSITIONS[from].includes(to)) {
    return salesOrderRuleFailure(
      'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
      '履约状态必须按顺序流转',
    )
  }
  if (to === 'SIGNED' && !context.hasActiveDeliveryReceipt) {
    return salesOrderRuleFailure(
      'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
      '签收前必须上传有效签收单',
    )
  }
}
