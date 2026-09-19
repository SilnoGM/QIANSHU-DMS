import { ApiException } from '../../infrastructure/http/api.exception'

export class OceanCalculationError extends ApiException {
  constructor(field: string, overflow = false) {
    super(422, overflow ? 'OCEAN_CALCULATION_OVERFLOW' : 'OCEAN_CALCULATION_INVALID',
      overflow ? '海运计算结果超出允许范围' : '海运计算依据不完整或格式无效', { [field]: [overflow ? '数值超出允许范围' : '请填写符合精度要求的有效数值'] })
  }
}

export const power = (scale: number): bigint => 10n ** BigInt(scale)

export function parseDecimal(value: string, precision: number, scale: number, field: string, signed = false): bigint {
  if (typeof value !== 'string' || value.length > precision + 3 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new OceanCalculationError(field)
  const negative = value.startsWith('-')
  if (negative && !signed) throw new OceanCalculationError(field)
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  if (fraction.length > scale) throw new OceanCalculationError(field)
  const absolute = BigInt(whole) * power(scale) + BigInt(fraction.padEnd(scale, '0'))
  if (absolute >= power(precision)) throw new OceanCalculationError(field, true)
  return negative ? -absolute : absolute
}

export function formatDecimal(value: bigint, precision: number, scale: number, field: string): string {
  const absolute = value < 0n ? -value : value
  if (absolute >= power(precision)) throw new OceanCalculationError(field, true)
  const digits = absolute.toString().padStart(scale + 1, '0')
  return `${value < 0n ? '-' : ''}${scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`}`
}

// 有理数只在最终存储精度舍入；负数的半值同样远离零。
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new OceanCalculationError('denominator')
  const absolute = numerator < 0n ? -numerator : numerator
  const rounded = (absolute + denominator / 2n) / denominator
  return numerator < 0n ? -rounded : rounded
}

export function normalizeOceanDecimal(value: unknown, precision: number, scale: number, field: string, positive = false): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new OceanCalculationError(field)
  const parsed = parseDecimal(value, precision, scale, field)
  if (positive && parsed <= 0n) throw new OceanCalculationError(field)
  return formatDecimal(parsed, precision, scale, field)
}

export function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647) throw new OceanCalculationError(field)
  return value
}

export const money = (value: bigint, field = 'amount'): string => formatDecimal(value, 30, 2, field)
export const parseMoney = (value: string, field = 'amount', signed = false): bigint => parseDecimal(value, 30, 2, field, signed)
