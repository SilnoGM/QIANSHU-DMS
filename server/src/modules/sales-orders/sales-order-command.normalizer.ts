import type {
  SalesOrderDocumentType,
  SalesOrderLineType,
} from '../../generated/prisma/enums'
import {
  calculateSalesOrderLineTotal,
  normalizeSalesOrderAmount,
  normalizeSalesOrderQuantity,
  sumSalesOrderAmounts,
  validateSalesOrderAgreedAmounts,
} from './domain/sales-order-decimal'
import {
  removeSalesOrderAddressWhitespace,
} from './domain/sales-order-address'
import {
  salesOrderValidationFailure,
} from './domain/sales-order-errors'

const SALES_ORDER_CURRENCIES = new Set(['TWD', 'MYR'])
const SALES_ORDER_DOCUMENT_TYPES = new Set<SalesOrderDocumentType>([
  'DEPOSIT_VOUCHER',
  'DELIVERY_RECEIPT',
  'OTHER',
])
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const CANONICAL_REGION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const ACTUAL_UNIT_PRICE_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u

export interface NormalizedSalesOrderCustomerInput {
  readonly name: string
  readonly phone: string
  readonly countryRegionId: string
  readonly provinceStateId: string
  readonly cityId: string
  readonly addressDetail: string
}

interface NormalizedSalesOrderLineBase {
  readonly lineNumber: number
  readonly lineType: SalesOrderLineType
  readonly actualUnitPriceAmount: string
  readonly quantity: number
  readonly lineTotalAmount: string
}

export interface NormalizedSalesOrderCatalogLine
  extends NormalizedSalesOrderLineBase {
  readonly lineType: 'CATALOG'
  readonly productId: string
}

export interface NormalizedSalesOrderCustomLine
  extends NormalizedSalesOrderLineBase {
  readonly lineType: 'CUSTOM'
  readonly name: string
  readonly description: string | null
}

export type NormalizedSalesOrderCreateLine =
  | NormalizedSalesOrderCatalogLine
  | NormalizedSalesOrderCustomLine

export interface NormalizedSalesOrderCreateDocument {
  readonly mediaAssetId: string
  readonly documentType: SalesOrderDocumentType
  readonly title: string | null
  readonly remark: string | null
}

export interface NormalizedSalesOrderCreateCommand {
  readonly orderDate: string
  readonly currencyCode: 'TWD' | 'MYR'
  readonly customer: NormalizedSalesOrderCustomerInput
  readonly lines: readonly NormalizedSalesOrderCreateLine[]
  readonly lineSubtotalAmount: string
  readonly agreedTotalAmount: string
  readonly depositDueAmount: string
  readonly balanceDueAmount: string
  readonly documents: readonly NormalizedSalesOrderCreateDocument[]
  readonly remark: string | null
}

function requireRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return salesOrderValidationFailure(field)
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
    /*
     * ValidationPipe 的 transform 会把同一联合 DTO 另一分支的 class field
     * 实例化成 undefined own property。JSON 无法表达 undefined，因此它只代表
     * “客户端未提交”；null 或任何实际值仍按跨分支未知字段硬拦截。
     */
    // 未知字段名可能由外部输入控制，错误只暴露已知父路径。
    return salesOrderValidationFailure(parent || 'body')
  }
}

function normalizeText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return salesOrderValidationFailure(field)
  const normalized = value.trim().normalize('NFKC')
  const length = [...normalized].length
  if (length < 1 || length > maximumCodePoints) {
    return salesOrderValidationFailure(field)
  }
  return normalized
}

function normalizeNullableText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string | null {
  if (value === null) return null
  return normalizeText(value, field, maximumCodePoints)
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    return salesOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

/** 地区域的可重现种子 ID 是 UUID v5，不得用业务聚合的 v4 约束误拦截。 */
function normalizeRegionUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CANONICAL_REGION_UUID_PATTERN.test(value)) {
    return salesOrderValidationFailure(field, '必须是规范的小写 UUID')
  }
  return value
}

