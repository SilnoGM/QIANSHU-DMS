import type {
  SalesOrderListItemDto,
  SalesOrderStatusRequestDto,
} from '../../../api/generated/types.gen'

export const SALES_ORDER_CANCEL_REASON_MAX_LENGTH = 500

export interface SalesOrderCancelEligibility {
  readonly viewMode: 'all' | 'pending'
  readonly canUpdate: boolean
  readonly orderStatus: SalesOrderListItemDto['orderStatus']
  readonly fulfillmentStatus: SalesOrderListItemDto['fulfillmentStatus']
  readonly paymentStatus: SalesOrderListItemDto['paymentStatus']
  readonly activePurchaseOrderCount: number
}

/**
 * 取消入口只出现在「全部订单」：待办页按履约/收款动作组织，不混入终态操作。
 * 这里与服务端取消门禁保持同口径；待审核收款申请等并发事实仍以服务端错误为准。
 */
export function getSalesOrderCancelBlockedReason(
  input: SalesOrderCancelEligibility,
): string | null {
  if (input.viewMode !== 'all') {
    return '待办视图不提供取消订单入口'
  }
  if (!input.canUpdate) {
    return '当前账号无权取消订单'
  }
  if (input.orderStatus === 'CANCELLED') {
    return '订单已取消'
  }
  if (input.orderStatus === 'COMPLETED') {
    return '订单已完成，不能取消'
  }
  if (input.orderStatus === 'PENDING_RECONCILIATION') {
    return '订单已进入待对账，不能取消'
  }
  if (input.orderStatus !== 'CONFIRMED') {
    return '只有已确认订单可以取消'
  }
  if (input.fulfillmentStatus === 'SIGNED') {
    return '订单已签收，不能取消'
  }
  if (input.paymentStatus !== 'UNPAID') {
    return '订单已有收款，不能取消'
  }
  if (input.activePurchaseOrderCount > 0) {
    return `仍有 ${input.activePurchaseOrderCount} 张未取消的采购单，请先处理采购单`
  }
  return null
}

export function isSalesOrderCancellable(
  input: SalesOrderCancelEligibility,
): boolean {
  return getSalesOrderCancelBlockedReason(input) === null
}

export type SalesOrderCancelRequestBuildResult
  = | {
    readonly valid: true
    readonly request: SalesOrderStatusRequestDto
  }
  | {
    readonly valid: false
    readonly fieldError: string
  }

/**
 * 取消原因在界面层必填：服务端允许为空，但状态历史是唯一保留理由的地方。
 * 规范化口径与服务端一致（trim + NFKC），长度按 Unicode code point 计算。
 */
export function buildSalesOrderCancelRequest(
  reason: string,
): SalesOrderCancelRequestBuildResult {
  const normalized = reason.trim().normalize('NFKC')
  if (normalized.length === 0) {
    return { valid: false, fieldError: '请填写取消原因' }
  }
  if ([...normalized].length > SALES_ORDER_CANCEL_REASON_MAX_LENGTH) {
    return {
      valid: false,
      fieldError: `取消原因最多 ${SALES_ORDER_CANCEL_REASON_MAX_LENGTH} 个字符`,
    }
  }
  return {
    valid: true,
    request: { toStatus: 'CANCELLED', reason: normalized },
  }
}
