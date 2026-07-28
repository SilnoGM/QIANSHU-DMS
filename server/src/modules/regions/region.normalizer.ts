import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

const REGION_TEXT_MAX_CODE_POINTS = 128
const REGION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

function validationFailure(field: string, message: string): never {
  // Object.fromEntries 能安全承载极端字段名，避免动态键触发普通对象的原型 setter。
  const fieldErrors = Object.fromEntries([[field, [message]]])
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    fieldErrors,
  )
}

function normalizeDisplayText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string') {
    return validationFailure(field, '必须是字符串')
  }

  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function ensureTextLength(
  value: string,
  field: string,
  allowEmpty: boolean,
): string {
  const length = [...value].length
  if ((!allowEmpty && length === 0) || length > REGION_TEXT_MAX_CODE_POINTS) {
    return validationFailure(
      field,
      allowEmpty ? '长度不能超过 128 个字符' : '长度必须为 1 到 128 个字符',
    )
  }

  return value
}

/**
 * 规范化可展示名称，并生成固定 `en-US` 比较键。
 *
 * 小写映射可能扩展 Unicode code points（例如 `İ` 变成 `i` + combining dot），
 * 因而显示值和最终比较键都必须独立执行长度校验。
 */
export function normalizeRegionName(value: unknown): {
  name: string
  normalizedName: string
} {
  const name = ensureTextLength(
    normalizeDisplayText(value, 'name'),
    'name',
    false,
  )
  const normalizedName = ensureTextLength(
    name.toLocaleLowerCase('en-US').normalize('NFC'),
    'name',
    false,
  )

  return { name, normalizedName }
}

export function normalizeRegionSearchText(value: unknown): string {
  const query = ensureTextLength(
    normalizeDisplayText(value, 'query'),
    'query',
    false,
  )

  return ensureTextLength(
    query.toLocaleLowerCase('en-US').normalize('NFC'),
    'query',
    false,
  )
}

export function normalizeRegionCode(value: unknown): string {
  if (typeof value !== 'string') {
    return validationFailure('code', '必须是字符串')
  }

  const code = value.trim().toUpperCase()
  if (!REGION_CODE_PATTERN.test(code)) {
    return validationFailure(
      'code',
      '只能包含 2 到 64 位英文字母、数字、点、下划线和连字符',
    )
  }

  return code
}

export function normalizeNullableRegionText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const normalized = ensureTextLength(
    normalizeDisplayText(value, field),
    field,
    true,
  )
  return normalized || null
}

export function normalizeOptionalRegionText(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  return normalizeNullableRegionText(value, field)
}
