import type {
  PurchaseOrderDetailDto,
  PurchaseOrderFulfillmentStatusRequestDto,
  PurchaseOrderImageDraftDto,
  PurchaseOrderPaymentDto,
  PurchaseOrderPaymentRequestDto,
  PurchaseOrderPaymentVoidRequestDto,
  PurchaseOrderReviewRequestDto,
} from '../../../api/generated/types.gen'

import Decimal from 'decimal.js'

import { nextPurchaseOrderFulfillmentStatus } from './purchase-order-list.logic'

export interface PurchaseOrderPaymentDraft {
  readonly amount: string | null
  readonly recipientAccountId: string
  readonly recipientProfileVersion: number
  readonly mediaAssetId: string | null
  readonly now: Date
  readonly outstandingAmount: string
  readonly paidAtLocal: string
  readonly paymentMethod: string
  readonly paymentType: PurchaseOrderPaymentRequestDto['paymentType']
  readonly remark: string
}

export type PurchaseOrderPaymentBuildResult
  = | {
    readonly valid: true
    readonly request: PurchaseOrderPaymentRequestDto
  }
  | {
    readonly valid: false
    readonly fieldErrors: Readonly<Record<string, string>>
  }

export type PurchaseOrderMutationBuildResult<T>
  = | { readonly valid: true, readonly request: T }
    | { readonly valid: false, readonly fieldError: string }

const USER_AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u

function codePointLength(value: string): number {
  return Array.from(value).length
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim().normalize('NFKC')
  return normalized === '' ? null : normalized
}

