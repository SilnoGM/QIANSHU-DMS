import type { PaymentRecipientAccountInputDto } from '../payment-recipients/payment-recipient.dto'
import { normalizePaymentRecipientAccounts } from '../payment-recipients/payment-recipient.normalizer'
import type {
  PurchaseOrderLineType,
  PurchaseOrderProductMode,
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
import {
  purchaseOrderRuleFailure,
  purchaseOrderValidationFailure,
} from './domain/purchase-order-errors'
import {
  normalizePurchaseOrderDate,
} from './domain/purchase-order-rules'
import { normalizePurchaseOrderParts, type NormalizedPurchaseOrderPart } from './purchase-order-parts'

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
  readonly name: string
  readonly description: string | null
}

export type NormalizedPurchaseOrderCreateLine =
  | NormalizedPurchaseOrderCatalogLine
  | NormalizedPurchaseOrderCustomLine

export interface NormalizedPurchaseOrderCreateCommand {
  readonly purchaseType: PurchaseOrderType
  readonly productMode: Exclude<PurchaseOrderProductMode, 'MIXED'>
  readonly salesOrderId: string | null
  readonly supplierValue: string | null
  readonly customSupplierName: string | null
  readonly paymentAccounts: readonly PaymentRecipientAccountInputDto[]
  readonly orderDate: string
  readonly currencyCode: 'CNY'
  readonly expectedShippingMarkResolution: string
  readonly lines: readonly NormalizedPurchaseOrderCreateLine[]
  readonly parts: readonly NormalizedPurchaseOrderPart[]
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

function invalidProductMode(): never {
  return purchaseOrderRuleFailure(
    'PURCHASE_ORDER_PRODUCT_MODE_INVALID',
    '采购产品类型无效',
    'productMode',
  )
}

function invalidSupplierSource(): never {
  return purchaseOrderRuleFailure(
    'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
    '供应商来源与采购产品类型不匹配',
    'supplier',
  )
}

function normalizeProductMode(
  value: unknown,
): Exclude<PurchaseOrderProductMode, 'MIXED'> {
  if (value !== 'CATALOG' && value !== 'CUSTOM') return invalidProductMode()
  return value
}

function normalizeCustomSupplierName(value: unknown): string {
  if (typeof value !== 'string') {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
      '自定义供应商名称必须是 1 至 128 个字符',
      'customSupplierName',
    )
  }
  // 先执行 NFKC 再 trim，使全角空格等兼容字符不能绕过空值检查。
  const normalized = value.normalize('NFKC').trim()
  const length = [...normalized].length
  if (length < 1 || length > 128) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
      '自定义供应商名称必须是 1 至 128 个字符',
      'customSupplierName',
    )
  }
  return normalized
}

function normalizeSupplierSource(
  body: Readonly<Record<string, unknown>>,
  productMode: Exclude<PurchaseOrderProductMode, 'MIXED'>,
): Readonly<{
  customSupplierName: string | null
  supplierValue: string | null
}> {
  if (productMode === 'CATALOG') {
    if (body.customSupplierName !== undefined) return invalidSupplierSource()
    return Object.freeze({
      supplierValue: normalizeSupplierValue(body.supplierValue),
      customSupplierName: null,
    })
  }
  if (body.supplierValue !== undefined) return invalidSupplierSource()
  return Object.freeze({
    supplierValue: null,
    customSupplierName: normalizeCustomSupplierName(body.customSupplierName),
  })
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
  const allowedKeys = [
    'lineType',
    'name',
    'description',
    'referencePurchaseUnitPriceAmount',
    'actualPurchaseUnitPriceAmount',
    'quantity',
    ...(purchaseType === 'SALES_LINKED' ? ['sourceSalesOrderLineId'] : []),
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
    // 销售来源只约束关联身份、类型和数量；采购人员确认后的名称与描述属于采购快照，
    // 必须在服务端重新规范化后保存，不能静默覆盖回销售订单的旧文本。
    name: normalizeText(line.name, `${field}.name`, 128),
    description: normalizeNullableText(
      line.description,
      `${field}.description`,
      1000,
    ),
    ...prices,
    quantity,
    lineTotalAmount: calculatePurchaseOrderLineTotal(
      prices.actualPurchaseUnitPriceAmount,
      quantity,
    ),
  }
  return Object.freeze(common)
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

function assertLineModes(
  lines: readonly NormalizedPurchaseOrderCreateLine[],
  productMode: Exclude<PurchaseOrderProductMode, 'MIXED'>,
): void {
  if (lines.some(line => line.lineType !== productMode)) {
    return purchaseOrderRuleFailure(
      'PURCHASE_ORDER_LINE_MODE_MISMATCH',
      '采购产品明细与采购产品类型不匹配',
      'lines',
    )
  }
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
  legacyReplay = false,
  legacyRecipientsReplay = false,
): NormalizedPurchaseOrderCreateCommand {
  const body = requireRecord(input, 'body')
  rejectUnknownKeys(body, [
    'purchaseType',
    'productMode',
    'salesOrderId',
    'supplierValue',
    'customSupplierName',
    'paymentAccounts',
    'orderDate',
    'expectedShippingMarkResolution',
    'lines',
    ...(legacyReplay ? [] : ['parts']),
    'purchaseTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'remark',
  ])
  const purchaseType = normalizePurchaseType(body.purchaseType)
  if (typeof body.expectedShippingMarkResolution !== 'string'
    || !/^[0-9a-f]{64}$/u.test(body.expectedShippingMarkResolution)) {
    return purchaseOrderValidationFailure('expectedShippingMarkResolution', '请重新核对唛头规则')
  }
  const productMode = normalizeProductMode(body.productMode)
  const supplier = normalizeSupplierSource(body, productMode)
  // 已提交旧请求可以重放；新请求不得借旧版本绕过本单收款资料。
  if ((productMode === 'CATALOG' || legacyRecipientsReplay) && body.paymentAccounts !== undefined) {
    return purchaseOrderValidationFailure('paymentAccounts')
  }
  const paymentAccounts = productMode === 'CUSTOM' && !legacyRecipientsReplay
    ? normalizePaymentRecipientAccounts(body.paymentAccounts, 1)
    : []
  const salesOrderId = purchaseType === 'SALES_LINKED'
    ? normalizeUuid(body.salesOrderId, 'salesOrderId')
    : null
  if (purchaseType === 'STOCK' && body.salesOrderId !== undefined) {
    return purchaseOrderValidationFailure('salesOrderId')
  }
  const lines = normalizeLines(body.lines, purchaseType)
  assertLineModes(lines, productMode)
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
    productMode,
    salesOrderId,
    ...supplier,
    paymentAccounts,
    orderDate,
    currencyCode: 'CNY',
    expectedShippingMarkResolution: body.expectedShippingMarkResolution,
    lines,
    parts: legacyReplay ? Object.freeze([]) : normalizePurchaseOrderParts(body.parts, lines),
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
