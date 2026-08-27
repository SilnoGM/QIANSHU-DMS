import type {
  PurchaseOrderLineType,
  PurchaseOrderType,
} from '../../generated/prisma/enums'
import { normalizeDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import {
  assertCustomPurchasePrices,
  calculatePurchaseOrderLineTotal,
  normalizePurchaseOrderAmount,
  normalizePurchaseOrderQuantity,
  sumPurchaseOrderAmounts,
  validatePurchaseOrderAgreedAmounts,
} from './domain/purchase-order-decimal'
import { purchaseOrderValidationFailure } from './domain/purchase-order-errors'
import {
  normalizePurchaseOrderDate,
  normalizePurchaseOrderShippingMark,
} from './domain/purchase-order-rules'

const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

interface NormalizedPurchaseOrderLineBase {
  readonly lineNumber: number
  readonly lineType: PurchaseOrderLineType
  readonly sourceSalesOrderLineId: string | null
  readonly actualPurchaseUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
}

export interface NormalizedPurchaseOrderCatalogLine
  extends NormalizedPurchaseOrderLineBase {
  readonly lineType: 'CATALOG'
  readonly productId: string
}

export interface NormalizedPurchaseOrderCustomLine
  extends NormalizedPurchaseOrderLineBase {
  readonly lineType: 'CUSTOM'
  readonly referencePurchaseUnitPriceAmount: string
  readonly name?: string
  readonly description?: string | null
}

export type NormalizedPurchaseOrderCreateLine =
  | NormalizedPurchaseOrderCatalogLine
  | NormalizedPurchaseOrderCustomLine

export interface NormalizedPurchaseOrderCreateCommand {
  readonly purchaseType: PurchaseOrderType
  readonly salesOrderId: string | null
  readonly supplierValue: string
  readonly orderDate: string
  readonly currencyCode: 'CNY'
  readonly shippingMarkText: string | null
  readonly lines: readonly NormalizedPurchaseOrderCreateLine[]
  readonly lineSubtotalAmount: string
  readonly purchaseTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly remark: string | null
}

function requireRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return purchaseOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  parent = '',
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(record).some(key => (
    !allowed.has(key) && record[key] !== undefined
  ))) {
    // 未知字段名可能由外部输入控制，错误响应只暴露固定的父路径。
    return purchaseOrderValidationFailure(parent || 'body')
  }
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    return purchaseOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

function normalizeText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return purchaseOrderValidationFailure(field)
  const normalized = value.trim().normalize('NFKC')
  if ([...normalized].length < 1 || [...normalized].length > maximumCodePoints) {
    return purchaseOrderValidationFailure(field)
  }
  return normalized
}

function normalizeNullableText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string | null {
  return value === undefined || value === null
    ? null
    : normalizeText(value, field, maximumCodePoints)
}

function normalizeSupplierValue(value: unknown): string {
  try {
    return normalizeDictionaryItemValue(value)
  }
  catch {
    return purchaseOrderValidationFailure('supplierValue')
  }
}

function normalizeAmountField(value: unknown, field: string): string {
  try {
    return normalizePurchaseOrderAmount(value)
  }
  catch {
    return purchaseOrderValidationFailure(field, '必须是非负且最多两位小数的金额')
  }
}

function normalizeQuantityField(value: unknown, field: string): number {
  try {
    return normalizePurchaseOrderQuantity(value)
  }
  catch {
    return purchaseOrderValidationFailure(field, '必须是正整数')
  }
}

function normalizeCatalogLine(
  line: Readonly<Record<string, unknown>>,
  field: string,
  index: number,
  purchaseType: PurchaseOrderType,
): NormalizedPurchaseOrderCatalogLine {
  rejectUnknownKeys(line, [
    'lineType',
    'productId',
    'sourceSalesOrderLineId',
    'actualPurchaseUnitPriceAmount',
    'quantity',
  ], field)
  const sourceSalesOrderLineId = purchaseType === 'SALES_LINKED'
    ? normalizeUuid(
        line.sourceSalesOrderLineId,
        `${field}.sourceSalesOrderLineId`,
      )
    : null
  if (purchaseType === 'STOCK' && line.sourceSalesOrderLineId !== undefined) {
    return purchaseOrderValidationFailure(`${field}.sourceSalesOrderLineId`)
  }
  const actualPurchaseUnitPriceAmount = normalizeAmountField(
    line.actualPurchaseUnitPriceAmount,
    `${field}.actualPurchaseUnitPriceAmount`,
  )
  const quantity = normalizeQuantityField(line.quantity, `${field}.quantity`)
  return Object.freeze({
    lineNumber: index + 1,
    lineType: 'CATALOG',
    productId: normalizeUuid(line.productId, `${field}.productId`),
    sourceSalesOrderLineId,
    actualPurchaseUnitPriceAmount,
    quantity,
    lineTotalAmount: calculatePurchaseOrderLineTotal(
      actualPurchaseUnitPriceAmount,
      quantity,
    ),
  })
}

