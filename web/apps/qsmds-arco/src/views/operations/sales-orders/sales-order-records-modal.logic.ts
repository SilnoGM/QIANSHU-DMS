import type {
  SalesOrderDeliveryReceiptRequestDto,
  SalesOrderPaymentRequestDto,
  SalesReceiptStatusCountsDto,
} from '@/api/generated/types.gen'

import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export type SalesOrderRecordsKind = 'payments' | 'documents' | 'changes'
export type SalesOrderReceiptTab = 'payments' | 'requests'
export type SalesOrderRecordsInitialAction = 'payment' | 'receipt' | null
export type SalesOrderModalView = 'records' | 'create-payment' | 'create-receipt'
export type SalesOrderModalOrigin = 'records' | 'table-action'
export type SalesOrderPaymentStatusReasonTone
  = 'default' | 'outstanding' | 'received'

export interface SalesOrderPaymentStatusReasonSegment {
  readonly text: string
  readonly tone: SalesOrderPaymentStatusReasonTone
}

/**
 * 只拆分服务端生成的实际收款原因模板。手工原因或历史原因必须完整回退为普通文本，
 * 避免仅凭金额外观误把用户输入染色。
 */
export function splitSalesOrderPaymentStatusReason(
  reason: string,
): readonly SalesOrderPaymentStatusReasonSegment[] {
  const matched = reason.match(
    /^用户添加实际收款 (.+?)，剩余 (.+?)( 未收|，订单已付清)$/u,
  )
  if (matched === null) {
    return [{ text: reason, tone: 'default' }]
  }
  const [, receivedAmount, outstandingAmount, suffix] = matched
  if (
    receivedAmount === undefined
    || outstandingAmount === undefined
    || suffix === undefined
  ) {
    return [{ text: reason, tone: 'default' }]
  }
  return [
    { text: '用户添加实际收款 ', tone: 'default' },
    { text: receivedAmount, tone: 'received' },
    { text: '，剩余 ', tone: 'default' },
    { text: outstandingAmount, tone: 'outstanding' },
    { text: suffix, tone: 'default' },
  ]
}

export interface SalesOrderModalState {
  readonly origin: SalesOrderModalOrigin
  readonly view: SalesOrderModalView
}

/** 实际收款列表同时包含已作废记录；有效笔数按与列表标签相同的 voidedAt 判据统计。 */
export function countValidSalesOrderPayments(
  payments: readonly { readonly voidedAt: string | null }[],
): number {
  return payments.filter(payment => payment.voidedAt === null).length
}

export function countPendingReceiptRequests(
  counts: SalesReceiptStatusCountsDto,
): number {
  return counts.PENDING_REVIEW
}

export function countTotalReceiptRequests(
  counts: SalesReceiptStatusCountsDto,
): number {
  return counts.PENDING_REVIEW
    + counts.APPROVED
    + counts.REJECTED
    + counts.VOIDED
}

/** 表格快捷操作直接进入表单视图，避免先渲染记录弹窗再切换造成闪屏。 */
export function resolveSalesOrderModalInitialState(
  initialAction: SalesOrderRecordsInitialAction,
): SalesOrderModalState {
  if (initialAction === 'payment') {
    return { origin: 'table-action', view: 'create-payment' }
  }
  if (initialAction === 'receipt') {
    return { origin: 'table-action', view: 'create-receipt' }
  }
  return { origin: 'records', view: 'records' }
}

/** 记录弹窗内发起的操作取消后返回记录；表格快捷操作取消后关闭宿主弹窗。 */
export function resolveSalesOrderModalCancelAction(
  state: SalesOrderModalState,
): 'close' | 'records' {
  return state.origin === 'records' && state.view !== 'records'
    ? 'records'
    : 'close'
}

export interface SalesOrderPaymentDraft {
  readonly amount: null | string
  readonly paymentMethod: string
  readonly paymentType: SalesOrderPaymentRequestDto['paymentType']
  readonly receivedAt: string
  readonly remark: string
  readonly voucherMediaAssetId: null | string
}

export type SalesOrderPaymentDraftErrors = Readonly<Record<string, string>>

