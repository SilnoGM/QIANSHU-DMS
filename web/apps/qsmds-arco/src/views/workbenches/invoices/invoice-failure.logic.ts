/**
 * 开票申请的错误码 → 文案键映射：服务端拒绝的原因要能直接讲清楚，其余给通用提示。
 */

const INVOICE_FAILURE_KEYS: Readonly<Record<string, string>> = {
  FORBIDDEN: 'invoiceRequest.error.forbidden',
  INVOICE_REQUEST_NOT_FOUND: 'invoiceRequest.error.notFound',
  INVOICE_REQUEST_STATE_CHANGED: 'invoiceRequest.error.stateChanged',
  INVOICE_REQUEST_STATUS_NOT_ALLOWED: 'invoiceRequest.error.statusNotAllowed',
  INVOICE_REQUEST_OWNER_ONLY: 'invoiceRequest.error.ownerOnly',
  INVOICE_REQUEST_DUPLICATE_SUSPECTED: 'invoiceRequest.error.duplicate',
  INVOICE_REQUEST_SETTLE_WAIT_PERIOD: 'invoiceRequest.error.settleWait',
  INVOICE_REQUEST_DOCUMENT_REQUIRED: 'invoiceRequest.error.documentRequired',
  INVOICE_REQUEST_DOCUMENT_EXISTS: 'invoiceRequest.error.documentExists',
  INVOICE_REQUEST_DOCUMENT_INVALID: 'invoiceRequest.error.documentInvalid',
  INVOICE_REQUEST_DOCUMENT_TOO_LARGE: 'invoiceRequest.error.documentTooLarge',
  INVOICE_REQUEST_DOCUMENT_UNAVAILABLE: 'invoiceRequest.error.documentUnavailable',
  INVOICE_REQUEST_RATE_UNAVAILABLE: 'invoiceRequest.error.rateUnavailable',
  INVOICE_REQUEST_RATE_CHANGED: 'invoiceRequest.error.rateChanged',
  INVOICE_REQUEST_NUMBER_UNAVAILABLE: 'invoiceRequest.error.numberUnavailable',
  INVOICE_REQUEST_CONFLICT: 'invoiceRequest.error.conflict',
  INVOICE_REQUEST_POSTING_ACCOUNT_UNAVAILABLE: 'invoiceRequest.error.accountUnavailable',
  INVOICE_REQUEST_POSTING_UNAVAILABLE: 'invoiceRequest.error.postingUnavailable',
  VALIDATION_FAILED: 'invoiceRequest.error.validation',
  MEDIA_STORAGE_UNAVAILABLE: 'invoiceRequest.error.storage',
}

const INVOICE_FAILURE_FALLBACK_KEY = 'invoiceRequest.error.unknown'

export function resolveInvoiceFailureKey(error: unknown): string {
  const code = (error as { body?: { code?: unknown } } | null)?.body?.code
  if (typeof code !== 'string') {
    return INVOICE_FAILURE_FALLBACK_KEY
  }
  return INVOICE_FAILURE_KEYS[code] ?? INVOICE_FAILURE_FALLBACK_KEY
}

/** 提交撞上四项比对的 409：把相似单列表取出来给弹窗渲染。 */
export function resolveDuplicateFieldErrors(error: unknown): unknown {
  return (error as { body?: { fieldErrors?: unknown } } | null)?.body?.fieldErrors
}
