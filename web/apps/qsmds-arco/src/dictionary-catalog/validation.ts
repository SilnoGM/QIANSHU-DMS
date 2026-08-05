import type {
  DictionaryCatalog,
  DictionaryCatalogBatch,
  DictionaryCatalogItem,
  DictionaryCatalogTone,
} from './types'

const DICTIONARY_CATALOG_RESPONSE_ERROR_CODE
  = 'DICTIONARY_CATALOG_RESPONSE_INVALID'
const DICTIONARY_CATALOG_RESPONSE_ERROR_MESSAGE
  = '系统字典目录响应格式无效'
const TYPE_CODE_INPUT_PATTERN
  = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/u
const TYPE_CODE_CANONICAL_PATTERN
  = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u
const ITEM_VALUE_CANONICAL_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const EDGE_UNICODE_WHITESPACE_PATTERN
  = /^\p{White_Space}+|\p{White_Space}+$/gu
const TYPE_CODE_MIN_CODE_POINTS = 3
const IDENTIFIER_MAX_CODE_POINTS = 64
const DISPLAY_TEXT_MAX_CODE_POINTS = 128
const BATCH_CODES_MAX_ITEMS = 20
const SORT_ORDER_MAXIMUM = 2_147_483_647

/**
 * 成功 HTTP 响应无法建立可信领域对象时，只公开固定错误。
 *
 * 错误不携带字段路径、原始值或 cause，避免恶意 getter、服务端扩展字段和传输
 * 内容通过日志或上层错误展示泄漏。
 */
export class DictionaryCatalogResponseError extends Error {
  readonly code = DICTIONARY_CATALOG_RESPONSE_ERROR_CODE

  constructor() {
    super(DICTIONARY_CATALOG_RESPONSE_ERROR_MESSAGE)
    this.name = 'DictionaryCatalogResponseError'
  }
}

/** 只接受普通对象与 null-prototype record，拒绝数组、Date 和 class instance。 */
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
    throw new TypeError('Invalid dictionary catalog object')
  }
  return value
}

/** 只需判断是否超过上限，避免为异常大的不可信字符串创建完整 code point 数组。 */
function hasCodePointLengthBetween(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  let length = 0
  for (const _codePoint of value) {
    length += 1
    if (length > maximum) {
      return false
    }
  }
  return length >= minimum
}

function normalizeIdentifierEdges(value: string): string {
  return value
    .normalize('NFC')
    .replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
}

/**
 * 请求 code 接受 Server 契约允许的大小写与 Unicode 边缘空白；响应 code 则由
 * `expectCanonicalTypeCode` 额外要求已经规范化，不能在可信边界内静默修正响应。
 */
export function normalizeDictionaryCatalogCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid dictionary catalog code')
  }

  const normalized = normalizeIdentifierEdges(value)
  if (
    !hasCodePointLengthBetween(
      normalized,
      TYPE_CODE_MIN_CODE_POINTS,
      IDENTIFIER_MAX_CODE_POINTS,
    )
    || !TYPE_CODE_INPUT_PATTERN.test(normalized)
  ) {
    throw new TypeError('Invalid dictionary catalog code')
  }

  // ASCII pattern 已先行限制字符集，lowercase 不会发生 Unicode 身份展开。
  return normalized.toLowerCase()
}

function expectCanonicalTypeCode(value: unknown): string {
  if (
    typeof value !== 'string'
    || !hasCodePointLengthBetween(
      value,
      TYPE_CODE_MIN_CODE_POINTS,
      IDENTIFIER_MAX_CODE_POINTS,
    )
    || !TYPE_CODE_CANONICAL_PATTERN.test(value)
    || normalizeDictionaryCatalogCode(value) !== value
  ) {
    throw new TypeError('Invalid canonical dictionary catalog code')
  }
  return value
}

function expectCanonicalItemValue(value: unknown): string {
  if (
    typeof value !== 'string'
    || !hasCodePointLengthBetween(value, 1, IDENTIFIER_MAX_CODE_POINTS)
    || !ITEM_VALUE_CANONICAL_PATTERN.test(value)
  ) {
    throw new TypeError('Invalid canonical dictionary item value')
  }
  return value
}

function normalizeDisplayText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function expectCanonicalDisplayText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid dictionary catalog display text')
  }

  const normalized = normalizeDisplayText(value)
  if (
    normalized !== value
    || !hasCodePointLengthBetween(normalized, 1, DISPLAY_TEXT_MAX_CODE_POINTS)
  ) {
    throw new TypeError('Invalid dictionary catalog display text')
  }
  return value
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('Invalid dictionary catalog boolean')
  }
  return value
}

function expectSortOrder(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > SORT_ORDER_MAXIMUM
  ) {
    throw new TypeError('Invalid dictionary catalog sort order')
  }
  return value as number
}

function expectTone(value: unknown): DictionaryCatalogTone {
  switch (value) {
    case 'DANGER':
    case 'DEFAULT':
    case 'INFO':
    case 'PRIMARY':
    case 'SUCCESS':
    case 'WARNING':
      return value
    default:
      throw new TypeError('Invalid dictionary catalog tone')
  }
}

