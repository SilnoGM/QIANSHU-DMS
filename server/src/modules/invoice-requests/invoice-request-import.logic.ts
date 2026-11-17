import { calculateTaxAmount, sumLineAmounts } from './invoice-request.logic'

/**
 * 代导入的纯计算与校验：金额复算、票面覆盖、时间口径、幂等键。
 *
 * 这里不碰数据库也不抛 HTTP 异常：数据库写入与错误码映射在
 * `invoice-request-import.service.ts`，本文件只回答「这一条能否落库、落库后是什么形状」。
 */

/** 单批条数上限：逐条独立事务，上限用来约束一次请求的耗时与失败面。 */
export const INVOICE_REQUEST_IMPORT_ITEM_LIMIT = 200

/** 导入只能落在这两个状态：审核中意味着「还没交给代开票方」，不在历史回填范围内。 */
export type InvoiceRequestImportTargetStatus = 'NOTIFIED' | 'ISSUED'

export interface InvoiceRequestImportLineInput {
  readonly productName: string
  readonly quantity: number
  readonly unitPrice: string
}

export interface InvoiceRequestImportExpectedInput {
  readonly salesAmount: string
  readonly taxAmount: string
  readonly totalAmount: string
}

export interface InvoiceRequestImportOccurredAtInput {
  readonly submittedAt?: string | null
  readonly notifiedAt?: string | null
  readonly documentUploadedAt?: string | null
}

export interface InvoiceRequestImportItemInput {
  readonly sourceRef: string
  readonly ownerUserId: string
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly invoiceRemark?: string | null
  readonly internalRemark?: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  readonly recipientAddress: string
  readonly lines: readonly InvoiceRequestImportLineInput[]
  readonly expected?: InvoiceRequestImportExpectedInput | null
  readonly taxAmountOverride?: string | null
  readonly targetStatus: InvoiceRequestImportTargetStatus
  readonly occurredAt?: InvoiceRequestImportOccurredAtInput | null
  readonly documentMediaAssetId?: string | null
}

export interface InvoiceRequestImportLinePlan {
  readonly productName: string
  readonly quantity: number
  readonly unitPrice: bigint
  readonly amount: bigint
}

export interface InvoiceRequestImportItemPlan {
  readonly sourceRef: string
  readonly ownerUserId: string
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly invoiceRemark: string | null
  readonly internalRemark: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  readonly recipientAddress: string
  readonly lines: readonly InvoiceRequestImportLinePlan[]
  readonly salesAmount: bigint
  readonly taxAmount: bigint
  readonly totalAmount: bigint
  /** 票面税额由覆盖值决定（与 5% 四舍五入不同）时为 true，用于响应与审计。 */
  readonly taxOverridden: boolean
  /** 5% 四舍五入本应得到的税额；未覆盖时等于 taxAmount。 */
  readonly computedTaxAmount: bigint
  readonly targetStatus: InvoiceRequestImportTargetStatus
  readonly documentMediaAssetId: string | null
  readonly submittedAt: Date
  readonly notifiedAt: Date | null
  readonly documentUploadedAt: Date | null
}

/** 导入条目的稳定失败码；服务层把它翻译成 HTTP 错误码。 */
export const INVOICE_REQUEST_IMPORT_ITEM_ERROR = {
  INVALID: 'INVOICE_REQUEST_IMPORT_ITEM_INVALID',
  AMOUNT_MISMATCH: 'INVOICE_REQUEST_IMPORT_AMOUNT_MISMATCH',
  DOCUMENT_REQUIRED: 'INVOICE_REQUEST_IMPORT_DOCUMENT_REQUIRED',
  DATE_INVALID: 'INVOICE_REQUEST_IMPORT_DATE_INVALID',
} as const

export class InvoiceRequestImportItemError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'InvoiceRequestImportItemError'
  }
}

/**
 * 合计值的结构性空洞：销售额每 +1，合计只能 +1 或 +2，因此 `21k + 10` 永远取不到。
 * 这类票面只能靠 `taxAmountOverride` 保真，预检报告要把它们单独挑出来。
 */
export function isUnreachableTotalAmount(totalAmount: bigint): boolean {
  return totalAmount % 21n === 10n
}

/** 幂等键：同一批次同一行重放必须落到同一张单，因此键只由 batchRef + sourceRef 决定。 */
export function buildInvoiceRequestImportKey(batchRef: string, sourceRef: string): string {
  return ['import:', batchRef, ':', sourceRef].join('')
}

function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, [label, '不能为空'].join(''))
  }
  return trimmed
}

function parseAmount(value: string, label: string): bigint {
  if (!/^\d{1,16}$/u.test(value.trim())) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, [label, '必须是非负整数'].join(''))
  }
  return BigInt(value.trim())
}

function parseOccurredAt(value: string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, [label, '不是合法的 ISO 时间'].join(''))
  }
  return parsed
}

/** 时间必须单调：申请 ≤ 通知 ≤ 上传；回填不允许写到未来。 */
function assertChronology(plan: { readonly submittedAt: Date, readonly notifiedAt: Date | null, readonly documentUploadedAt: Date | null }, now: Date): void {
  const { submittedAt, notifiedAt, documentUploadedAt } = plan
  if (submittedAt.getTime() > now.getTime()) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, '申请时间不能晚于当前时间')
  }
  if (notifiedAt !== null && notifiedAt.getTime() < submittedAt.getTime()) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, '通知时间不能早于申请时间')
  }
  if (documentUploadedAt !== null) {
    if (notifiedAt === null) {
      throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, '上传时间需要先有通知时间')
    }
    if (documentUploadedAt.getTime() < notifiedAt.getTime()) {
      throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, '上传时间不能早于通知时间')
    }
    if (documentUploadedAt.getTime() > now.getTime()) {
      throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DATE_INVALID, '上传时间不能晚于当前时间')
    }
  }
}

