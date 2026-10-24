import type {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import { parseSalesOrderAmountUnits } from './sales-order-decimal'
import { salesOrderRuleFailure } from './sales-order-errors'

const ORDER_TRANSITIONS: Readonly<Record<SalesOrderStatus, readonly SalesOrderStatus[]>> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PENDING_RECONCILIATION', 'CANCELLED'],
  PENDING_RECONCILIATION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
}

const FULFILLMENT_TRANSITIONS: Readonly<
  Record<SalesOrderFulfillmentStatus, readonly SalesOrderFulfillmentStatus[]>
> = {
  PENDING: ['PREPARING'],
  PREPARING: ['LAND_TRANSIT'],
  LAND_TRANSIT: ['WAREHOUSE_ARRIVED'],
  WAREHOUSE_ARRIVED: ['SEA_TRANSIT'],
  SEA_TRANSIT: ['SIGNED'],
  SIGNED: [],
}

export function assertSalesOrderStatusTransition(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
  context: {
    readonly activeReceivedAmount: string
    readonly fulfillmentStatus: SalesOrderFulfillmentStatus
    readonly paymentStatus: SalesOrderPaymentStatus
  },
): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return salesOrderRuleFailure(
      'SALES_ORDER_STATUS_TRANSITION_INVALID',
      '订单状态流转无效',
    )
  }
  // 签收不可逆，放在收款之前：先告知调用方无法通过作废收款解除的阻塞。
  if (to === 'CANCELLED' && context.fulfillmentStatus === 'SIGNED') {
    return salesOrderRuleFailure(
      'SALES_ORDER_CANCEL_SIGNED',
      '订单已签收，不能取消',
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
  // 待对账和已完成都是运营人员显式确认的订单状态。资格只读取行锁事务中的
  // 履约、付款事实，不能接受客户端随状态请求提交的派生条件。
  const signedAndPaid = context.fulfillmentStatus === 'SIGNED'
    && context.paymentStatus === 'PAID'
  if (to === 'PENDING_RECONCILIATION' && !signedAndPaid) {
    return salesOrderRuleFailure(
      'SALES_ORDER_RECONCILIATION_CONDITIONS_NOT_MET',
      '进入待对账前订单必须已签收且已付清',
    )
  }
  if (to === 'COMPLETED' && !signedAndPaid) {
    return salesOrderRuleFailure(
      'SALES_ORDER_COMPLETION_CONDITIONS_NOT_MET',
      '完成订单前必须重新确认订单已签收且已付清',
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
