import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

const TYPE_CODE_INPUT_PATTERN =
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u
const ITEM_VALUE_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const EDGE_UNICODE_WHITESPACE_PATTERN =
  /^\p{White_Space}+|\p{White_Space}+$/gu

const TYPE_CODE_MIN_CODE_POINTS = 3
const IDENTIFIER_MAX_CODE_POINTS = 64
const DISPLAY_TEXT_MAX_CODE_POINTS = 128
const DESCRIPTION_MAX_CODE_POINTS = 500
const BATCH_CODES_MAX_ITEMS = 20

type DictionaryValidationField =
  | 'code'
  | 'value'
  | 'name'
  | 'label'
  | 'description'
  | 'query'
  | 'codes'

const DICTIONARY_VALIDATION_MESSAGES: Readonly<
  Record<DictionaryValidationField, string>
> = {
  code: '字典类型编码格式无效',
  value: '字典条目值格式无效',
  name: '字典类型名称必须为 1 到 128 个字符',
  label: '字典条目标签必须为 1 到 128 个字符',
  description: '说明不能超过 500 个字符',
  query: '查询文本必须为 1 到 128 个字符',
  codes: '字典类型编码列表必须包含 1 到 20 个不重复的有效编码',
}

function validationFailure(field: DictionaryValidationField): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: [DICTIONARY_VALIDATION_MESSAGES[field]] },
  )
}

function codePointLength(value: string): number {
  return [...value].length
}

/** 技术标识只执行 NFC 与首尾 trim；内部空白必须保留给格式校验拒绝。 */
function normalizeIdentifierText(value: string): string {
  // String.trim() 不覆盖 Unicode White_Space 的 U+0085，必须使用同一 Unicode 属性显式裁边。
  return value
    .normalize('NFC')
    .replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
}

/** 展示文本把所有 Unicode 空白折叠为一个 ASCII space，再删除首尾空白。 */
function normalizeDisplayText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function isCodePointLengthBetween(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  const length = codePointLength(value)
  return length >= minimum && length <= maximum
}

/**
 * Type code 必须先完成 NFC，再以 ASCII 正则校验，最后才转换小写。
 * 这个顺序避免 ß、ı 等 Unicode 字符通过大小写展开伪装成技术标识。
 */
export function isNormalizableDictionaryTypeCode(
  value: unknown,
): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = normalizeIdentifierText(value)
  return isCodePointLengthBetween(
    normalized,
    TYPE_CODE_MIN_CODE_POINTS,
    IDENTIFIER_MAX_CODE_POINTS,
  ) && TYPE_CODE_INPUT_PATTERN.test(normalized)
}

export function normalizeDictionaryTypeCode(value: unknown): string {
  if (!isNormalizableDictionaryTypeCode(value)) {
    return validationFailure('code')
  }

  return normalizeIdentifierText(value).toLowerCase()
}

/** Item value 同样先限制 ASCII，再执行不会发生 Unicode 展开的 uppercase。 */
export function isNormalizableDictionaryItemValue(
  value: unknown,
): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = normalizeIdentifierText(value)
  return isCodePointLengthBetween(normalized, 1, IDENTIFIER_MAX_CODE_POINTS)
    && ITEM_VALUE_INPUT_PATTERN.test(normalized)
}

export function normalizeDictionaryItemValue(value: unknown): string {
  if (!isNormalizableDictionaryItemValue(value)) {
    return validationFailure('value')
  }

  return normalizeIdentifierText(value).toUpperCase()
}

function isNormalizableRequiredDisplayText(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  return isCodePointLengthBetween(
    normalizeDisplayText(value),
    1,
    DISPLAY_TEXT_MAX_CODE_POINTS,
  )
}

export function isNormalizableDictionaryName(
  value: unknown,
): value is string {
  return isNormalizableRequiredDisplayText(value)
}

export function normalizeDictionaryName(value: unknown): string {
  if (!isNormalizableDictionaryName(value)) {
    return validationFailure('name')
  }

  return normalizeDisplayText(value)
}

export function isNormalizableDictionaryLabel(
  value: unknown,
): value is string {
  return isNormalizableRequiredDisplayText(value)
}

export function normalizeDictionaryLabel(value: unknown): string {
  if (!isNormalizableDictionaryLabel(value)) {
    return validationFailure('label')
  }

  return normalizeDisplayText(value)
}

export function isNormalizableDictionaryDescription(
  value: unknown,
): value is string | null | undefined {
  if (value === undefined || value === null) {
    return true
  }

  return typeof value === 'string'
    && codePointLength(normalizeDisplayText(value))
      <= DESCRIPTION_MAX_CODE_POINTS
}

export function normalizeDictionaryDescription(
  value: unknown,
): string | null {
  if (!isNormalizableDictionaryDescription(value)) {
    return validationFailure('description')
  }
  if (value === undefined || value === null) {
    return null
  }

  return normalizeDisplayText(value) || null
}

/** PATCH 中 undefined 表示未提交，null 或空白字符串才表示显式清空。 */
export function normalizeOptionalDictionaryDescription(
  value: unknown,
): string | null | undefined {
  return value === undefined
    ? undefined
    : normalizeDictionaryDescription(value)
}

export function isNormalizableDictionaryQuery(
  value: unknown,
): value is string | undefined {
  if (value === undefined) {
    return true
  }
  if (typeof value !== 'string') {
    return false
  }

  return isCodePointLengthBetween(
    normalizeDisplayText(value),
    1,
    DISPLAY_TEXT_MAX_CODE_POINTS,
  )
}

export function normalizeDictionaryQuery(
  value: unknown,
): string | undefined {
  if (!isNormalizableDictionaryQuery(value)) {
    return validationFailure('query')
  }

  return value === undefined ? undefined : normalizeDisplayText(value)
}

export function isNormalizableDictionaryBatchCodes(
  value: unknown,
): value is string[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > BATCH_CODES_MAX_ITEMS
  ) {
    return false
  }

  const normalizedCodes = new Set<string>()
  for (const code of value) {
    if (!isNormalizableDictionaryTypeCode(code)) {
      return false
    }

    const normalized = normalizeIdentifierText(code).toLowerCase()
    if (normalizedCodes.has(normalized)) {
      return false
    }
    normalizedCodes.add(normalized)
  }

  return true
}

/** Batch 在校验阶段拒绝规范化后重复值，成功时保持首次请求顺序。 */
export function normalizeDictionaryBatchCodes(value: unknown): string[] {
  if (!isNormalizableDictionaryBatchCodes(value)) {
    return validationFailure('codes')
  }

  return value.map((code) => normalizeIdentifierText(code).toLowerCase())
}
