import type {
  SalesOrderDeliveryReceiptRequestDto,
  SalesOrderPaymentRequestDto,
} from '@/api/generated/types.gen'

import { validateMoneyString } from '@/components/base/MoneyInput/logic'

export type SalesOrderRecordsKind = 'payments' | 'documents' | 'changes'
export type SalesOrderRecordsInitialAction = 'payment' | 'receipt' | null
export type SalesOrderModalView = 'records' | 'create-payment' | 'create-receipt'
export type SalesOrderModalOrigin = 'records' | 'table-action'

export interface SalesOrderModalState {
  readonly origin: SalesOrderModalOrigin
  readonly view: SalesOrderModalView
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

/** datetime-local 没有时区；提交时按浏览器本地时区解释并统一为服务端要求的 UTC ISO。 */
export function toSalesOrderPaymentReceivedAt(
  value: string,
  now: Date = new Date(),
): string | null {
  const parsed = new Date(value)
  return value.trim() !== ''
    && Number.isFinite(parsed.getTime())
    && parsed.getTime() <= now.getTime()
    ? parsed.toISOString()
    : null
}

export function formatSalesOrderLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
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
