import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

function validationFailure(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    Object.fromEntries([[field, [message]]]),
  )
}

function normalizeText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return validationFailure(field, '必须是字符串')
  }

  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function ensureCodePointLength(
  value: string,
  field: string,
  maxLength: number,
  allowEmpty: boolean,
): string {
  const length = [...value].length
  if ((!allowEmpty && length === 0) || length > maxLength) {
    return validationFailure(
      field,
      allowEmpty
        ? `长度不能超过 ${maxLength} 个字符`
        : `长度必须为 1 到 ${maxLength} 个字符`,
    )
  }

  return value
}

export function normalizeCurrencyCode(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_CODE_PATTERN.test(value)) {
    return validationFailure('code', '必须是三位英文字母')
  }

  return value.toUpperCase()
}

export function normalizeCurrencyName(value: unknown): string {
  return ensureCodePointLength(
    normalizeText(value, 'name'),
    'name',
    128,
    false,
  )
}

export function normalizeNullableCurrencyText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const normalized = ensureCodePointLength(
    normalizeText(value, field),
    field,
    maxLength,
    true,
  )
  return normalized || null
}

export function normalizeOptionalCurrencyText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  return normalizeNullableCurrencyText(value, field, maxLength)
}

export function normalizeOptionalCurrencySymbol(
  value: unknown,
): string | null | undefined {
  return normalizeOptionalCurrencyText(value, 'symbol', 16)
}
