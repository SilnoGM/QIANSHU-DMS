import {
  PURCHASE_AUTO_REVIEW_MAX_ATTEMPTS,
  PURCHASE_AUTO_REVIEW_RETRY_DELAYS_MS,
} from './purchase-auto-review.constants'

export type PurchaseAutoReviewFailureKind = 'RETRYABLE' | 'TERMINAL'

/**
 * 无法通过重试恢复的错误码：配置缺失可由管理员补充，存储/编号/版本冲突则重试有意义。
 * 未知错误码一律按可重试处理，避免把暂时性故障直接丢给人工。
 */
const TERMINAL_FAILURE_CODES = new Set<string>([
  'PURCHASE_ORDER_NOT_FOUND',
  'PURCHASE_ORDER_IMAGE_TOO_LARGE',
  'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED',
  'PURCHASE_ORDER_IMAGE_REQUIRED',
  'PURCHASE_ORDER_IMAGE_NOT_ALLOWED',
  'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS',
  'VALIDATION_FAILED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
])

export function classifyAutoReviewFailure(
  code: string | null | undefined,
): PurchaseAutoReviewFailureKind {
  return code !== null && code !== undefined && TERMINAL_FAILURE_CODES.has(code)
    ? 'TERMINAL'
    : 'RETRYABLE'
}

/** 返回本次失败后的等待时间；次数已用尽时返回 null。 */
export function autoReviewRetryDelayMs(attempts: number): number | null {
  if (!Number.isInteger(attempts) || attempts < 1) return null
  if (attempts >= PURCHASE_AUTO_REVIEW_MAX_ATTEMPTS) return null
  return PURCHASE_AUTO_REVIEW_RETRY_DELAYS_MS[attempts - 1] ?? null
}

export interface AutoReviewOrderState {
  readonly orderStatus: string
  readonly fulfillmentStatus: string
  readonly purchaseType: string
  readonly productMode: string
  readonly shippingMarkText: string | null
  readonly shippingMarkIssuanceId: string | null
  readonly partCount: number
  readonly salesOrderStatus: string | null
  readonly hasVoucher: boolean
}

export type PurchaseAutoReviewPreflight =
  | { readonly action: 'PROCEED' }
  | { readonly action: 'DONE' }
  | { readonly action: 'CANCELLED' }
  | {
    readonly action: 'BLOCKED'
    readonly retryable: boolean
    readonly code: string
    readonly message: string
  }

const SOURCE_TERMINAL_STATUSES = new Set([
  'CANCELLED',
  'TERMINATED',
  'COMPLETED',
  'PENDING_RECONCILIATION',
])

function blocked(
  retryable: boolean,
  code: string,
  message: string,
): PurchaseAutoReviewPreflight {
  return { action: 'BLOCKED', retryable, code, message }
}

/**
 * 任务执行前的只读分诊；正式审核仍由审核事务内的版本与状态校验兜底。
 * 这里只区分「不用再做」「等人工处理」「可以继续」三种走向，避免把业务终态
 * 当作临时故障反复重试。
 */
export function classifyAutoReviewOrder(
  state: AutoReviewOrderState,
): PurchaseAutoReviewPreflight {
  if (state.orderStatus === 'CONFIRMED' || state.orderStatus === 'COMPLETED') {
    return { action: 'DONE' }
  }
  if (state.orderStatus === 'CANCELLED') return { action: 'CANCELLED' }
  if (state.orderStatus !== 'PENDING_REVIEW') {
    return blocked(false, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单已不处于待审核状态')
  }
  if (state.fulfillmentStatus !== 'ORDERED') {
    return blocked(false, 'PURCHASE_ORDER_STATE_CHANGED', '采购订单履约状态异常，需人工核实')
  }
  if (state.purchaseType === 'SALES_LINKED') {
    if (state.salesOrderStatus === null) {
      return blocked(false, 'PURCHASE_ORDER_SOURCE_ORDER_INVALID', '关联销售来源不存在，需人工处理')
    }
    if (SOURCE_TERMINAL_STATUSES.has(state.salesOrderStatus)) {
      return blocked(false, 'PURCHASE_ORDER_SOURCE_ORDER_INVALID', '关联销售订单已进入不可采购状态，需人工处理')
    }
    if (state.salesOrderStatus !== 'CONFIRMED') {
      return blocked(true, 'PURCHASE_ORDER_SOURCE_ORDER_INVALID', '关联销售订单尚未确认，等待后可重试')
    }
  }
  if (state.productMode === 'MIXED') {
    return blocked(false, 'PURCHASE_ORDER_STATE_CHANGED', '混合采购单不支持审核，需人工处理')
  }
  if (state.partCount < 1) {
    return blocked(false, 'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED', '采购货件为空，需人工核实')
  }
  if ((state.shippingMarkText === null) !== (state.shippingMarkIssuanceId === null)) {
    return blocked(false, 'PURCHASE_ORDER_STATE_CHANGED', '采购唛头状态不完整，需人工核实')
  }
  if (state.hasVoucher) {
    return blocked(false, 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS', '采购订单已有有效采购单凭证，需人工处理')
  }
  return { action: 'PROCEED' }
}
