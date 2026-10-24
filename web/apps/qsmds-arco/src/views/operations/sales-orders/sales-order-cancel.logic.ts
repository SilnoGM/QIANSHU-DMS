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
export function isSalesOrderCancellable(
  input: SalesOrderCancelEligibility,
): boolean {
  return input.viewMode === 'all'
    && input.canUpdate
    && input.orderStatus === 'CONFIRMED'
    && input.fulfillmentStatus !== 'SIGNED'
    && input.paymentStatus === 'UNPAID'
    && input.activePurchaseOrderCount === 0
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
