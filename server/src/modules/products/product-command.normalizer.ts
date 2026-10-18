import { HttpStatus } from '@nestjs/common'

import type { ProductStatus as ProductStatusValue } from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'

const PRODUCT_STATUSES = new Set<ProductStatusValue>([
  'DRAFT',
  'ACTIVE',
  'INACTIVE',
])
const DECIMAL_INPUT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface NormalizedProductCreateMoney {
  readonly amount: string | null
  readonly currency: string
  /** 保留客户端提交的小数位，仅供后续与 Currency minorUnit 比较，不进入指纹。 */
  readonly inputFractionDigits: number
}

export interface NormalizedProductCreateAttribute {
  readonly title: string
  readonly value: string
}

export interface NormalizedProductCreateCommand {
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly status: ProductStatusValue
  readonly supplierValue: string | null
  readonly twdSalePrice: NormalizedProductCreateMoney
  readonly myrSalePrice: NormalizedProductCreateMoney
  readonly purchaseCost: NormalizedProductCreateMoney
  readonly attributes: readonly NormalizedProductCreateAttribute[]
}

function validationFailure(field: string, message = '字段校验失败'): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: [message] },
  )
}

function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return validationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  record: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  parent = '',
): void {
  const allowed = new Set(allowedKeys)
  const unknown = Object.keys(record).find(key => !allowed.has(key))
  if (unknown !== undefined) {
    // 未知 key 可能由攻击者控制；错误路径只返回已知父边界，不拼接原始 key。
    validationFailure(parent || 'body')
  }
}

function normalizeText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return validationFailure(field)
  const normalized = value.trim().normalize('NFC')
  const length = [...normalized].length
  if (length < 1 || length > maximumCodePoints) {
    return validationFailure(field)
  }
  return normalized
}

function normalizeSupplierValue(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return validationFailure('supplierValue')

  // Dictionary Item value 是稳定身份，只去除表单边界空白，不改大小写或 Unicode。
  const normalized = value.trim()
  if ([...normalized].length < 1 || [...normalized].length > 64) {
    return validationFailure('supplierValue')
  }
  return normalized
}

function normalizeOptionalText(
  value: unknown,
  field: string,
  maximumCodePoints: number,
): string | null {
  if (value === null) return null
  return normalizeText(value, field, maximumCodePoints)
}

function normalizeMoney(
  value: unknown,
  field: string,
  expectedCurrency?: string,
): NormalizedProductCreateMoney {
  const record = requireRecord(value, field)
  rejectUnknownKeys(record, ['amount', 'currency'], field)

  const currency = record.currency
  if (
    typeof currency !== 'string'
    || !CURRENCY_CODE_PATTERN.test(currency)
    || (expectedCurrency !== undefined && currency !== expectedCurrency)
  ) {
    return validationFailure(`${field}.currency`)
  }

  if (record.amount === null) {
    return Object.freeze({
      amount: null,
      currency,
      inputFractionDigits: 0,
    })
  }
  if (
    typeof record.amount !== 'string'
    || !DECIMAL_INPUT_PATTERN.test(record.amount)
  ) {
    return validationFailure(`${field}.amount`)
  }

  const [integerPart = '', fractionPart = ''] = record.amount.split('.')
  if (integerPart.length > 26 || fractionPart.length > 4) {
    return validationFailure(`${field}.amount`)
  }

  return Object.freeze({
    amount: `${integerPart}.${fractionPart.padEnd(4, '0')}`,
    currency,
    inputFractionDigits: fractionPart.length,
  })
}

function normalizeAttributes(value: unknown): readonly NormalizedProductCreateAttribute[] {
  if (!Array.isArray(value) || value.length > 50) {
    return validationFailure('attributes')
  }

  return Object.freeze(value.map((rawAttribute, index) => {
    const field = `attributes.${index}`
    const attribute = requireRecord(rawAttribute, field)
    rejectUnknownKeys(attribute, ['title', 'value'], field)
    return Object.freeze({
      title: normalizeText(attribute.title, `${field}.title`, 64),
      value: normalizeText(attribute.value, `${field}.value`, 512),
    })
  }))
}

/**
 * 创建输入的唯一纯规范化边界。它不读取数据库、不调用发号，并在返回前完成
 * 深复制与冻结，避免调用方在指纹和写入之间修改对象。
 */
export function normalizeProductCreateCommand(
  input: unknown,
): NormalizedProductCreateCommand {
  const record = requireRecord(input, 'body')
  rejectUnknownKeys(record, [
    'name',
    'categoryName',
    'productHeadName',
    'status',
    'supplierValue',
    'twdSalePrice',
    'myrSalePrice',
    'purchaseCost',
    'attributes',
  ])

  const status = record.status
  if (typeof status !== 'string' || !PRODUCT_STATUSES.has(status as ProductStatusValue)) {
    return validationFailure('status')
  }
  const categoryName = normalizeOptionalText(record.categoryName, 'categoryName', 64)
  const productHeadName = normalizeOptionalText(record.productHeadName, 'productHeadName', 64)
  if ((categoryName === null) !== (productHeadName === null)) {
    // 无独立字典表时仍坚持「分类 → 产品头」成对存储，避免半层级数据。
    return validationFailure('productHeadName', '分类与产品头必须同时填写')
  }
  const supplierValue = normalizeSupplierValue(record.supplierValue)
  if (status === 'ACTIVE' && supplierValue === null) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PRODUCT_SUPPLIER_REQUIRED',
      '启用产品必须选择供应商',
      { supplierValue: ['启用产品必须选择供应商'] },
    )
  }

  return Object.freeze({
    name: normalizeText(record.name, 'name', 128),
    categoryName,
    productHeadName,
    status: status as ProductStatusValue,
    supplierValue,
    twdSalePrice: normalizeMoney(record.twdSalePrice, 'twdSalePrice', 'TWD'),
    myrSalePrice: normalizeMoney(record.myrSalePrice, 'myrSalePrice', 'MYR'),
    purchaseCost: normalizeMoney(record.purchaseCost, 'purchaseCost'),
    attributes: normalizeAttributes(record.attributes),
  })
}

/** Express 可能把重复 Header 合并为逗号字符串；精确 UUID regex 会一并拒绝。 */
export function parseProductIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    return validationFailure('idempotencyKey', '必须是规范的小写 UUID v4')
  }
  return value
}

export function isCanonicalProductActorId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value)
}
