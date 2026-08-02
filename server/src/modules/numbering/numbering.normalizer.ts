import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

const RULE_CODE_INPUT_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

function normalizeUnicodeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function validationFailure(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: [message] },
  )
}

function normalizeText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return validationFailure(field, '必须是字符串')
  }

  return normalizeUnicodeText(value)
}

function ensureCodePointLength(
  value: string,
  field: string,
  maximum: number,
  allowEmpty: boolean,
): string {
  const length = [...value].length
  if ((!allowEmpty && length === 0) || length > maximum) {
    return validationFailure(
      field,
      allowEmpty
        ? `长度不能超过 ${maximum} 个字符`
        : `长度必须为 1 到 ${maximum} 个字符`,
    )
  }

  return value
}

export function normalizeNumberingRuleCode(value: unknown): string {
  if (!isNormalizableNumberingRuleCode(value)) {
    return validationFailure(
      'ruleCode',
      '必须以英文字母开头，且只能包含大写英文字母、数字和下划线',
    )
  }

  // 先限定原始值为 ASCII，再转换大小写，避免 ß/ı 等 Unicode 展开后伪装成合法编码。
  return normalizeUnicodeText(value).toUpperCase()
}

/** DTO 仅询问“能否规范化”，真正的变换仍集中在 normalizer 边界执行。 */
export function isNormalizableNumberingRuleCode(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && RULE_CODE_INPUT_PATTERN.test(normalizeUnicodeText(value))
}

export function normalizeNumberingRuleName(value: unknown): string {
  return ensureCodePointLength(
    normalizeText(value, 'name'),
    'name',
    128,
    false,
  )
}

export function normalizeNumberingRuleDescription(
  value: unknown,
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const normalized = ensureCodePointLength(
    normalizeText(value, 'description'),
    'description',
    500,
    true,
  )
  return normalized || null
}

export function normalizeOptionalNumberingRuleDescription(
  value: unknown,
): string | null | undefined {
  return value === undefined
    ? undefined
    : normalizeNumberingRuleDescription(value)
}

export function normalizeNumberingKeyword(
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return ensureCodePointLength(
    normalizeText(value, 'keyword'),
    'keyword',
    128,
    false,
  )
}
