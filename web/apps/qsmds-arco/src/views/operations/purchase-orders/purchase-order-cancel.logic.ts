import type {
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
  PurchaseOrderStatusRequestDto,
} from '../../../api/generated/types.gen'

import Decimal from 'decimal.js'

import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

type Translate = (key: string, values?: Record<string, string | number>) => string

export const PURCHASE_ORDER_CANCEL_REASON_MAX_LENGTH = 500

export type PurchaseOrderCancelBlockedReason = 'status' | 'shipped' | 'paid' | 'amount'

export interface PurchaseOrderCancelPolicy {
  /** 审核工作台只允许已通过订单；运营列表按业务要求允许审核中或已确认。 */
  readonly allowPendingReview: boolean
}

type PurchaseOrderCancelSource = Pick<
  PurchaseOrderListItemDto,
  'orderStatus' | 'fulfillmentStatus' | 'paidAmount'
>

/**
 * 取消门禁与服务端保持一致：状态、是否已发货、是否存在有效付款。
 * 返回原因码而不是文案，审核工作台和运营列表各自映射自己的提示。
 */
export function getPurchaseOrderCancelBlockedReason(
  order: PurchaseOrderCancelSource,
  policy: PurchaseOrderCancelPolicy,
): PurchaseOrderCancelBlockedReason | null {
  const statusAllowed = policy.allowPendingReview
    ? order.orderStatus === 'PENDING_REVIEW' || order.orderStatus === 'CONFIRMED'
    : order.orderStatus === 'CONFIRMED'
  if (!statusAllowed) {
    return 'status'
  }
  if (!['ORDERED', 'PREPARING'].includes(order.fulfillmentStatus)) {
    return 'shipped'
  }
  const paid = validateMoneyString(order.paidAmount, { precision: 4 })
  if (!paid.valid || paid.normalizedValue === null) {
    return 'amount'
  }
  return new Decimal(paid.normalizedValue).isZero() ? null : 'paid'
}

export function isPurchaseOrderCancellable(
  order: PurchaseOrderCancelSource,
  policy: PurchaseOrderCancelPolicy,
): boolean {
  return getPurchaseOrderCancelBlockedReason(order, policy) === null
}

/** 运营列表和弹窗共用同一套阻塞提示，避免按钮与弹窗口径不一致。 */
export function purchaseOrderCancelBlockedMessage(
  reason: PurchaseOrderCancelBlockedReason,
): string {
  return {
    status: '只有审核中或已确认的采购单可以取消',
    shipped: '采购单已有货件发出，不能整单取消',
    paid: '采购单已有有效付款，请先作废付款后再取消',
    amount: '付款金额不可用，请刷新后重试',
  }[reason]
}

export type PurchaseOrderCancelRequestBuildResult
  = | {
    readonly valid: true
    readonly request: PurchaseOrderStatusRequestDto
  }
  | {
    readonly valid: false
    readonly fieldError: string
  }

/**
 * 取消原因在界面层必填：服务端允许为空，但状态历史是唯一保留理由的地方。
 * 规范化口径与服务端一致（trim + NFKC），长度按 Unicode code point 计算。
 */
export function buildPurchaseOrderCancelRequest(
  reason: string,
): PurchaseOrderCancelRequestBuildResult {
  const normalized = reason.trim().normalize('NFKC')
  if (normalized.length === 0) {
    return { valid: false, fieldError: '请填写取消原因' }
  }
  if ([...normalized].length > PURCHASE_ORDER_CANCEL_REASON_MAX_LENGTH) {
    return {
      valid: false,
      fieldError: `取消原因最多 ${PURCHASE_ORDER_CANCEL_REASON_MAX_LENGTH} 个字符`,
    }
  }
  return {
    valid: true,
    request: { toStatus: 'CANCELLED', reason: normalized },
  }
}

/**
 * 采购取消通知由审核工作台和运营列表共用；产品按行号升序，金额由服务端汇总后只做展示格式化。
 * 模板键沿用采购审核命名空间，保证两个入口复制出的文本完全一致。
 */
export function buildPurchaseCancellationText(
  detail: PurchaseOrderDetailDto,
  t: Translate,
): string {
  const text = (value: string | null | undefined) => value?.trim().replace(/\s+/gu, ' ') || t('purchaseReview.copy.notRecorded')
  const money = (value: string) => {
    const result = validateMoneyString(value, { precision: 4 })
    return result.valid && result.normalizedValue !== null
      ? new Decimal(result.normalizedValue).toFixed(2, Decimal.ROUND_HALF_UP)
      : t('purchaseReview.copy.notRecorded')
  }
  return [
    t('purchaseReview.cancellation.copyHeader', { orderNo: text(detail.orderNo), supplier: text(detail.supplier.label), orderDate: text(detail.orderDate) }),
    t('purchaseReview.cancellation.copyProducts', { products: [...detail.lines].sort((a, b) => a.lineNumber - b.lineNumber).map(line => text(line.productName)).join('+') || t('purchaseReview.detail.noProducts') }),
    // 复制服务端实际已付和未付汇总，不用约定定金、尾款替代，也不以浮点数重新计算。
    t('purchaseReview.cancellation.copyAmounts', { total: money(detail.amounts.purchaseTotalAmount), paid: money(detail.amounts.paidAmount), unpaid: money(detail.amounts.outstandingAmount) }),
  ].join('\n\n')
}