function normalizeAmountField(value: unknown, field: string): string {
  try {
    return normalizeSalesOrderAmount(value)
  }
  catch {
    return salesOrderValidationFailure(field, '必须是规范的非负四位十进制金额')
  }
}

/**
 * 本单售价是用户录入边界，只接受最多两位小数；订单领域内部仍规范化为四位定点
 * 字符串参与乘法和持久化，避免修改既有金额计算及数据库精度。
 */
function normalizeActualUnitPriceField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ACTUAL_UNIT_PRICE_PATTERN.test(value)) {
    return salesOrderValidationFailure(field, '必须是非负且最多两位小数的金额')
  }
  return normalizeAmountField(value, field)
}

function normalizeQuantityField(value: unknown, field: string): number {
  try {
    return normalizeSalesOrderQuantity(value)
  }
  catch {
    return salesOrderValidationFailure(field, '必须是正整数')
  }
}

function normalizeOrderDate(value: unknown, businessToday: string): string {
  if (typeof value !== 'string') return salesOrderValidationFailure('orderDate')
  const match = ISO_DATE_PATTERN.exec(value)
  const todayMatch = ISO_DATE_PATTERN.exec(businessToday)
  if (match === null || todayMatch === null || value > businessToday) {
    return salesOrderValidationFailure('orderDate', '必须是今天或历史日期')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return salesOrderValidationFailure('orderDate')
  }
  return value
}

function normalizeCustomer(value: unknown): NormalizedSalesOrderCustomerInput {
  const customer = requireRecord(value, 'customer')
  rejectUnknownKeys(customer, [
    'name',
    'phone',
    'countryRegionId',
    'provinceStateId',
    'cityId',
    'addressDetail',
  ], 'customer')
  if (typeof customer.addressDetail !== 'string') {
    return salesOrderValidationFailure('customer.addressDetail')
  }
  const addressDetail = removeSalesOrderAddressWhitespace(
    customer.addressDetail,
  )
  if (addressDetail.length < 1 || [...addressDetail].length > 1000) {
    return salesOrderValidationFailure('customer.addressDetail')
  }
  return Object.freeze({
    name: normalizeText(customer.name, 'customer.name', 128),
    phone: normalizeText(customer.phone, 'customer.phone', 64),
    countryRegionId: normalizeRegionUuid(
      customer.countryRegionId,
      'customer.countryRegionId',
    ),
    provinceStateId: normalizeRegionUuid(
      customer.provinceStateId,
      'customer.provinceStateId',
    ),
    cityId: normalizeRegionUuid(customer.cityId, 'customer.cityId'),
    addressDetail,
  })
}

function normalizeLine(
  value: unknown,
  index: number,
): NormalizedSalesOrderCreateLine {
  const field = `lines.${index}`
  const line = requireRecord(value, field)
  const lineType = line.lineType
  if (lineType === 'CATALOG') {
    rejectUnknownKeys(line, [
      'lineType',
      'productId',
      'actualUnitPriceAmount',
      'quantity',
    ], field)
    const actualUnitPriceAmount = normalizeActualUnitPriceField(
      line.actualUnitPriceAmount,
      `${field}.actualUnitPriceAmount`,
    )
    const quantity = normalizeQuantityField(line.quantity, `${field}.quantity`)
    return Object.freeze({
      lineNumber: index + 1,
      lineType,
      productId: normalizeUuid(line.productId, `${field}.productId`),
      actualUnitPriceAmount,
      quantity,
      lineTotalAmount: calculateSalesOrderLineTotal(
        actualUnitPriceAmount,
        quantity,
      ),
    })
  }
  if (lineType === 'CUSTOM') {
    rejectUnknownKeys(line, [
      'lineType',
      'name',
      'description',
      'actualUnitPriceAmount',
      'quantity',
    ], field)
    const actualUnitPriceAmount = normalizeActualUnitPriceField(
      line.actualUnitPriceAmount,
      `${field}.actualUnitPriceAmount`,
    )
    const quantity = normalizeQuantityField(line.quantity, `${field}.quantity`)
    return Object.freeze({
      lineNumber: index + 1,
      lineType,
      name: normalizeText(line.name, `${field}.name`, 128),
      description: normalizeNullableText(
        line.description,
        `${field}.description`,
        1000,
      ),
      actualUnitPriceAmount,
      quantity,
      lineTotalAmount: calculateSalesOrderLineTotal(
        actualUnitPriceAmount,
        quantity,
      ),
    })
  }
  return salesOrderValidationFailure(`${field}.lineType`)
}

