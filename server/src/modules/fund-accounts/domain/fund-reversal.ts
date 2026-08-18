import {
  FUND_CALCULATION_ERROR_CODES,
  FundCalculationError,
} from './fund-calculation.errors'
import {
  formatFundMinor,
  parseFundAmountMinor,
  parseFundShareRateUnits,
  splitFundMinorByShare,
} from './fund-decimal'
import type {
  FundAccountTarget,
  FundAmountStrategy,
  FundEntryDirection,
} from './fund-rule.types'

export type FundReversibleBatchKind =
  | 'BUSINESS'
  | 'MANUAL_ADJUSTMENT'
  | 'REVERSAL'

export interface FundOriginalEntryForReversal {
  readonly originalLineNo: number
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
  readonly reversedAmount: string
}

export interface CalculateFundReversalInput {
  readonly originalBatchKind: FundReversibleBatchKind
  readonly originalBusinessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly entries: readonly FundOriginalEntryForReversal[]
  readonly reversalAmount: string
}

export interface FundReversalEntry {
  readonly originalLineNo: number
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
}

export interface FundReversalPlan {
  readonly reversalBusinessAmount: string
  readonly cumulativeReversedAmount: string
  readonly reversalState: 'PARTIAL' | 'FULL'
  readonly entries: readonly FundReversalEntry[]
}

function invalidTarget(): never {
  throw new FundCalculationError(
    FUND_CALCULATION_ERROR_CODES.REVERSAL_TARGET_INVALID,
    '冲账目标无效',
  )
}

function invalidSnapshot(): never {
  throw new FundCalculationError(
    FUND_CALCULATION_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID,
    '冲账快照无效',
  )
}

function oppositeDirection(direction: FundEntryDirection): FundEntryDirection {
  return direction === 'CREDIT' ? 'DEBIT' : 'CREDIT'
}

function targetAmountForEntry(
  entry: FundOriginalEntryForReversal,
  cumulativeAmountMinor: bigint,
  shareRateUnits: bigint | null,
): bigint {
  // 尚未发生冲账时所有分录的累计目标都是零，无需进入“正数金额”分账函数。
  if (cumulativeAmountMinor === 0n) return 0n
  if (entry.amountStrategy === 'FULL_AMOUNT') return cumulativeAmountMinor
  if (shareRateUnits === null) return invalidSnapshot()

  const split = splitFundMinorByShare(cumulativeAmountMinor, shareRateUnits)
  return entry.amountStrategy === 'USER_SHARE'
    ? split.userAmount
    : split.companyAmount
}

/**
 * 校验不可变原分录和已经冲账的累计快照。只有快照与同一累计目标完全一致时，
 * 才允许计算下一次差额，防止损坏数据或并发旧读继续产生资金分录。
 */
function validatePreviousCumulativeTargets(
  entries: readonly FundOriginalEntryForReversal[],
  previousCumulativeMinor: bigint,
  originalTotalMinor: bigint,
  shareRateUnits: bigint | null,
): void {
  for (const entry of entries) {
    const originalEntryMinor = parseFundAmountMinor(entry.amount)
    const reversedEntryMinor = parseFundAmountMinor(entry.reversedAmount)
    if (
      originalEntryMinor <= 0n
      || reversedEntryMinor < 0n
      || reversedEntryMinor > originalEntryMinor
    ) {
      return invalidSnapshot()
    }

    const expected = previousCumulativeMinor === originalTotalMinor
      ? originalEntryMinor
      : targetAmountForEntry(entry, previousCumulativeMinor, shareRateUnits)
    if (reversedEntryMinor !== expected) return invalidSnapshot()
  }
}

