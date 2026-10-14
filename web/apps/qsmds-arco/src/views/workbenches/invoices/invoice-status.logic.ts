import type { InvoiceRequestDto, InvoiceRequestListItemDto } from '@/api/generated/types.gen'

/**
 * 开票申请的状态与时间口径：状态标签色、可结算倒计时与文案键都在这里集中，
 * 页面不再各自拼状态字符串。状态文案走 `invoiceRequest.status.<枚举值>`。
 */

export type InvoiceRequestStatusValue = InvoiceRequestListItemDto['status']

export const INVOICE_REQUEST_STATUSES: readonly InvoiceRequestStatusValue[] = [
  'PENDING_REVIEW',
  'RETURNED',
  'NOTIFIED',
  'ISSUED',
  'SETTLED',
  'CANCELLED',
] as const

/** 结算等待期：与后端常量一致（自发票照片上传起满 120 小时）。 */
export const INVOICE_SETTLE_WAIT_HOURS = 120

export function statusTextKey(status: InvoiceRequestStatusValue): string {
  return `invoiceRequest.status.${status}`
}

export function statusSwitchItems(): { value: InvoiceRequestStatusValue | 'ALL', labelKey: string }[] {
  return [
    { value: 'ALL', labelKey: 'invoiceRequest.statusAll' },
    ...INVOICE_REQUEST_STATUSES.map(status => ({ value: status, labelKey: statusTextKey(status) })),
  ]
}

/**
 * 状态标签色：待处理（审核中/已通知）用 amber、进行中（已开出邮寄）与已完成（已结算入账）用 primary、
 * 已退回与已取消用 destructive / muted。与既有销售收款页的语义一致。
 */
export function statusTagClass(status: InvoiceRequestStatusValue): string {
  switch (status) {
    case 'PENDING_REVIEW':
    case 'NOTIFIED':
      return 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300'
    case 'ISSUED':
    case 'SETTLED':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'RETURNED':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
  }
}

/** 上传时间在 DTO 里是可空字段（历史/未上传都可能是 null 或缺失），统一按「没有照片」处理。 */
export type InvoiceUploadedAt = string | null | undefined

export function resolveSettleableAt(documentUploadedAt: InvoiceUploadedAt): Date | null {
  if (documentUploadedAt === null || documentUploadedAt === undefined) {
    return null
  }
  return new Date(new Date(documentUploadedAt).getTime() + INVOICE_SETTLE_WAIT_HOURS * 3_600_000)
}

export function isSettleable(documentUploadedAt: InvoiceUploadedAt, now: Date): boolean {
  const settleableAt = resolveSettleableAt(documentUploadedAt)
  return settleableAt !== null && now.getTime() >= settleableAt.getTime()
}

/** 距离可结算还剩多久；已满或没有照片都返回 null（调用方按 isSettleable 分支）。 */
export function resolveSettleRemaining(documentUploadedAt: InvoiceUploadedAt, now: Date): { hours: number, minutes: number } | null {
  const settleableAt = resolveSettleableAt(documentUploadedAt)
  if (settleableAt === null || now.getTime() >= settleableAt.getTime()) {
    return null
  }
  const remainingMs = settleableAt.getTime() - now.getTime()
  return {
    hours: Math.floor(remainingMs / 3_600_000),
    minutes: Math.floor((remainingMs % 3_600_000) / 60_000),
  }
}

export interface InvoiceDuplicateSuspect {
  readonly invoiceNo: string
  readonly status: InvoiceRequestStatusValue
  readonly submittedAt: string
}

/** 409 的 fieldErrors.duplicateSuspects 是「单号 ｜ 状态 ｜ 日期」字符串，这里解析回结构化。 */
export function parseDuplicateSuspects(fieldErrors: unknown): InvoiceDuplicateSuspect[] {
  if (typeof fieldErrors !== 'object' || fieldErrors === null) {
    return []
  }
  const raw = Reflect.get(fieldErrors, 'duplicateSuspects')
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry): InvoiceDuplicateSuspect[] => {
    if (typeof entry !== 'string') {
      return []
    }
    const [invoiceNo, status, submittedAt] = entry.split(' ｜ ')
    if (invoiceNo === undefined || status === undefined || submittedAt === undefined) {
      return []
    }
    return [{ invoiceNo, status: status as InvoiceRequestStatusValue, submittedAt }]
  })
}

/**
 * 复制给代开票方的开票信息文本：与弹窗展示同源、缺值留空，
 * 只含发票备注——申请单备注是内部信息，不发出去。
 */
export function buildInvoiceCopyText(request: Pick<InvoiceRequestDto, 'buyerName' | 'buyerTaxId' | 'lines' | 'salesAmount' | 'taxAmount' | 'totalAmount' | 'invoiceRemark' | 'recipientName' | 'recipientPhone' | 'recipientAddress'>): string {
  const lines = request.lines.map(line => [
    line.productName,
    line.quantity,
    line.unitPrice,
    line.amount,
  ].join('\t')).join('\n')
  return [
    `抬头：${request.buyerName}`,
    `统编：${request.buyerTaxId}`,
    '明细：',
    lines,
    `销售额合计：${request.salesAmount}`,
    `营业税：${request.taxAmount}`,
    `总计：${request.totalAmount}`,
    `发票备注：${request.invoiceRemark ?? ''}`,
    `寄送：${[request.recipientName, request.recipientPhone, request.recipientAddress].join(' / ')}`,
  ].join('\n')
}
