import {
  type ValidationOptions,
  ValidateBy,
} from 'class-validator'

export const CANONICAL_NON_NEGATIVE_DECIMAL_PATTERN =
  /^(?:0|[1-9]\d*)$/u
export const CANONICAL_POSITIVE_DECIMAL_PATTERN = /^[1-9]\d*$/u

export function isCanonicalNonNegativeDecimalString(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && CANONICAL_NON_NEGATIVE_DECIMAL_PATTERN.test(value)
}

export function isCanonicalPositiveDecimalString(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && CANONICAL_POSITIVE_DECIMAL_PATTERN.test(value)
}

/**
 * 把 Prisma BigInt 或已校验的十进制串送过公共边界。明确拒绝 number，避免
 * 调用方在进入本函数前已经发生不可逆的 IEEE-754 精度损失。
 */
export function toDecimalString(value: unknown): string {
  if (typeof value === 'bigint' && value >= 0n) {
    return value.toString()
  }

  if (isCanonicalNonNegativeDecimalString(value)) {
    return value
  }

  throw new TypeError('必须提供规范的非负十进制值')
}

export function toNullableDecimalString(value: unknown): string | null {
  return value === null ? null : toDecimalString(value)
}

export function IsCanonicalNonNegativeDecimalString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCanonicalNonNegativeDecimalString',
      validator: {
        validate: isCanonicalNonNegativeDecimalString,
        defaultMessage(): string {
          return '必须是规范的非负十进制字符串'
        },
      },
    },
    validationOptions,
  )
}

export function IsCanonicalPositiveDecimalString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isCanonicalPositiveDecimalString',
      validator: {
        validate: isCanonicalPositiveDecimalString,
        defaultMessage(): string {
          return '必须是规范的正十进制字符串'
        },
      },
    },
    validationOptions,
  )
}
