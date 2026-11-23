import { normalizeDictionaryItemValue } from '../../dictionaries/dictionary.normalizer'
import {
  assertCustomPurchasePrices,
  calculatePurchaseOrderLineTotal,
  normalizePurchaseOrderAmount,
  normalizePurchaseOrderQuantity,
} from '../domain/purchase-order-decimal'
import { purchaseOrderRuleFailure, purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { normalizePurchaseOrderDate } from '../domain/purchase-order-rules'

const MAXIMUM_LINES = 100
// 与 DTO 同口径：限制展示备注长度，保证 100 行请求体不超过默认 JSON 解析上限。
const MAXIMUM_DESCRIPTION_CODE_POINTS = 80
const CANONICAL_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface NormalizedPriceQuotationSheetCatalogLine {
  readonly lineNumber: number
  readonly lineType: 'CATALOG'
  readonly productId: string
  readonly name: null
  /** 前端选产品时看到的采购定价；服务端以产品档案当前值比对，防止核价单与屏幕数字不一致。 */
  readonly expectedReferencePurchaseUnitPriceAmount: string
  readonly referencePurchaseUnitPriceAmount: null
  readonly actualPurchaseUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
  readonly description: string | null
}

export interface NormalizedPriceQuotationSheetCustomLine {
  readonly lineNumber: number
  readonly lineType: 'CUSTOM'
  readonly productId: null
  readonly name: string
  readonly expectedReferencePurchaseUnitPriceAmount: null
  readonly referencePurchaseUnitPriceAmount: string
  readonly actualPurchaseUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
  readonly description: string | null
}

export type NormalizedPriceQuotationSheetLine
  = | NormalizedPriceQuotationSheetCatalogLine
    | NormalizedPriceQuotationSheetCustomLine

export interface NormalizedPriceQuotationSheetRequest {
  readonly productMode: 'CATALOG' | 'CUSTOM'
  readonly supplierValue: string | null
  readonly customSupplierName: string | null
  readonly orderDate: string
  readonly lines: readonly NormalizedPriceQuotationSheetLine[]
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return purchaseOrderValidationFailure('request')
  }
  return value as Readonly<Record<string, unknown>>
}

function normalizeProductMode(value: unknown): 'CATALOG' | 'CUSTOM' {
  if (value !== 'CATALOG' && value !== 'CUSTOM') {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_PRODUCT_MODE_INVALID',
      '采购产品类型无效',
      'productMode',
    )
  }
  return value
}

function normalizeSupplierSource(
  input: Readonly<Record<string, unknown>>,
  productMode: 'CATALOG' | 'CUSTOM',
): Readonly<{ supplierValue: string | null, customSupplierName: string | null }> {
  if (productMode === 'CATALOG') {
    if (input.customSupplierName !== undefined) {
      return purchaseOrderRuleFailure(
        'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
        '供应商来源与采购产品类型不匹配',
      )
    }
    try {
      return Object.freeze({
        supplierValue: normalizeDictionaryItemValue(input.supplierValue),
        customSupplierName: null,
      })
    }
    catch {
      return purchaseOrderValidationFailure('supplierValue')
    }
  }
  if (input.supplierValue !== undefined) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
      '供应商来源与采购产品类型不匹配',
    )
  }
  // 先 NFKC 再 trim，全角空格等兼容字符不能绕过空值检查。
  const normalized = typeof input.customSupplierName === 'string'
    ? input.customSupplierName.normalize('NFKC').trim()
    : ''
  const length = [...normalized].length
  if (length < 1 || length > 128) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
      '自定义供应商名称必须是 1 至 128 个字符',
      'customSupplierName',
    )
  }
  return Object.freeze({ supplierValue: null, customSupplierName: normalized })
}

function normalizeDescription(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return purchaseOrderValidationFailure(field)
  const normalized = value.normalize('NFKC').trim()
  if (normalized === '') return null
  if ([...normalized].length > MAXIMUM_DESCRIPTION_CODE_POINTS) {
    return purchaseOrderValidationFailure(field)
  }
  return normalized
}