/**
 * 把一条导入载荷算成落库计划。
 *
 * 金额优先级：`taxAmountOverride` > 5% 四舍五入；`expected` 只用于比对，不参与计算。
 * 这样「票面保真」与「默认口径」是同一条路径上的两个显式选择，不存在隐式改数。
 */
export function planInvoiceRequestImportItem(item: InvoiceRequestImportItemInput, now: Date): InvoiceRequestImportItemPlan {
  if (item.lines.length === 0 || item.lines.length > 5) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, '明细行必须是 1–5 行')
  }
  const lines: InvoiceRequestImportLinePlan[] = item.lines.map((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000) {
      throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, ['第 ', String(index + 1), ' 行数量必须是 1–1000000 的整数'].join(''))
    }
    const unitPrice = parseAmount(line.unitPrice, ['第 ', String(index + 1), ' 行单价'].join(''))
    if (unitPrice <= 0n || unitPrice > 900_000_000_000_000n) {
      throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, ['第 ', String(index + 1), ' 行单价必须是正整数'].join(''))
    }
    return { productName: requireText(line.productName, ['第 ', String(index + 1), ' 行品名'].join('')), quantity: line.quantity, unitPrice, amount: unitPrice * BigInt(line.quantity) }
  })

  const salesAmount = sumLineAmounts(lines)
  if (salesAmount <= 0n) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, '销售额必须大于 0')
  }
  const computedTaxAmount = calculateTaxAmount(salesAmount)
  const override = item.taxAmountOverride === null || item.taxAmountOverride === undefined || item.taxAmountOverride.trim() === ''
    ? null
    : parseAmount(item.taxAmountOverride, '票面税额')
  const taxAmount = override ?? computedTaxAmount
  const totalAmount = salesAmount + taxAmount

  if (item.expected !== null && item.expected !== undefined) {
    const expectedSales = parseAmount(item.expected.salesAmount, '期望销售额')
    const expectedTax = parseAmount(item.expected.taxAmount, '期望税额')
    const expectedTotal = parseAmount(item.expected.totalAmount, '期望合计')
    if (expectedSales !== salesAmount || expectedTax !== taxAmount || expectedTotal !== totalAmount) {
      throw new InvoiceRequestImportItemError(
        INVOICE_REQUEST_IMPORT_ITEM_ERROR.AMOUNT_MISMATCH,
        [
          '金额与期望不一致：实际 销售额 ', salesAmount.toString(), ' / 税额 ', taxAmount.toString(), ' / 合计 ', totalAmount.toString(),
          '；期望 销售额 ', expectedSales.toString(), ' / 税额 ', expectedTax.toString(), ' / 合计 ', expectedTotal.toString(),
        ].join(''),
      )
    }
  }

  const documentMediaAssetId = (item.documentMediaAssetId ?? '').trim() === '' ? null : item.documentMediaAssetId!.trim()
  if (item.targetStatus === 'ISSUED' && documentMediaAssetId === null) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.DOCUMENT_REQUIRED, '目标状态是已开出邮寄时，必须提供发票照片')
  }
  if (item.targetStatus === 'NOTIFIED' && documentMediaAssetId !== null) {
    throw new InvoiceRequestImportItemError(INVOICE_REQUEST_IMPORT_ITEM_ERROR.INVALID, '目标状态是已通知开票时，不应提供发票照片')
  }

  const submittedAt = parseOccurredAt(item.occurredAt?.submittedAt, '申请时间') ?? now
  const notifiedAt = item.targetStatus === 'NOTIFIED' || item.targetStatus === 'ISSUED'
    ? parseOccurredAt(item.occurredAt?.notifiedAt, '通知时间') ?? submittedAt
    : null
  const documentUploadedAt = item.targetStatus === 'ISSUED'
    ? parseOccurredAt(item.occurredAt?.documentUploadedAt, '上传时间') ?? (notifiedAt ?? submittedAt)
    : null
  assertChronology({ submittedAt, notifiedAt, documentUploadedAt }, now)

  return {
    sourceRef: requireText(item.sourceRef, 'sourceRef'),
    ownerUserId: requireText(item.ownerUserId, 'ownerUserId'),
    buyerName: requireText(item.buyerName, '抬头'),
    buyerTaxId: requireText(item.buyerTaxId, '统编'),
    invoiceRemark: optionalText(item.invoiceRemark),
    internalRemark: optionalText(item.internalRemark),
    recipientName: requireText(item.recipientName, '收件人姓名'),
    recipientPhone: requireText(item.recipientPhone, '收件人电话'),
    recipientAddress: requireText(item.recipientAddress, '收件人地址'),
    lines,
    salesAmount,
    taxAmount,
    totalAmount,
    taxOverridden: override !== null,
    computedTaxAmount,
    targetStatus: item.targetStatus,
    documentMediaAssetId,
    submittedAt,
    notifiedAt,
    documentUploadedAt,
  }
}
