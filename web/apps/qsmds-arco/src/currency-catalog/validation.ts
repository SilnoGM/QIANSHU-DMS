import type {
  CurrencyCatalogItem,
  CurrencyCatalogMinorUnit,
} from './types'

const CURRENCY_CATALOG_RESPONSE_ERROR_CODE
  = 'CURRENCY_CATALOG_RESPONSE_INVALID'
const CURRENCY_CATALOG_RESPONSE_ERROR_MESSAGE
  = '货币目录响应格式无效'
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u
const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * API 成功但响应结构不可信时只暴露固定错误，不携带字段路径或原始响应。
 */
export class CurrencyCatalogResponseError extends Error {
  readonly code = CURRENCY_CATALOG_RESPONSE_ERROR_CODE

  constructor() {
    super(CURRENCY_CATALOG_RESPONSE_ERROR_MESSAGE)
    this.name = 'CurrencyCatalogResponseError'
  }
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function expectPlainRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new TypeError('Invalid object')
  }
  return value
}

function expectUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError('Invalid UUID')
  }
  return value
}

function expectRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Invalid string')
  }
  return value
}

function expectNullableDisplayString(value: unknown): string | null {
  if (value === null) {
    return null
  }
  return expectRequiredString(value)
}

function expectCurrencyCode(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_CODE_PATTERN.test(value)) {
    throw new TypeError('Invalid currency code')
  }
  return value
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('Invalid boolean')
  }
  return value
}

function expectMinorUnit(value: unknown): CurrencyCatalogMinorUnit {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > 4
  ) {
    throw new TypeError('Invalid minor unit')
  }
  return value as CurrencyCatalogMinorUnit
}

function expectSortOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('Invalid sort order')
  }
  return value as number
}

/**
 * 只复制公共目录字段。响应中即使包含 version、审计字段或未来新增字段，也不会
 * 进入金额组件契约或被缓存对象间接泄漏。
 */
function cloneCatalogItem(value: unknown): CurrencyCatalogItem {
  const source = expectPlainRecord(value)
  const item: CurrencyCatalogItem = {
    id: expectUuid(source.id),
    code: expectCurrencyCode(source.code),
    name: expectRequiredString(source.name),
    englishName: expectNullableDisplayString(source.englishName),
    symbol: expectNullableDisplayString(source.symbol),
    minorUnit: expectMinorUnit(source.minorUnit),
    enabled: expectBoolean(source.enabled),
    isBase: expectBoolean(source.isBase),
    sortOrder: expectSortOrder(source.sortOrder),
  }
  return Object.freeze(item)
}

/**
 * 完整响应验证必须覆盖停用货币，且验证跨项的不变量；不能先过滤 enabled，
 * 否则重复 code 或错误 base 可能藏在未被组件展示的记录里。
 */
export function cloneCurrencyCatalogResponse(
  value: unknown,
): readonly CurrencyCatalogItem[] {
  try {
    if (!Array.isArray(value)) {
      throw new TypeError('Invalid catalog')
    }

    const codes = new Set<string>()
    let baseCount = 0
    let baseCode: string | null = null
    const catalog = value.map((rawItem) => {
      const item = cloneCatalogItem(rawItem)
      if (codes.has(item.code)) {
        throw new TypeError('Duplicate currency code')
      }
      codes.add(item.code)
      if (item.isBase) {
        baseCount += 1
        baseCode = item.code
      }
      return item
    })

    if (baseCount !== 1 || baseCode !== 'CNY') {
      throw new TypeError('Invalid base currency')
    }

    return Object.freeze(catalog)
  }
  catch {
    throw new CurrencyCatalogResponseError()
  }
}