export type BuildSalesOrderPaymentRequestResult
  = | { readonly valid: true, readonly request: SalesOrderPaymentRequestDto }
    | { readonly valid: false, readonly fieldErrors: SalesOrderPaymentDraftErrors }

export type BuildSalesOrderDeliveryReceiptRequestResult
  = | { readonly valid: true, readonly request: SalesOrderDeliveryReceiptRequestDto }
    | { readonly valid: false, readonly fieldErrors: SalesOrderPaymentDraftErrors }

const PAYMENT_TYPES = new Set<SalesOrderPaymentRequestDto['paymentType']>([
  'DEPOSIT',
  'PROGRESS',
  'INVOICE_TAX',
  'BALANCE',
  'OTHER',
])
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function normalizedOptionalText(value: string, maximum: number): string | null {
  const normalized = value.trim().normalize('NFKC')
  return normalized === '' || [...normalized].length > maximum ? null : normalized
}

/** 字段组件输出的 UTC ISO；只接受规范化 ISO 且不晚于当前时间。 */
export function toSalesOrderPaymentReceivedAt(
  value: string,
  now: Date = new Date(),
): string | null {
  if (value.trim() === '') {
    return null
  }
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString() === value
    && parsed.getTime() <= now.getTime()
    ? value
    : null
}

export function buildSalesOrderPaymentRequest(
  draft: SalesOrderPaymentDraft,
  precision: number,
  now: Date = new Date(),
): BuildSalesOrderPaymentRequestResult {
  const fieldErrors: Record<string, string> = {}
  if (!PAYMENT_TYPES.has(draft.paymentType)) {
    fieldErrors.paymentType = '请选择收款类型'
  }
  const minimumAmount = precision === 0 ? '1' : `0.${'0'.repeat(precision - 1)}1`
  const amountResult = validateMoneyString(draft.amount, {
    min: minimumAmount,
    precision,
  })
  if (!amountResult.valid || amountResult.normalizedValue === null) {
    fieldErrors.amount = amountResult.valid ? '请输入收款金额' : amountResult.message
  }
  const receivedAt = toSalesOrderPaymentReceivedAt(draft.receivedAt, now)
  if (receivedAt === null) {
    fieldErrors.receivedAt = '请选择不晚于当前时间的有效收款时间'
  }
  const paymentMethod = normalizedOptionalText(draft.paymentMethod, 64)
  if (paymentMethod === null) {
    fieldErrors.paymentMethod = draft.paymentMethod.trim() === ''
      ? '请选择收款方式'
      : '收款方式最多 64 个字符'
  }
  const remark = normalizedOptionalText(draft.remark, 500)
  if (draft.remark.trim() !== '' && remark === null) {
    fieldErrors.remark = '备注最多 500 个字符'
  }
  if (
    draft.voucherMediaAssetId === null
    || !UUID_V4_PATTERN.test(draft.voucherMediaAssetId)
  ) {
    fieldErrors.voucher = '每笔收款必须上传且只能上传一份凭证'
  }

  if (Object.keys(fieldErrors).length > 0 || paymentMethod === null) {
    return { valid: false, fieldErrors }
  }
  return {
    valid: true,
    request: {
      amount: amountResult.normalizedValue as string,
      paymentMethod,
      paymentType: draft.paymentType,
      receivedAt: receivedAt as string,
      remark,
      voucher: { mediaAssetId: draft.voucherMediaAssetId as string },
    },
  }
}

export function buildSalesOrderDeliveryReceiptRequest(
  mediaAssetId: null | string,
  remark: string,
): BuildSalesOrderDeliveryReceiptRequestResult {
  const fieldErrors: Record<string, string> = {}
  if (mediaAssetId === null || !UUID_V4_PATTERN.test(mediaAssetId)) {
    fieldErrors.receipt = '货物签收必须上传且只能上传一份签收单'
  }
  const normalizedRemark = normalizedOptionalText(remark, 500)
  if (remark.trim() !== '' && normalizedRemark === null) {
    fieldErrors.remark = '备注最多 500 个字符'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, fieldErrors }
  }
  return {
    valid: true,
    request: {
      mediaAssetId: mediaAssetId as string,
      remark: normalizedRemark,
    },
  }
}