function normalizeLines(value: unknown): readonly NormalizedSalesOrderCreateLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return salesOrderValidationFailure('lines')
  }
  return Object.freeze(value.map(normalizeLine))
}

function normalizeDocuments(
  value: unknown,
): readonly NormalizedSalesOrderCreateDocument[] {
  if (!Array.isArray(value) || value.length > 20) {
    return salesOrderValidationFailure('documents')
  }
  const mediaAssetIds = new Set<string>()
  return Object.freeze(value.map((rawDocument, index) => {
    const field = `documents.${index}`
    const document = requireRecord(rawDocument, field)
    rejectUnknownKeys(document, [
      'mediaAssetId',
      'documentType',
      'title',
      'remark',
    ], field)
    const mediaAssetId = normalizeUuid(
      document.mediaAssetId,
      `${field}.mediaAssetId`,
    )
    if (mediaAssetIds.has(mediaAssetId)) {
      return salesOrderValidationFailure(
        `${field}.mediaAssetId`,
        '同一媒体资产不能重复关联',
      )
    }
    mediaAssetIds.add(mediaAssetId)
    if (
      typeof document.documentType !== 'string'
      || !SALES_ORDER_DOCUMENT_TYPES.has(
        document.documentType as SalesOrderDocumentType,
      )
    ) {
      return salesOrderValidationFailure(`${field}.documentType`)
    }
    return Object.freeze({
      mediaAssetId,
      documentType: document.documentType as SalesOrderDocumentType,
      title: normalizeNullableText(document.title, `${field}.title`, 128),
      remark: normalizeNullableText(document.remark, `${field}.remark`, 500),
    })
  }))
}

/** 创建订单 Body 的唯一纯规范化入口，不读取数据库、不发号。 */
export function normalizeSalesOrderCreateCommand(
  input: unknown,
  businessToday: string,
): NormalizedSalesOrderCreateCommand {
  const body = requireRecord(input, 'body')
  rejectUnknownKeys(body, [
    'orderDate',
    'currencyCode',
    'customer',
    'lines',
    'agreedTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'documents',
    'remark',
  ])
  if (
    typeof body.currencyCode !== 'string'
    || !SALES_ORDER_CURRENCIES.has(body.currencyCode)
  ) {
    return salesOrderValidationFailure('currencyCode', '首版仅支持 TWD 或 MYR')
  }
  const lines = normalizeLines(body.lines)
  const lineSubtotalAmount = sumSalesOrderAmounts(
    lines.map(line => line.lineTotalAmount),
  )
  const amounts = validateSalesOrderAgreedAmounts({
    lineSubtotalAmount,
    agreedTotalAmount: normalizeAmountField(
      body.agreedTotalAmount,
      'agreedTotalAmount',
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
  return Object.freeze({
    orderDate: normalizeOrderDate(body.orderDate, businessToday),
    currencyCode: body.currencyCode as 'TWD' | 'MYR',
    customer: normalizeCustomer(body.customer),
    lines,
    ...amounts,
    documents: normalizeDocuments(body.documents),
    remark: normalizeNullableText(body.remark, 'remark', 1000),
  })
}

/** Express 可能合并重复 Header；精确 UUID 正则会一并拒绝。 */
export function parseSalesOrderIdempotencyKey(value: unknown): string {
  return normalizeUuid(value, 'idempotencyKey')
}

export function isCanonicalSalesOrderActorId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value)
}
