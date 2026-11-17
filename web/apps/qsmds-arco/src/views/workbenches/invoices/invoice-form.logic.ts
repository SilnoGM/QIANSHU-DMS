/**
 * 开票申请表单的纯计算：明细行编辑、金额与营业税。
 *
 * 与后端同一口径（税率先四舍五入再相加、金额 = 数量 × 单价且不可手填），
 * 前端只做即时预览，落库值一律以服务端复算为准。
 */

export const INVOICE_TAX_RATE_PERCENT = 5
export const INVOICE_REQUEST_LINE_LIMIT = 5

export interface InvoiceFormLine {
  readonly productName: string
  /** 数量与单价在表单里保持字符串，用户输入到一半（空串）也能编辑。 */
  readonly quantity: string
  readonly unitPrice: string
}

export function emptyInvoiceFormLine(): InvoiceFormLine {
  return { productName: '', quantity: '1', unitPrice: '' }
}

export function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[1-9]\d{0,15}$/u.test(trimmed)) {
    return null
  }
  return Number(trimmed)
}

/** 营业税应税 = 四舍五入(销售额 × 5%)，与后端 same-order 整数运算。 */
export function calculateTaxAmount(salesAmount: number): number {
  return Math.floor((salesAmount * INVOICE_TAX_RATE_PERCENT + 50) / 100)
}

/**
 * 票面总计的容差（分）：`|总计 − 1.05 × 销售额|` 的上界，与后端 INVOICE_TOTAL_TOLERANCE_CENTS 一致。
 * 超过它就说明总计或单价取错了，而不是正常的四舍五入波动。
 */
export const INVOICE_TOTAL_TOLERANCE_CENTS = 50

export interface InvoiceFormTotals {
  /** 任一行不完整时为 null：合计只在能算准的时候显示，不显示「部分合计」。 */
  readonly salesAmount: number | null
  readonly taxAmount: number | null
  readonly totalAmount: number | null
  readonly lineAmounts: (number | null)[]
  /** 不填票面总计时会得到的合计，用于输入框默认值与错误提示。 */
  readonly computedTotalAmount: number | null
  /** 税额由票面总计倒推、与 5% 公式不同。 */
  readonly taxAdjusted: boolean
  /** 手填总计越界（或导致负税额）；此时金额卡回退到自动口径，由输入框标红。 */
  readonly totalInvalid: boolean
}

/**
 * 明细 → 金额。
 *
 * 不填 `totalOverride` 时维持现行口径（销售额 × 5% 再相加）；填了就以票面含税总计为准，
 * 税额取 `总计 − 销售额`，只做 0.5 元容差校验——票面本身就是「未税明细 + 营业税 + 总计」，
 * 税额是残差而不是独立计算值。
 */
export function calculateInvoiceTotals(lines: readonly InvoiceFormLine[], totalOverride = ''): InvoiceFormTotals {
  const lineAmounts = lines.map((line) => {
    const quantity = parsePositiveInteger(line.quantity)
    const unitPrice = parsePositiveInteger(line.unitPrice)
    return quantity === null || unitPrice === null ? null : quantity * unitPrice
  })
  if (lineAmounts.length === 0 || lineAmounts.includes(null)) {
    return { salesAmount: null, taxAmount: null, totalAmount: null, lineAmounts, computedTotalAmount: null, taxAdjusted: false, totalInvalid: false }
  }
  const salesAmount = (lineAmounts as number[]).reduce((total, amount) => total + amount, 0)
  const autoTaxAmount = calculateTaxAmount(salesAmount)
  const computedTotalAmount = salesAmount + autoTaxAmount
  const auto: InvoiceFormTotals = {
    salesAmount,
    taxAmount: autoTaxAmount,
    totalAmount: computedTotalAmount,
    lineAmounts,
    computedTotalAmount,
    taxAdjusted: false,
    totalInvalid: false,
  }
  const trimmed = totalOverride.trim()
  if (trimmed === '') {
    return auto
  }
  const totalAmount = parsePositiveInteger(trimmed)
  if (totalAmount === null) {
    return { ...auto, totalInvalid: true }
  }
  const appliedTaxAmount = totalAmount - salesAmount
  const deviationCents = Math.abs(totalAmount * 100 - salesAmount * 105)
  if (appliedTaxAmount < 0 || deviationCents > INVOICE_TOTAL_TOLERANCE_CENTS) {
    return { ...auto, totalInvalid: true }
  }
  return {
    salesAmount,
    taxAmount: appliedTaxAmount,
    totalAmount,
    lineAmounts,
    computedTotalAmount,
    taxAdjusted: appliedTaxAmount !== autoTaxAmount,
    totalInvalid: false,
  }
}

