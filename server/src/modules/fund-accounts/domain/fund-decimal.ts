import {
  FUND_CALCULATION_ERROR_CODES,
  FundCalculationError,
} from './fund-calculation.errors'

const FUND_DECIMAL_SCALE = 100n
const FUND_SHARE_TOTAL_UNITS = 100n * FUND_DECIMAL_SCALE
const FUND_AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const FUND_SHARE_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u

function invalidAmount(): never {
  throw new FundCalculationError(
    FUND_CALCULATION_ERROR_CODES.AMOUNT_INVALID,
    '资金金额格式无效',
  )
}

function invalidShareRate(): never {
  throw new FundCalculationError(
    FUND_CALCULATION_ERROR_CODES.SHARE_RATE_INVALID,
    '资金分成比例无效',
  )
}

/**
 * 严格把字符串转换为两位最小单位。这里不接受 number、科学计数法、前导零、
 * 正号或负零，保证进入 BigInt 前没有发生 IEEE-754 精度损失或多义规范化。
 */
export function parseFundAmountMinor(value: unknown): bigint {
  if (typeof value !== 'string' || !FUND_AMOUNT_PATTERN.test(value)) {
    return invalidAmount()
  }

  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integerPart, fractionalPart = ''] = unsigned.split('.')
  const minor = BigInt(integerPart) * FUND_DECIMAL_SCALE
    + BigInt(fractionalPart.padEnd(2, '0'))

  if (negative && minor === 0n) return invalidAmount()
  return negative ? -minor : minor
}

/** 把内部最小单位输出为固定两位十进制字符串。 */
export function formatFundMinor(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const integerPart = absolute / FUND_DECIMAL_SCALE
  const fractionalPart = (absolute % FUND_DECIMAL_SCALE)
    .toString()
    .padStart(2, '0')

  return `${negative ? '-' : ''}${integerPart}.${fractionalPart}`
}

export function normalizeFundAmount(value: unknown): string {
  return formatFundMinor(parseFundAmountMinor(value))
}

export function normalizePositiveFundAmount(value: unknown): string {
  const minor = parseFundAmountMinor(value)
  if (minor <= 0n) {
    throw new FundCalculationError(
      FUND_CALCULATION_ERROR_CODES.POSTING_AMOUNT_INVALID,
      '资金金额必须大于零',
    )
  }

  return formatFundMinor(minor)
}

/** 比例与金额同样使用两位定点单位，但额外限制在闭区间 0–100。 */
export function parseFundShareRateUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !FUND_SHARE_RATE_PATTERN.test(value)) {
    return invalidShareRate()
  }

  const [integerPart, fractionalPart = ''] = value.split('.')
  const units = BigInt(integerPart) * FUND_DECIMAL_SCALE
    + BigInt(fractionalPart.padEnd(2, '0'))

  if (units > FUND_SHARE_TOTAL_UNITS) return invalidShareRate()
  return units
}

export function formatFundShareRateUnits(value: bigint): string {
  if (value < 0n || value > FUND_SHARE_TOTAL_UNITS) {
    return invalidShareRate()
  }

  return formatFundMinor(value)
}

export function normalizeFundShareRate(value: unknown): string {
  return formatFundShareRateUnits(parseFundShareRateUnits(value))
}

export interface FundSplitAmounts {
  readonly userAmount: string
  readonly companyAmount: string
}

export interface FundSplitMinorAmounts {
  readonly userAmount: bigint
  readonly companyAmount: bigint
}

/**
 * 对正数金额执行 ROUND_HALF_UP。分母恒为 100 * 100，且公司直接承接减法
 * 尾差，因此两条分录在任何比例和金额下都严格守恒。
 */
export function splitFundMinorByShare(
  amountMinor: bigint,
  userShareRateUnits: bigint,
): FundSplitMinorAmounts {
  if (amountMinor <= 0n) {
    throw new FundCalculationError(
      FUND_CALCULATION_ERROR_CODES.POSTING_AMOUNT_INVALID,
      '资金金额必须大于零',
    )
  }
  if (
    userShareRateUnits < 0n
    || userShareRateUnits > FUND_SHARE_TOTAL_UNITS
  ) {
    return invalidShareRate()
  }

  const numerator = amountMinor * userShareRateUnits
  const userAmount = (
    numerator + FUND_SHARE_TOTAL_UNITS / 2n
  ) / FUND_SHARE_TOTAL_UNITS

  return {
    userAmount,
    companyAmount: amountMinor - userAmount,
  }
}

export function splitFundAmountByShare(
  amount: unknown,
  userShareRate: unknown,
): FundSplitAmounts {
  const amountMinor = parseFundAmountMinor(amount)
  const shareRateUnits = parseFundShareRateUnits(userShareRate)
  const result = splitFundMinorByShare(amountMinor, shareRateUnits)

  return {
    userAmount: formatFundMinor(result.userAmount),
    companyAmount: formatFundMinor(result.companyAmount),
  }
}

export function calculateCompanyShareRateUnits(
  userShareRateUnits: bigint,
): bigint {
  if (
    userShareRateUnits < 0n
    || userShareRateUnits > FUND_SHARE_TOTAL_UNITS
  ) {
    return invalidShareRate()
  }
  return FUND_SHARE_TOTAL_UNITS - userShareRateUnits
}
