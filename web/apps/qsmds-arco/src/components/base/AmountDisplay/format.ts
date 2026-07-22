export const CURRENCY_SYMBOLS = {
  CNY: '¥',
  TWD: 'NT$',
  MYR: 'RM',
  USD: '$',
} as const

export const EMPTY_AMOUNT_TEXT = '—'

export type CurrencyCode = keyof typeof CURRENCY_SYMBOLS
export type CurrencyAmountValue = number | string | null | undefined

const DECIMAL_INPUT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u
const MINOR_UNIT_DIGITS = 2

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
function roundToMinorUnit(value: string): RoundedAmount {
  const negative = value.startsWith('-')
  const unsignedValue = value.replace(/^[+-]/u, '')
  const [rawInteger = '0', rawFraction = ''] = unsignedValue.split('.')
  const integer = (rawInteger || '0').replace(/^0+(?=\d)/u, '')
  const fraction = rawFraction.padEnd(MINOR_UNIT_DIGITS + 1, '0')
  const minorUnit = fraction.slice(0, MINOR_UNIT_DIGITS)
  const shouldRoundUp = fraction[MINOR_UNIT_DIGITS] >= '5'
  const combined = shouldRoundUp
    ? incrementDigits(`${integer}${minorUnit}`)
    : `${integer}${minorUnit}`
  const padded = combined.padStart(MINOR_UNIT_DIGITS + 1, '0')
  const roundedInteger = padded.slice(0, -MINOR_UNIT_DIGITS)
  const roundedFraction = padded.slice(-MINOR_UNIT_DIGITS)
  const isZero = /^0+$/u.test(roundedInteger) && /^0+$/u.test(roundedFraction)

  return {
    fraction: roundedFraction,
    integer: roundedInteger,
    negative: negative && !isZero,
  }
}

/**
 * 格式化组件唯一使用的纯函数：固定两位小数、千分位，并在金额末尾附加币种代码。
 */
export function formatCurrencyAmount(
  value: CurrencyAmountValue,
  currency: CurrencyCode,
): string {
  const normalized = normalizeInput(value)
  const symbol = CURRENCY_SYMBOLS[currency]

  if (!normalized || !symbol) {
    return EMPTY_AMOUNT_TEXT
  }

  const rounded = roundToMinorUnit(normalized)
  const groupedInteger = rounded.integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')

  return `${rounded.negative ? '-' : ''}${symbol}${groupedInteger}.${rounded.fraction} ${currency}`
}