export function calculateFundReversal(
  input: CalculateFundReversalInput,
): FundReversalPlan {
  if (
    input.originalBatchKind === 'REVERSAL'
    || input.entries.length === 0
  ) {
    return invalidTarget()
  }

  const originalBusinessAmountMinor = parseFundAmountMinor(
    input.originalBusinessAmount,
  )
  if (originalBusinessAmountMinor === 0n) return invalidTarget()

  const reversalAmountMinor = parseFundAmountMinor(input.reversalAmount)
  if (reversalAmountMinor <= 0n) return invalidTarget()

  const originalTotalMinor = originalBusinessAmountMinor < 0n
    ? -originalBusinessAmountMinor
    : originalBusinessAmountMinor
  const lineNumbers = new Set<number>()
  const accountTargets = new Set<FundAccountTarget>()

  let originalEntryTotalMinor = 0n
  let previousCumulativeMinor = 0n
  for (const entry of input.entries) {
    if (
      !Number.isInteger(entry.originalLineNo)
      || entry.originalLineNo < 1
      || lineNumbers.has(entry.originalLineNo)
      || accountTargets.has(entry.accountTarget)
      || !['USER', 'COMPANY'].includes(entry.accountTarget)
      || !['CREDIT', 'DEBIT'].includes(entry.direction)
      || !['FULL_AMOUNT', 'USER_SHARE', 'COMPANY_REMAINDER']
        .includes(entry.amountStrategy)
      || (
        entry.amountStrategy === 'USER_SHARE'
        && entry.accountTarget !== 'USER'
      )
      || (
        entry.amountStrategy === 'COMPANY_REMAINDER'
        && entry.accountTarget !== 'COMPANY'
      )
    ) {
      return invalidSnapshot()
    }

    lineNumbers.add(entry.originalLineNo)
    accountTargets.add(entry.accountTarget)
    originalEntryTotalMinor += parseFundAmountMinor(entry.amount)
    previousCumulativeMinor += parseFundAmountMinor(entry.reversedAmount)
  }
  if (originalEntryTotalMinor !== originalTotalMinor) return invalidSnapshot()

  const usesSplit = input.entries.some(
    (entry) => entry.amountStrategy !== 'FULL_AMOUNT',
  )
  const shareRateUnits = usesSplit
    ? parseFundShareRateUnits(input.userShareRateSnapshot)
    : null

  validatePreviousCumulativeTargets(
    input.entries,
    previousCumulativeMinor,
    originalTotalMinor,
    shareRateUnits,
  )

  const nextCumulativeMinor = previousCumulativeMinor + reversalAmountMinor
  if (nextCumulativeMinor > originalTotalMinor) {
    throw new FundCalculationError(
      FUND_CALCULATION_ERROR_CODES.REVERSAL_EXCEEDS_REMAINING,
      '冲账金额超过剩余额度',
    )
  }

  const fullReversal = nextCumulativeMinor === originalTotalMinor
  const entries = input.entries.flatMap<FundReversalEntry>((entry) => {
    const originalEntryMinor = parseFundAmountMinor(entry.amount)
    const reversedEntryMinor = parseFundAmountMinor(entry.reversedAmount)
    const targetMinor = fullReversal
      ? originalEntryMinor
      : targetAmountForEntry(entry, nextCumulativeMinor, shareRateUnits)
    const currentAmountMinor = targetMinor - reversedEntryMinor
    if (currentAmountMinor < 0n) return invalidSnapshot()
    if (currentAmountMinor === 0n) return []

    return [{
      originalLineNo: entry.originalLineNo,
      accountTarget: entry.accountTarget,
      direction: oppositeDirection(entry.direction),
      amountStrategy: entry.amountStrategy,
      amount: formatFundMinor(currentAmountMinor),
    }]
  })

  const reversalEntryTotalMinor = entries.reduce(
    (total, entry) => total + parseFundAmountMinor(entry.amount),
    0n,
  )
  if (reversalEntryTotalMinor !== reversalAmountMinor) return invalidSnapshot()

  return {
    reversalBusinessAmount: formatFundMinor(
      originalBusinessAmountMinor > 0n
        ? -reversalAmountMinor
        : reversalAmountMinor,
    ),
    cumulativeReversedAmount: formatFundMinor(nextCumulativeMinor),
    reversalState: fullReversal ? 'FULL' : 'PARTIAL',
    entries,
  }
}
