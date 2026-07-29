import type { CurrencyDescriptor, CurrencyMinorUnit } from '../currency'
import { findCurrencyDescriptor } from '../currency'

export const EMPTY_AMOUNT_TEXT = '—'

export type CurrencyAmountValue = number | string | null | undefined

const DECIMAL_INPUT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u

/**
 * 将有限 number 转为不带分组符的十进制文本。
 * number 本身仍受 IEEE 754 精度约束；需要精确保留服务端 decimal 时应传入 string。
 */
function numberToDecimalText(value: number): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined
  }

  return value.toLocaleString('en-US', {
    maximumFractionDigits: 20,
    useGrouping: false,
  })
}

function normalizeInput(value: CurrencyAmountValue): string | undefined {
  if (typeof value === 'number') {
    return numberToDecimalText(value)
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return DECIMAL_INPUT_PATTERN.test(normalized) ? normalized : undefined
}

/**
 * 对只包含数字的字符串执行加一，避免把超出安全整数范围的金额交给 Number 处理。
 */
function incrementDigits(value: string): string {
  const digits = value.split('')
  let carry = 1

  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    const next = Number(digits[index]) + carry
    digits[index] = String(next % 10)
    carry = next >= 10 ? 1 : 0
  }

  return carry === 1 ? `1${digits.join('')}` : digits.join('')
}

interface RoundedAmount {
  fraction: string
  integer: string
  negative: boolean
}

/**
 * 使用十进制字符串执行 half-up 舍入，确保大额 decimal 字符串不会因浮点转换丢失末位。
 */
function roundToMinorUnit(
  value: string,
  minorUnitDigits: CurrencyMinorUnit,
): RoundedAmount {
  const negative = value.startsWith('-')
  const unsignedValue = value.replace(/^[+-]/u, '')
  const [rawInteger = '0', rawFraction = ''] = unsignedValue.split('.')
  const integer = (rawInteger || '0').replace(/^0+(?=\d)/u, '')
  const fraction = rawFraction.padEnd(minorUnitDigits + 1, '0')
  const minorUnit = fraction.slice(0, minorUnitDigits)
  const shouldRoundUp = fraction[minorUnitDigits] >= '5'
  const combined = shouldRoundUp
    ? incrementDigits(`${integer}${minorUnit}`)
    : `${integer}${minorUnit}`
  const padded = combined.padStart(minorUnitDigits + 1, '0')
  const roundedInteger = minorUnitDigits === 0
    ? padded
    : padded.slice(0, -minorUnitDigits)
  const roundedFraction = minorUnitDigits === 0
    ? ''
    : padded.slice(-minorUnitDigits)
  const isZero = /^0+$/u.test(roundedInteger)
    && (roundedFraction.length === 0 || /^0+$/u.test(roundedFraction))

  return {
    fraction: roundedFraction,
    integer: roundedInteger,
    negative: negative && !isZero,
  }
}

/**
 * 已知币种按描述符的符号与 minorUnit 格式化；未知币种保留有效的原始十进制
 * 文本与代码，不猜测符号和精度，也不把可审计数据吞成空占位符。
 */
export function formatCurrencyAmount(
  value: CurrencyAmountValue,
  currency: string,
  currencies: readonly CurrencyDescriptor[],
): string {
  const normalized = normalizeInput(value)
  const normalizedCurrency = currency.trim()

  if (!normalized || normalizedCurrency.length === 0) {
    return EMPTY_AMOUNT_TEXT
  }

  const descriptor = findCurrencyDescriptor(currencies, normalizedCurrency)
  if (!descriptor) {
    return `${normalized} ${normalizedCurrency}`
  }

  const rounded = roundToMinorUnit(normalized, descriptor.minorUnit)
  const groupedInteger = rounded.integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
  const fraction = descriptor.minorUnit === 0
    ? ''
    : `.${rounded.fraction}`

  return `${rounded.negative ? '-' : ''}${descriptor.symbol ?? ''}${groupedInteger}${fraction} ${descriptor.code}`
}