function cloneCatalogItem(
  value: unknown,
  typeEnabled: boolean,
): DictionaryCatalogItem {
  const source = expectPlainRecord(value)
  const enabled = expectBoolean(source.enabled)
  const effectiveEnabled = expectBoolean(source.effectiveEnabled)
  if (effectiveEnabled !== (typeEnabled && enabled)) {
    throw new TypeError('Invalid dictionary catalog effective state')
  }

  return Object.freeze({
    value: expectCanonicalItemValue(source.value),
    label: expectCanonicalDisplayText(source.label),
    tone: expectTone(source.tone),
    enabled,
    effectiveEnabled,
    sortOrder: expectSortOrder(source.sortOrder),
  })
}

function expectArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid dictionary catalog array')
  }
  return value
}

/**
 * 按字段白名单创建全新 Catalog。使用 `Array.from` 而非 `map`，确保稀疏数组的
 * hole 也会作为 undefined 进入校验，而不是被跳过后混入可信结果。
 */
function cloneCatalog(value: unknown): DictionaryCatalog {
  const source = expectPlainRecord(value)
  const code = expectCanonicalTypeCode(source.code)
  const enabled = expectBoolean(source.enabled)
  const seenValues = new Set<string>()
  const items = Array.from(expectArray(source.items), (rawItem) => {
    const item = cloneCatalogItem(rawItem, enabled)
    if (seenValues.has(item.value)) {
      throw new TypeError('Duplicate dictionary catalog item value')
    }
    seenValues.add(item.value)
    return item
  })

  return Object.freeze({
    code,
    name: expectCanonicalDisplayText(source.name),
    enabled,
    items: Object.freeze(items),
  })
}

function normalizeRequestedCodes(value: unknown): readonly string[] {
  const values = expectArray(value)
  if (values.length < 1 || values.length > BATCH_CODES_MAX_ITEMS) {
    throw new TypeError('Invalid dictionary catalog requested codes')
  }

  const seen = new Set<string>()
  const normalized = Array.from(values, (code) => {
    const normalizedCode = normalizeDictionaryCatalogCode(code)
    if (seen.has(normalizedCode)) {
      throw new TypeError('Duplicate dictionary catalog requested code')
    }
    seen.add(normalizedCode)
    return normalizedCode
  })
  return normalized
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function safelyClone<T>(clone: () => T): T {
  try {
    return clone()
  }
  catch {
    throw new DictionaryCatalogResponseError()
  }
}

/** 单查结果必须与规范化后的请求 code 精确对应，禁止错误身份进入后续缓存。 */
export function cloneDictionaryCatalogResponse(
  value: unknown,
  requestedCode: string,
): DictionaryCatalog {
  return safelyClone(() => {
    const expectedCode = normalizeDictionaryCatalogCode(requestedCode)
    const catalog = cloneCatalog(value)
    if (catalog.code !== expectedCode) {
      throw new TypeError('Dictionary catalog response code mismatch')
    }
    return catalog
  })
}

/**
 * Batch 必须把请求集合精确分为 found 与 missing，且两个数组各自保留请求相对
 * 顺序。这里验证而不重排，避免 Web 静默掩盖 Server 契约漂移。
 */
export function cloneDictionaryCatalogBatchResponse(
  value: unknown,
  requestedCodes: readonly string[],
): DictionaryCatalogBatch {
  return safelyClone(() => {
    const expectedCodes = normalizeRequestedCodes(requestedCodes)
    const source = expectPlainRecord(value)
    const dictionaries = Array.from(
      expectArray(source.dictionaries),
      rawCatalog => cloneCatalog(rawCatalog),
    )
    const missingCodes = Array.from(
      expectArray(source.missingCodes),
      missingCode => expectCanonicalTypeCode(missingCode),
    )
    const dictionaryCodes = dictionaries.map(catalog => catalog.code)
    const dictionaryCodeSet = new Set(dictionaryCodes)
    const missingCodeSet = new Set(missingCodes)
    const expectedCodeSet = new Set(expectedCodes)

    if (
      dictionaryCodeSet.size !== dictionaryCodes.length
      || missingCodeSet.size !== missingCodes.length
      || dictionaryCodes.some(code => missingCodeSet.has(code))
      || dictionaryCodes.some(code => !expectedCodeSet.has(code))
      || missingCodes.some(code => !expectedCodeSet.has(code))
      || dictionaryCodes.length + missingCodes.length !== expectedCodes.length
    ) {
      throw new TypeError('Invalid dictionary catalog batch partition')
    }

    const expectedDictionaryOrder = expectedCodes.filter(code =>
      dictionaryCodeSet.has(code),
    )
    const expectedMissingOrder = expectedCodes.filter(code =>
      missingCodeSet.has(code),
    )
    if (
      !arraysEqual(dictionaryCodes, expectedDictionaryOrder)
      || !arraysEqual(missingCodes, expectedMissingOrder)
    ) {
      throw new TypeError('Invalid dictionary catalog batch order')
    }

    return Object.freeze({
      dictionaries: Object.freeze(dictionaries),
      missingCodes: Object.freeze(missingCodes),
    })
  })
}
