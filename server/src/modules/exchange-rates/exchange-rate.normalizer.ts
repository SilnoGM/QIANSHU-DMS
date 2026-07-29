import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

export const FOREIGN_UNITS_PER_CNY_PATTERN =
  /^(?=.*[1-9])(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/u

function validationFailure(): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    {
      foreignUnitsPerCny: [
        '必须是大于 0 且最多 18 位整数、12 位小数的十进制字符串',
      ],
    },
  )
}

/**
 * 汇率在 API 和持久化边界保持十进制字符串；这里只做语法归一化，不经过
 * JavaScript number，避免极小比例和超出安全整数范围的比例丢失精度。
 */
export function normalizeForeignUnitsPerCny(value: unknown): string {
  if (
    typeof value !== 'string'
    || !FOREIGN_UNITS_PER_CNY_PATTERN.test(value)
  ) {
    return validationFailure()
  }

  const [integer, fraction] = value.split('.')
  if (fraction === undefined) {
    return integer
  }

  const normalizedFraction = fraction.replace(/0+$/u, '')
  return normalizedFraction.length > 0
    ? `${integer}.${normalizedFraction}`
    : integer
}