function normalizeAmount(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const match = USER_AMOUNT_PATTERN.exec(value.trim())
  if (match === null) {
    return null
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`
}

function optionalReason(
  value: string,
): { readonly ok: true, readonly value: string | null }
  | { readonly ok: false } {
  const normalized = normalizeOptionalText(value)
  return normalized !== null && codePointLength(normalized) > 500
    ? { ok: false }
    : { ok: true, value: normalized }
}

export function formatPurchaseOrderLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('')
}

export function buildPurchaseOrderPaymentRequest(
  draft: PurchaseOrderPaymentDraft,
): PurchaseOrderPaymentBuildResult {
  const fieldErrors: Record<string, string> = {}
  const amount = normalizeAmount(draft.amount)
  if (amount === null || new Decimal(amount).lessThanOrEqualTo(0)) {
    fieldErrors.amount = '付款金额必须大于 0 且最多保留两位小数'
  }
  else {
    try {
      if (new Decimal(amount).greaterThan(new Decimal(draft.outstandingAmount))) {
        fieldErrors.amount = `付款金额不能超过未付金额 ${draft.outstandingAmount}`
      }
    }
    catch {
      fieldErrors.amount = '当前未付金额不可用，请刷新详情后重试'
    }
  }

  const localDate = LOCAL_DATE_TIME_PATTERN.test(draft.paidAtLocal)
    ? new Date(draft.paidAtLocal)
    : new Date(Number.NaN)
  if (
    !Number.isFinite(localDate.getTime())
    || localDate.getTime() > draft.now.getTime()
  ) {
    fieldErrors.paidAt = '付款时间不能为空且不能晚于当前时间'
  }

  const paymentMethod = draft.paymentMethod.trim().normalize('NFKC')
  if (paymentMethod === '' || codePointLength(paymentMethod) > 64) {
    fieldErrors.paymentMethod = '请选择付款方式'
  }
  const remark = normalizeOptionalText(draft.remark)
  if (remark !== null && codePointLength(remark) > 500) {
    fieldErrors.remark = '付款备注最多 500 个字符'
  }
  if (!UUID_V4_PATTERN.test(draft.recipientAccountId) || !Number.isSafeInteger(draft.recipientProfileVersion) || draft.recipientProfileVersion < 1) {
    fieldErrors.recipientAccountId = '收款资料当前不可用，请重新核对'
  }
  if (draft.mediaAssetId === null || !UUID_V4_PATTERN.test(draft.mediaAssetId)) {
    fieldErrors.voucher = '付款凭证当前不可用，请重新上传'
  }
  if (Object.keys(fieldErrors).length > 0 || amount === null) {
    return { fieldErrors: Object.freeze(fieldErrors), valid: false }
  }

  return {
    request: {
      amount,
      paidAt: localDate.toISOString(),
      paymentMethod,
      paymentType: draft.paymentType,
      remark,
      recipientAccountId: draft.recipientAccountId,
      recipientProfileVersion: draft.recipientProfileVersion,
      voucher: { mediaAssetId: draft.mediaAssetId! },
    },
    valid: true,
  }
}

export function buildPurchaseOrderFulfillmentRequest(
  detail: PurchaseOrderDetailDto,
  toStatus: PurchaseOrderFulfillmentStatusRequestDto['toStatus'],
  reason: string,
): PurchaseOrderMutationBuildResult<PurchaseOrderFulfillmentStatusRequestDto> {
  if (nextPurchaseOrderFulfillmentStatus(detail) !== toStatus) {
    return { fieldError: '履约状态只能按当前顺序推进一步', valid: false }
  }
  const normalizedReason = optionalReason(reason)
  if (!normalizedReason.ok) {
    return { fieldError: '履约说明最多 500 个字符', valid: false }
  }
  return {
    request: {
      toStatus,
      ...(normalizedReason.value === null ? {} : { reason: normalizedReason.value }),
    },
    valid: true,
  }
}

/** 审核必须使用用户刚核对的详情版本，失败后重新读取才能再次确认。 */
export function buildPurchaseOrderReviewRequest(
  detail: Pick<PurchaseOrderDetailDto, 'id' | 'orderStatus' | 'version'>,
  reason: string,
  imageDraft: Pick<PurchaseOrderImageDraftDto, 'id' | 'purchaseOrderId' | 'orderVersion' | 'isCurrent'> | null,
): PurchaseOrderMutationBuildResult<PurchaseOrderReviewRequestDto> {
  if (detail.orderStatus !== 'PENDING_REVIEW') {
    return { valid: false, fieldError: '采购订单已不处于审核中，请刷新列表' }
  }
  if (!Number.isSafeInteger(detail.version) || detail.version < 1) {
    return { valid: false, fieldError: '当前订单版本不可用，请重新加载详情' }
  }
  if (!imageDraft?.id || !imageDraft.isCurrent || imageDraft.purchaseOrderId !== detail.id || imageDraft.orderVersion !== detail.version) {
    return { valid: false, fieldError: '请先生成当前采购订单的图片并核对后再确认审核' }
  }
  const normalizedReason = optionalReason(reason)
  if (!normalizedReason.ok) {
    return { valid: false, fieldError: '审核说明最多 500 个字符' }
  }
  return {
    valid: true,
    request: {
      expectedVersion: detail.version,
      imageDraftId: imageDraft.id,
      ...(normalizedReason.value === null ? {} : { reason: normalizedReason.value }),
    },
  }
}

export function buildPurchaseOrderPaymentVoidRequest(
  reason: string,
): PurchaseOrderMutationBuildResult<PurchaseOrderPaymentVoidRequestDto> {
  const normalized = normalizeOptionalText(reason)
  if (normalized === null) {
    return { fieldError: '请填写付款作废原因', valid: false }
  }
  if (codePointLength(normalized) > 500) {
    return { fieldError: '付款作废原因最多 500 个字符', valid: false }
  }
  return { request: { reason: normalized }, valid: true }
}

export function purchaseOrderPaymentTypeLabel(
  value: PurchaseOrderPaymentDto['paymentType'],
): string {
  return {
    BALANCE: '尾款',
    DEPOSIT: '定金',
    OTHER: '其他',
  }[value]
}

export function purchaseOrderStatusDimensionLabel(value: string): string {
  return {
    FULFILLMENT: '履约状态',
    ORDER: '订单状态',
    PAYMENT: '付款状态',
  }[value] ?? value
}

export function purchaseOrderStatusHistoryValueLabel(value: string): string {
  return {
    CANCELLED: '已取消',
    COMPLETED: '已完成',
    CONFIRMED: '已确认',
    PENDING_REVIEW: '采购审核中',
    ORDERED: '已下单',
    PAID: '已付清',
    PARTIALLY_PAID: '部分付款',
    PREPARING: '备货中',
    PARTIALLY_SHIPPED: '部分发货',
    SHIPPED: '已发货',
    SIGNED: '已签收',
    UNPAID: '未付款',
  }[value] ?? value
}
