import type {
  PurchaseOrderLineType,
  PurchaseOrderType,
} from '../../../generated/prisma/enums'
import { purchaseOrderRuleFailure } from './purchase-order-errors'

const PURCHASE_ORDER_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const PURCHASE_ORDER_SHIPPING_MARK_MAX_CODE_POINTS = 2_000

function invalidDate(): never {
  return purchaseOrderRuleFailure(
    'PURCHASE_ORDER_DATE_INVALID',
    '采购日期无效或晚于当前业务日期',
    'orderDate',
  )
}

function isCalendarDate(value: string): boolean {
  if (!PURCHASE_ORDER_DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
}

export function normalizePurchaseOrderDate(
  value: unknown,
  currentBusinessDate: string,
): string {
  if (
    typeof value !== 'string'
    || !isCalendarDate(value)
    || !isCalendarDate(currentBusinessDate)
    || value > currentBusinessDate
  ) {
    return invalidDate()
  }
  return value
}

export function normalizePurchaseOrderShippingMark(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_SHIPPING_MARK_INVALID',
      '采购唛头必须是最多 2000 个字符的文本',
      'shippingMarkText',
    )
  }
  const normalized = value.trim()
  if (normalized.length === 0) return null
  // Array.from 按 Unicode code point 计数，避免把 emoji 等代理对误算成两个字符。
  if (Array.from(normalized).length > PURCHASE_ORDER_SHIPPING_MARK_MAX_CODE_POINTS) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_SHIPPING_MARK_INVALID',
      '采购唛头必须是最多 2000 个字符的文本',
      'shippingMarkText',
    )
  }
  return normalized
}

export interface PurchaseOrderLineIdentityInput {
  readonly purchaseType: PurchaseOrderType
  readonly lineType: PurchaseOrderLineType
  readonly productId: string | null
  readonly productNoSnapshot: string | null
  readonly sourceSalesOrderLineId: string | null
}

export interface PurchaseOrderLineIdentity {
  readonly productId: string | null
  readonly productNoSnapshot: string | null
  readonly sourceSalesOrderLineId: string | null
}

function hasText(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function validatePurchaseOrderLineShape(
  input: PurchaseOrderLineIdentityInput,
): PurchaseOrderLineIdentity {
  const sourceShapeValid = input.purchaseType === 'SALES_LINKED'
    ? hasText(input.sourceSalesOrderLineId)
    : input.sourceSalesOrderLineId === null
  const productShapeValid = input.lineType === 'CATALOG'
    ? hasText(input.productId) && hasText(input.productNoSnapshot)
    : input.productId === null && input.productNoSnapshot === null

  if (!sourceShapeValid || !productShapeValid) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_LINE_SHAPE_INVALID',
      '采购产品明细与采购类型不匹配',
    )
  }

  return Object.freeze({
    productId: input.productId,
    productNoSnapshot: input.productNoSnapshot,
    sourceSalesOrderLineId: input.sourceSalesOrderLineId,
  })
}