function normalizeCustomLineName(value: unknown, field: string): string {
  if (typeof value !== 'string') return purchaseOrderValidationFailure(field)
  const normalized = value.normalize('NFKC').trim()
  const length = [...normalized].length
  if (length < 1 || length > 128) return purchaseOrderValidationFailure(field)
  return normalized
}

function normalizeLine(
  value: unknown,
  index: number,
  productMode: 'CATALOG' | 'CUSTOM',
): NormalizedPriceQuotationSheetLine {
  const line = readRecord(value)
  const prefix = `lines.${index}`
  if (line.lineType !== 'CATALOG' && line.lineType !== 'CUSTOM') {
    return purchaseOrderValidationFailure(`${prefix}.lineType`)
  }
  if (line.lineType !== productMode) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_LINE_MODE_MISMATCH',
      '采购产品明细与采购产品类型不匹配',
    )
  }
  const quantity = normalizePurchaseOrderQuantity(line.quantity)
  const description = normalizeDescription(line.description, `${prefix}.description`)

  if (line.lineType === 'CUSTOM') {
    const prices = assertCustomPurchasePrices(
      line.referencePurchaseUnitPriceAmount,
      line.actualPurchaseUnitPriceAmount,
    )
    return Object.freeze({
      lineNumber: index + 1,
      lineType: 'CUSTOM' as const,
      productId: null,
      name: normalizeCustomLineName(line.name, `${prefix}.name`),
      expectedReferencePurchaseUnitPriceAmount: null,
      referencePurchaseUnitPriceAmount: prices.referencePurchaseUnitPriceAmount,
      actualPurchaseUnitPriceAmount: prices.actualPurchaseUnitPriceAmount,
      quantity,
      lineTotalAmount: calculatePurchaseOrderLineTotal(prices.actualPurchaseUnitPriceAmount, quantity),
      description,
    })
  }

  if (typeof line.productId !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(line.productId)) {
    return purchaseOrderValidationFailure(`${prefix}.productId`)
  }
  if (typeof line.expectedReferencePurchaseUnitPriceAmount !== 'string') {
    return purchaseOrderValidationFailure(`${prefix}.expectedReferencePurchaseUnitPriceAmount`)
  }
  if (typeof line.actualPurchaseUnitPriceAmount !== 'string') {
    return purchaseOrderValidationFailure(`${prefix}.actualPurchaseUnitPriceAmount`)
  }
  const actual = normalizePurchaseOrderAmount(line.actualPurchaseUnitPriceAmount)
  const expected = normalizePurchaseOrderAmount(line.expectedReferencePurchaseUnitPriceAmount)
  return Object.freeze({
    lineNumber: index + 1,
    lineType: 'CATALOG' as const,
    productId: line.productId,
    name: null,
    expectedReferencePurchaseUnitPriceAmount: expected,
    referencePurchaseUnitPriceAmount: null,
    actualPurchaseUnitPriceAmount: actual,
    quantity,
    lineTotalAmount: calculatePurchaseOrderLineTotal(actual, quantity),
    description,
  })
}

/**
 * 核价单是第二步的只读预览，不参与创建校验里的定金、尾款、唛头和货件规则；
 * 这里只保留能安全渲染图片的行级约束，并统一由服务端重算金额。
 */
export function normalizePriceQuotationSheetRequest(
  input: unknown,
  currentBusinessDate: string,
): NormalizedPriceQuotationSheetRequest {
  const body = readRecord(input)
  const productMode = normalizeProductMode(body.productMode)
  const supplier = normalizeSupplierSource(body, productMode)
  const orderDate = normalizePurchaseOrderDate(body.orderDate, currentBusinessDate)
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > MAXIMUM_LINES) {
    return purchaseOrderValidationFailure('lines')
  }
  const lines = body.lines.map((line, index) => normalizeLine(line, index, productMode))
  return Object.freeze({
    productMode,
    supplierValue: supplier.supplierValue,
    customSupplierName: supplier.customSupplierName,
    orderDate,
    lines: Object.freeze(lines),
  })
}
