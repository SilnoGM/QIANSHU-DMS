import type {
  FundPostingBatchDetailDto,
  FundPostingBatchEntryDto,
  FundTransactionDto,
} from '@/api/generated/types.gen'
import type { FundTransactionListQuery } from '@/api/modules/fund-accounts'

import Decimal from 'decimal.js'

export interface FundTransactionFilterState {
  readonly accountId?: string
  readonly businessCategory?: FundTransactionDto['businessCategory']
  readonly businessNo?: string
  readonly businessSourceId?: string
  readonly direction?: FundTransactionDto['direction']
  readonly occurredFrom?: string
  readonly occurredTo?: string
  readonly postingTypeId?: string
  readonly reversalStatus?: FundTransactionDto['reversalStatus']
  readonly userId?: string
}

export interface FundTransactionQueryInput {
  readonly filters: FundTransactionFilterState
  readonly page: number
  readonly pageSize: number
  readonly sortBy: NonNullable<FundTransactionListQuery['sortBy']>
  readonly sortOrder: NonNullable<FundTransactionListQuery['sortOrder']>
}

export interface FundDirectionState {
  readonly label: '入账' | '出账'
  readonly sign: '+' | '-'
  readonly tone: 'credit' | 'debit'
}

export interface FundReversalPreviewEntry {
  readonly accountTarget: FundPostingBatchEntryDto['accountTarget']
  readonly amount: string
  readonly direction: FundPostingBatchEntryDto['direction']
  readonly originalLineNo: number
}

export interface FundReversalPreview {
  readonly cumulativeReversedAmount: string
  readonly entries: readonly FundReversalPreviewEntry[]
  readonly reversalAmount: string
  readonly reversalBusinessAmount: string
  readonly reversalStatus: 'FULL' | 'PARTIAL'
}

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const FUND_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const FUND_SHARE_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u

/**
 * 页面预览使用独立 Decimal 配置镜像 Server 的 numeric(30,2) 与 HALF_UP；
 * 不修改 decimal.js 全局状态，也不使用 JavaScript number 参与资金计算。
 */
const FundDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
})

function positiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field}无效`)
  }
  return value
}

function optionalUuid(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  if (!UUID_V4_PATTERN.test(normalized)) {
    throw new RangeError(`${field}无效`)
  }
  return normalized
}

function optionalBusinessNo(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalized === '') {
    return undefined
  }
  if ([...normalized].length > 128 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new RangeError('业务单号不能超过 128 个字符且不能包含控制字符')
  }
  return normalized
}

function optionalIsoDate(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`${field}无效`)
  }
  return date.toISOString()
}

/** 只输出 generated query 已声明的字段，空筛选不会发送给 Server。 */
export function buildFundTransactionQuery(
  input: FundTransactionQueryInput,
): FundTransactionListQuery {
  const occurredFrom = optionalIsoDate(input.filters.occurredFrom, '开始时间')
  const occurredTo = optionalIsoDate(input.filters.occurredTo, '结束时间')
  if (
    occurredFrom !== undefined
    && occurredTo !== undefined
    && occurredFrom > occurredTo
  ) {
    throw new RangeError('开始时间不能晚于结束时间')
  }

  const accountId = optionalUuid(input.filters.accountId, '账户')
  const userId = optionalUuid(input.filters.userId, '用户')
  const postingTypeId = optionalUuid(input.filters.postingTypeId, '业务类型')
  const businessSourceId = optionalUuid(
    input.filters.businessSourceId,
    '业务来源',
  )
  const businessNo = optionalBusinessNo(input.filters.businessNo)

  return {
    page: positiveInteger(input.page, '页码', 1_000_000),
    pageSize: positiveInteger(input.pageSize, '每页数量', 100),
    ...(accountId === undefined ? {} : { accountId }),
    ...(userId === undefined ? {} : { userId }),
    ...(postingTypeId === undefined ? {} : { postingTypeId }),
    ...(input.filters.businessCategory === undefined
      ? {}
      : { businessCategory: input.filters.businessCategory }),
    ...(businessSourceId === undefined ? {} : { businessSourceId }),
    ...(input.filters.direction === undefined
      ? {}
      : { direction: input.filters.direction }),
    ...(businessNo === undefined ? {} : { businessNo }),
    ...(occurredFrom === undefined ? {} : { occurredFrom }),
    ...(occurredTo === undefined ? {} : { occurredTo }),
    ...(input.filters.reversalStatus === undefined
      ? {}
      : { reversalStatus: input.filters.reversalStatus }),
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
  }
}

function parsePositiveAmount(value: string, field: string): Decimal {
  if (!FUND_AMOUNT_PATTERN.test(value)) {
    throw new RangeError(`${field}格式无效`)
  }
  const amount = new FundDecimal(value)
  if (!amount.greaterThan(0)) {
    throw new RangeError(`${field}必须大于零`)
  }
  return amount
}

function parseShareRate(value: null | string): Decimal {
  if (value === null || !FUND_SHARE_RATE_PATTERN.test(value)) {
    throw new RangeError('历史分成比例快照无效')
  }
  const rate = new FundDecimal(value)
  if (rate.greaterThan(100)) {
    throw new RangeError('历史分成比例快照无效')
  }
  return rate
}

function targetAmount(
  entry: FundPostingBatchEntryDto,
  cumulativeAmount: Decimal,
  userShareRate: Decimal | null,
): Decimal {
  if (cumulativeAmount.isZero()) {
    return new FundDecimal(0)
  }
  if (entry.amountStrategy === 'FULL_AMOUNT') {
    return cumulativeAmount
  }
  if (userShareRate === null) {
    throw new RangeError('分账冲账缺少历史比例快照')
  }
  const userAmount = cumulativeAmount
    .times(userShareRate)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return entry.amountStrategy === 'USER_SHARE'
    ? userAmount
    : cumulativeAmount.minus(userAmount)
}

function oppositeDirection(
  direction: FundPostingBatchEntryDto['direction'],
): FundPostingBatchEntryDto['direction'] {
  return direction === 'CREDIT' ? 'DEBIT' : 'CREDIT'
}

/**
 * 镜像 Server 的“累计目标 - 已累计目标”算法。最后一次全额冲账直接以原分录
 * 金额为目标，消除多次四舍五入尾差；结果只用于确认，Server 锁内结果仍是账务真相。
 */
export function calculateFundReversalPreview(
  detail: FundPostingBatchDetailDto,
  amount: string,
): FundReversalPreview {
  if (
    detail.kind === 'REVERSAL'
    || detail.reversalOfBatchId !== null
    || detail.entries.length === 0
    || detail.reversalChain.originalBatchId !== detail.id
  ) {
    throw new RangeError('冲账目标无效')
  }

  const originalAmount = parsePositiveAmount(
    detail.reversalChain.originalAmount,
    '原始金额',
  )
  const reversedAmount = new FundDecimal(detail.reversalChain.reversedAmount)
  const remainingAmount = new FundDecimal(detail.reversalChain.remainingAmount)
  const reversalAmount = parsePositiveAmount(amount, '冲账金额')
  if (
    reversedAmount.isNegative()
    || remainingAmount.isNegative()
    || !reversedAmount.plus(remainingAmount).equals(originalAmount)
    || reversalAmount.greaterThan(remainingAmount)
    || !new FundDecimal(detail.businessAmount).abs().equals(originalAmount)
  ) {
    throw new RangeError('冲账额度快照无效')
  }

  const originalEntryTotal = detail.entries.reduce(
    (total, entry) => total.plus(parsePositiveAmount(entry.amount, '原分录金额')),
    new FundDecimal(0),
  )
  if (!originalEntryTotal.equals(originalAmount)) {
    throw new RangeError('原分录金额快照不守恒')
  }

  const usesSplit = detail.entries.some(entry => (
    entry.amountStrategy !== 'FULL_AMOUNT'
  ))
  const userShareRate = usesSplit
    ? parseShareRate(detail.userShareRateSnapshot)
    : null
  const nextCumulative = reversedAmount.plus(reversalAmount)
  const fullReversal = nextCumulative.equals(originalAmount)

  const entries = detail.entries.flatMap<FundReversalPreviewEntry>((entry) => {
    const previousTarget = reversedAmount.equals(originalAmount)
      ? new FundDecimal(entry.amount)
      : targetAmount(entry, reversedAmount, userShareRate)
    const nextTarget = fullReversal
      ? new FundDecimal(entry.amount)
      : targetAmount(entry, nextCumulative, userShareRate)
    const current = nextTarget.minus(previousTarget)
    if (current.isNegative()) {
      throw new RangeError('历史冲账分录快照无效')
    }
    if (current.isZero()) {
      return []
    }
    return [{
      accountTarget: entry.accountTarget,
      amount: current.toFixed(2),
      direction: oppositeDirection(entry.direction),
      originalLineNo: entry.lineNo,
    }]
  })

  const previewTotal = entries.reduce(
    (total, entry) => total.plus(entry.amount),
    new FundDecimal(0),
  )
  if (!previewTotal.equals(reversalAmount)) {
    throw new RangeError('预计冲账分录金额不守恒')
  }

  const originalBusinessAmount = new FundDecimal(detail.businessAmount)
  return Object.freeze({
    cumulativeReversedAmount: nextCumulative.toFixed(2),
    entries: Object.freeze(entries),
    reversalAmount: reversalAmount.toFixed(2),
    reversalBusinessAmount: reversalAmount
      .times(originalBusinessAmount.isPositive() ? -1 : 1)
      .toFixed(2),
    reversalStatus: fullReversal ? 'FULL' : 'PARTIAL',
  })
}

export function canReverseFundBatch(
  detail: FundPostingBatchDetailDto,
  authorized: boolean,
): boolean {
  if (
    !authorized
    || detail.kind === 'REVERSAL'
    || detail.reversalOfBatchId !== null
    || detail.reversalChain.originalBatchId !== detail.id
  ) {
    return false
  }
  try {
    return parsePositiveAmount(
      detail.reversalChain.remainingAmount,
      '剩余额度',
    ).greaterThan(0)
  }
  catch {
    return false
  }
}

export function getFundDirectionState(
  direction: FundTransactionDto['direction'],
): FundDirectionState {
  return direction === 'CREDIT'
    ? Object.freeze({ label: '入账', sign: '+', tone: 'credit' })
    : Object.freeze({ label: '出账', sign: '-', tone: 'debit' })
}

export function getFundBusinessCategoryLabel(
  value: FundTransactionDto['businessCategory'],
): string {
  return {
    ADJUSTMENT: '调账',
    COST: '成本',
    NEUTRAL: '中性',
    REVENUE: '收益',
  }[value]
}

export function getFundBatchKindLabel(
  value: FundTransactionDto['batchKind'] | FundPostingBatchDetailDto['kind'],
): string {
  return {
    BUSINESS: '业务动账',
    MANUAL_ADJUSTMENT: '管理员调账',
    REVERSAL: '冲账批次',
  }[value]
}

export function getFundReversalStatusLabel(
  value: FundTransactionDto['reversalStatus'],
): string {
  return {
    FULL: '已全部冲账',
    NONE: '未冲账',
    NOT_APPLICABLE: '冲账批次',
    PARTIAL: '部分冲账',
  }[value]
}

export function getFundAccountTargetLabel(
  value: FundPostingBatchEntryDto['accountTarget'],
): string {
  return value === 'USER' ? '用户账户' : '公司账户'
}

export function getFundAmountStrategyLabel(
  value: FundPostingBatchEntryDto['amountStrategy'],
): string {
  return {
    COMPANY_REMAINDER: '公司尾差',
    FULL_AMOUNT: '全额',
    USER_SHARE: '用户比例',
  }[value]
}

export function formatFundRateSnapshot(value: null | string): string {
  if (value === null) {
    return '—'
  }
  try {
    return `${parseShareRate(value).toFixed(2)}%`
  }
  catch {
    return value
  }
}
