import type {
  CreateFundAccountRequestDto,
  CreateFundManualAdjustmentRequestDto,
  CreateFundReversalRequestDto,
  UpdateFundShareRateRequestDto,
} from '@/api/generated/types.gen'

import Decimal from 'decimal.js'

type FundAdjustmentMode
  = CreateFundManualAdjustmentRequestDto['adjustmentMode']
type FundAdjustmentMetadata
  = NonNullable<CreateFundManualAdjustmentRequestDto['metadata']>

export interface FundAdjustmentPreviewInput {
  readonly adjustmentMode: FundAdjustmentMode
  readonly amount: string
  readonly companyBalance: string
  readonly userBalance: string
  readonly userShareRate: string
}

export interface FundAdjustmentPreview {
  readonly businessAmount: string
  readonly companyAmount: string
  readonly companyBalanceAfter: string
  readonly companyShareRate: string
  readonly userAmount: string
  readonly userBalanceAfter: string
  readonly userShareRate: string
}

const FUND_AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,4})?$/u
const FUND_SHARE_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/u

/**
 * 资金金额最多 26 位整数和 4 位小数；比例运算还会额外增加有效位。独立 clone
 * 防止修改 decimal.js 全局配置，同时为最大金额分账和余额相加保留充足精度。
 */
const FundDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
})

function normalizeText(value: string, fieldName: string): string {
  const normalized = value.normalize('NFC').trim()
  if (normalized === '') {
    throw new RangeError(`${fieldName}不能为空`)
  }
  return normalized
}

function parseFundAmount(value: string): Decimal {
  if (!FUND_AMOUNT_PATTERN.test(value)) {
    throw new RangeError('资金金额格式无效')
  }

  const amount = new FundDecimal(value)
  if (value.startsWith('-') && amount.isZero()) {
    throw new RangeError('资金金额格式无效')
  }
  return amount
}

function normalizeNonZeroFundAmount(value: string): string {
  const amount = parseFundAmount(value)
  if (amount.isZero()) {
    throw new RangeError('资金金额必须为非零值')
  }
  return amount.toFixed(4)
}

function parseFundShareRate(value: string): Decimal {
  if (!FUND_SHARE_RATE_PATTERN.test(value)) {
    throw new RangeError('资金分成比例无效')
  }

  const shareRate = new FundDecimal(value)
  if (shareRate.greaterThan(100)) {
    throw new RangeError('资金分成比例无效')
  }
  return shareRate
}

function normalizeFundShareRate(value: string): string {
  return parseFundShareRate(value).toFixed(4)
}

function validVersion(value: number): boolean {
  // Server DTO 从 1 开始计版本；0 不是可提交的并发快照。
  return Number.isSafeInteger(value) && value >= 1
}

export function buildFundAccountCreateRequest(
  userId: string,
  userShareRate: string,
): CreateFundAccountRequestDto {
  return {
    userId: normalizeText(userId, '用户'),
    userShareRate: normalizeFundShareRate(userShareRate),
  }
}

export function buildFundShareRateRequest(
  userShareRate: string,
  expectedVersion: number,
  reason: string,
): UpdateFundShareRateRequestDto {
  if (!validVersion(expectedVersion)) {
    throw new RangeError('账户版本无效，请刷新后重试')
  }
  return {
    expectedVersion,
    reason: normalizeText(reason, '修改原因'),
    userShareRate: normalizeFundShareRate(userShareRate),
  }
}

export function buildFundManualAdjustmentRequest(
  amount: string,
  adjustmentMode: FundAdjustmentMode,
  reason: string,
  metadata?: FundAdjustmentMetadata,
): CreateFundManualAdjustmentRequestDto {
  if (
    adjustmentMode !== 'USER_ONLY'
    && adjustmentMode !== 'USER_AND_COMPANY_BY_SHARE'
  ) {
    throw new RangeError('管理员调账模式无效')
  }

  return {
    adjustmentMode,
    amount: normalizeNonZeroFundAmount(amount),
    ...(metadata === undefined ? {} : { metadata: { ...metadata } }),
    reason: normalizeText(reason, '调账原因'),
  }
}

export function buildFundReversalRequest(
  amount: string,
  remainingAmount: string,
  reason: string,
): CreateFundReversalRequestDto {
  const reversalAmount = parseFundAmount(amount)
  const remaining = parseFundAmount(remainingAmount)
  if (
    !reversalAmount.greaterThan(0)
    || !remaining.greaterThan(0)
    || reversalAmount.greaterThan(remaining)
  ) {
    throw new RangeError('冲账金额必须大于零且不超过剩余额度')
  }
  return {
    amount: reversalAmount.toFixed(4),
    reason: normalizeText(reason, '冲账原因'),
  }
}

function signedAmount(amount: Decimal, negative: boolean): Decimal {
  if (amount.isZero()) {
    return amount
  }
  return negative ? amount.negated() : amount
}

/**
 * 调账预览严格镜像 Server 的四位定点、ROUND_HALF_UP 和“公司承接尾差”规则。
 * 返回值仅用于管理员确认影响范围；真正余额、比例和分录仍以 Server 在账户锁内
 * 读取并提交的结果为唯一账务真相，页面不得拿预览结果直接修改本地余额。
 */
export function calculateFundAdjustmentPreview(
  input: FundAdjustmentPreviewInput,
): FundAdjustmentPreview {
  const businessAmount = parseFundAmount(input.amount)
  if (businessAmount.isZero()) {
    throw new RangeError('资金金额必须为非零值')
  }
  const userShareRate = parseFundShareRate(input.userShareRate)
  const companyShareRate = new FundDecimal(100).minus(userShareRate)
  const userBalance = parseFundAmount(input.userBalance)
  const companyBalance = parseFundAmount(input.companyBalance)

  let userAmount: Decimal
  let companyAmount: Decimal
  if (input.adjustmentMode === 'USER_ONLY') {
    userAmount = businessAmount
    companyAmount = new FundDecimal(0)
  }
  else if (input.adjustmentMode === 'USER_AND_COMPANY_BY_SHARE') {
    const absoluteAmount = businessAmount.absoluteValue()
    const absoluteUserAmount = absoluteAmount
      .times(userShareRate)
      .dividedBy(100)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    const absoluteCompanyAmount = absoluteAmount.minus(absoluteUserAmount)
    userAmount = signedAmount(absoluteUserAmount, businessAmount.isNegative())
    companyAmount = signedAmount(
      absoluteCompanyAmount,
      businessAmount.isNegative(),
    )
  }
  else {
    throw new RangeError('管理员调账模式无效')
  }

  return Object.freeze({
    businessAmount: businessAmount.toFixed(4),
    companyAmount: companyAmount.toFixed(4),
    companyBalanceAfter: companyBalance.plus(companyAmount).toFixed(4),
    companyShareRate: companyShareRate.toFixed(4),
    userAmount: userAmount.toFixed(4),
    userBalanceAfter: userBalance.plus(userAmount).toFixed(4),
    userShareRate: userShareRate.toFixed(4),
  })
}