function normalizeCustomLine(
  line: Readonly<Record<string, unknown>>,
  field: string,
  index: number,
  purchaseType: PurchaseOrderType,
): NormalizedPurchaseOrderCustomLine {
  const allowedKeys = purchaseType === 'SALES_LINKED'
    ? [
        'lineType',
        'sourceSalesOrderLineId',
        'referencePurchaseUnitPriceAmount',
        'actualPurchaseUnitPriceAmount',
        'quantity',
      ]
    : [
        'lineType',
        'name',
        'description',
        'referencePurchaseUnitPriceAmount',
        'actualPurchaseUnitPriceAmount',
        'quantity',
      ]
  rejectUnknownKeys(line, allowedKeys, field)
  const prices = assertCustomPurchasePrices(
    line.referencePurchaseUnitPriceAmount,
    line.actualPurchaseUnitPriceAmount,
  )
  const quantity = normalizeQuantityField(line.quantity, `${field}.quantity`)
  const common = {
    lineNumber: index + 1,
    lineType: 'CUSTOM' as const,
    sourceSalesOrderLineId: purchaseType === 'SALES_LINKED'
      ? normalizeUuid(
          line.sourceSalesOrderLineId,
          `${field}.sourceSalesOrderLineId`,
        )
      : null,
    ...prices,
    quantity,
    lineTotalAmount: calculatePurchaseOrderLineTotal(
      prices.actualPurchaseUnitPriceAmount,
      quantity,
    ),
  }
  return purchaseType === 'SALES_LINKED'
    ? Object.freeze(common)
    : Object.freeze({
        ...common,
        name: normalizeText(line.name, `${field}.name`, 128),
        description: normalizeNullableText(
          line.description,
          `${field}.description`,
          1000,
        ),
      })
}

function normalizeLine(
  value: unknown,
  index: number,
  purchaseType: PurchaseOrderType,
): NormalizedPurchaseOrderCreateLine {
  const field = `lines.${index}`
  const line = requireRecord(value, field)
  if (line.lineType === 'CATALOG') {
    return normalizeCatalogLine(line, field, index, purchaseType)
  }
  if (line.lineType === 'CUSTOM') {
    return normalizeCustomLine(line, field, index, purchaseType)
  }
  return purchaseOrderValidationFailure(`${field}.lineType`)
}

function normalizeLines(
  value: unknown,
  purchaseType: PurchaseOrderType,
): readonly NormalizedPurchaseOrderCreateLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return purchaseOrderValidationFailure('lines')
  }
  return Object.freeze(value.map((line, index) => (
    normalizeLine(line, index, purchaseType)
  )))
}

function normalizePurchaseType(value: unknown): PurchaseOrderType {
  if (value !== 'SALES_LINKED' && value !== 'STOCK') {
    return purchaseOrderValidationFailure('purchaseType')
  }
  return value
}

/** 创建 Body 的唯一纯规范化入口；不读数据库、不信任汇总、不接受订单号或币种。 */
export function normalizePurchaseOrderCreateCommand(
  input: unknown,
  businessToday: string,
): NormalizedPurchaseOrderCreateCommand {
  const body = requireRecord(input, 'body')
  rejectUnknownKeys(body, [
    'purchaseType',
    'salesOrderId',
    'supplierValue',
    'orderDate',
    'shippingMarkText',
    'lines',
    'purchaseTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'remark',
  ])
  const purchaseType = normalizePurchaseType(body.purchaseType)
  const salesOrderId = purchaseType === 'SALES_LINKED'
    ? normalizeUuid(body.salesOrderId, 'salesOrderId')
    : null
  if (purchaseType === 'STOCK' && body.salesOrderId !== undefined) {
    return purchaseOrderValidationFailure('salesOrderId')
  }
  const lines = normalizeLines(body.lines, purchaseType)
  const lineSubtotalAmount = sumPurchaseOrderAmounts(
    lines.map(line => line.lineTotalAmount),
  )
  const amounts = validatePurchaseOrderAgreedAmounts({
    lineSubtotalAmount,
    purchaseTotalAmount: normalizeAmountField(
      body.purchaseTotalAmount,
      'purchaseTotalAmount',
    ),
    depositDueAmount: normalizeAmountField(
      body.depositDueAmount,
      'depositDueAmount',
    ),
    balanceDueAmount: normalizeAmountField(
      body.balanceDueAmount,
      'balanceDueAmount',
    ),
  })
  let orderDate: string
  try {
    orderDate = normalizePurchaseOrderDate(body.orderDate, businessToday)
  }
  catch {
    return purchaseOrderValidationFailure('orderDate', '必须是今天或历史日期')
  }

  return Object.freeze({
    purchaseType,
    salesOrderId,
    supplierValue: normalizeSupplierValue(body.supplierValue),
    orderDate,
    currencyCode: 'CNY',
    shippingMarkText: normalizePurchaseOrderShippingMark(body.shippingMarkText),
    lines,
    ...amounts,
    remark: normalizeNullableText(body.remark, 'remark', 1000),
  })
}

/** Express 可能合并重复 Header；精确 UUID 正则会一并拒绝。 */
export function parsePurchaseOrderIdempotencyKey(value: unknown): string {
  return normalizeUuid(value, 'idempotencyKey')
}

export function isCanonicalPurchaseOrderActorId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value)
}
