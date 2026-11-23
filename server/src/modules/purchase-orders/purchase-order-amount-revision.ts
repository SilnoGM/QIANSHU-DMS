const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const AMOUNT_PATTERN = /^\d+\.\d{2}$/u

/**
 * 采购金额修订的行级快照。
 *
 * 修订行只保存发生变化的采购行；订单四个金额完全不变时（行间调价）也能
 * 依靠本快照说明改了什么。快照由服务端生成，客户端提交的只有新单价。
 */
export interface PurchaseOrderAmountRevisionLineChange {
  readonly lineId: string
  readonly lineNumber: number
  readonly productName: string
  readonly productNo: string | null
  readonly quantity: number
  readonly oldUnitPriceAmount: string
  readonly newUnitPriceAmount: string
  readonly oldLineTotalAmount: string
  readonly newLineTotalAmount: string
}

function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
}

/**
 * 数据库只保证 JSON 是数组；历史或人工修复行仍可能带脏元素，展示层按元素
 * 校验后跳过，避免单个坏快照让整张采购单详情不可读。
 */
export function readPurchaseOrderAmountRevisionLineChanges(
  value: unknown,
): readonly PurchaseOrderAmountRevisionLineChange[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return []
    }
    const record = entry as Record<string, unknown>
    const lineId = record.lineId
    const lineNumber = record.lineNumber
    const productName = record.productName
    const productNo = record.productNo
    const quantity = record.quantity
    const oldUnitPriceAmount = record.oldUnitPriceAmount
    const newUnitPriceAmount = record.newUnitPriceAmount
    const oldLineTotalAmount = record.oldLineTotalAmount
    const newLineTotalAmount = record.newLineTotalAmount
    if (
      typeof lineId !== 'string'
      || !UUID_PATTERN.test(lineId)
      || !isPositiveInteger(lineNumber)
      || typeof productName !== 'string'
      || (productNo !== null && typeof productNo !== 'string')
      || !isPositiveInteger(quantity)
      || !isAmount(oldUnitPriceAmount)
      || !isAmount(newUnitPriceAmount)
      || !isAmount(oldLineTotalAmount)
      || !isAmount(newLineTotalAmount)
    ) {
      return []
    }
    return [{
      lineId,
      lineNumber,
      productName,
      productNo,
      quantity,
      oldUnitPriceAmount,
      newUnitPriceAmount,
      oldLineTotalAmount,
      newLineTotalAmount,
    }]
  })
}