/** 明细行金额展示文本：千分位分组（与 AmountDisplay 的整数分组口径一致）；行不完整时用「—」。 */
export function formatLineAmount(value: number | null): string {
  return value === null ? '—' : String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

export interface InvoiceSubmitPayload {
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly invoiceRemark: string | null
  readonly internalRemark: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  readonly recipientAddress: string
  readonly lines: { productName: string, quantity: number, unitPrice: string }[]
  /** 票面含税总计；留空表示按 5% 自动计算（与后端可选字段一致）。 */
  readonly totalAmount?: string
}

/** 表单 → 提交载荷：先按可读顺序校验，返回第一条不满足的字段名（供表单高亮）。 */
export function buildInvoiceSubmitPayload(input: {
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly invoiceRemark: string
  readonly internalRemark: string
  readonly recipientName: string
  readonly recipientPhone: string
  readonly recipientAddress: string
  readonly lines: readonly InvoiceFormLine[]
  readonly totalAmount: string
}): { payload: InvoiceSubmitPayload } | { invalidField: string } {
  const buyerName = input.buyerName.trim()
  if (buyerName === '') {
    return { invalidField: 'buyerName' }
  }
  const buyerTaxId = input.buyerTaxId.trim()
  if (!/^\d{8}$/u.test(buyerTaxId)) {
    return { invalidField: 'buyerTaxId' }
  }
  const recipientName = input.recipientName.trim()
  if (recipientName === '') {
    return { invalidField: 'recipientName' }
  }
  const recipientPhone = input.recipientPhone.trim()
  if (recipientPhone === '') {
    return { invalidField: 'recipientPhone' }
  }
  const recipientAddress = input.recipientAddress.trim()
  if (recipientAddress === '') {
    return { invalidField: 'recipientAddress' }
  }
  if (input.lines.length === 0 || input.lines.length > INVOICE_REQUEST_LINE_LIMIT) {
    return { invalidField: 'lines' }
  }
  const lines: InvoiceSubmitPayload['lines'] = []
  for (const [index, line] of input.lines.entries()) {
    const productName = line.productName.trim()
    if (productName === '') {
      return { invalidField: `lines.${index}.productName` }
    }
    const quantity = parsePositiveInteger(line.quantity)
    if (quantity === null) {
      return { invalidField: `lines.${index}.quantity` }
    }
    const unitPrice = parsePositiveInteger(line.unitPrice)
    if (unitPrice === null) {
      return { invalidField: `lines.${index}.unitPrice` }
    }
    lines.push({ productName, quantity, unitPrice: String(unitPrice) })
  }
  const optional = (value: string) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  // 票面总计：留空即交给服务端按 5% 计算；填了就必须落在容差内（与服务端同一公式）。
  const totalTrimmed = input.totalAmount.trim()
  let totalAmount: string | undefined
  if (totalTrimmed !== '') {
    const total = parsePositiveInteger(totalTrimmed)
    if (total === null) {
      return { invalidField: 'totalAmount' }
    }
    const salesAmount = lines.reduce((sum, line) => sum + line.quantity * Number(line.unitPrice), 0)
    if (total - salesAmount < 0 || Math.abs(total * 100 - salesAmount * 105) > INVOICE_TOTAL_TOLERANCE_CENTS) {
      return { invalidField: 'totalAmount' }
    }
    totalAmount = String(total)
  }
  return {
    payload: {
      buyerName,
      buyerTaxId,
      invoiceRemark: optional(input.invoiceRemark),
      internalRemark: optional(input.internalRemark),
      recipientName,
      recipientPhone,
      recipientAddress,
      lines,
      ...(totalAmount === undefined ? {} : { totalAmount }),
    },
  }
}
