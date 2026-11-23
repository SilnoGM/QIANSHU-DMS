export class PriceQuotationSheetImageError extends Error {
  constructor(readonly code: 'PURCHASE_ORDER_IMAGE_TOO_LARGE' | 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE') {
    super(code)
    this.name = 'PriceQuotationSheetImageError'
  }
}

/**
 * 核价单只承载供应商核对价格所需的字段：产品、数量、两种价格与合计。
 * 产品编号、销售来源、客户与经办人刻意不进入快照，避免把内部信息发给供应商。
 */
export interface PriceQuotationSheetSnapshot {
  readonly orderDate: string
  readonly supplierName: string
  readonly currencyCode: 'CNY'
  readonly referenceTotalAmount: string
  readonly actualTotalAmount: string
  readonly lines: readonly {
    readonly lineNumber: number
    readonly productName: string
    readonly description: string | null
    /** CATALOG 行为产品 ID，用于读取主图；CUSTOM 行为 null。 */
    readonly imageKey: string | null
    readonly quantity: number
    readonly referenceUnitPrice: string
    readonly actualUnitPrice: string
    readonly actualAmount: string
  }[]
}
