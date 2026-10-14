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

export interface InvoiceFormTotals {
  /** 任一行不完整时为 null：合计只在能算准的时候显示，不显示「部分合计」。 */
  readonly salesAmount: number | null
  readonly taxAmount: number | null
  readonly totalAmount: number | null
  readonly lineAmounts: (number | null)[]
}

export function calculateInvoiceTotals(lines: readonly InvoiceFormLine[]): InvoiceFormTotals {
  const lineAmounts = lines.map((line) => {
    const quantity = parsePositiveInteger(line.quantity)
    const unitPrice = parsePositiveInteger(line.unitPrice)
    return quantity === null || unitPrice === null ? null : quantity * unitPrice
  })
  if (lineAmounts.length === 0 || lineAmounts.includes(null)) {
    return { salesAmount: null, taxAmount: null, totalAmount: null, lineAmounts }
  }
  const salesAmount = (lineAmounts as number[]).reduce((total, amount) => total + amount, 0)
  const taxAmount = calculateTaxAmount(salesAmount)
  return { salesAmount, taxAmount, totalAmount: salesAmount + taxAmount, lineAmounts }
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
    },
  }
}
