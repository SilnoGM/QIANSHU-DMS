import {
  FUND_CALCULATION_ERROR_CODES,
  FundCalculationError,
} from './fund-calculation.errors'
import {
  calculateCompanyShareRateUnits,
  formatFundMinor,
  formatFundShareRateUnits,
  parseFundAmountMinor,
  parseFundShareRateUnits,
  splitFundMinorByShare,
} from './fund-decimal'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_SIGN_POLICIES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_DIRECTION_POLICIES,
  FUND_RULE_INPUT_MODES,
  type CalculateFundPostingPlanInput,
  type FundDirectionPolicy,
  type FundEntryDirection,
  type FundPostingPlan,
  type FundPostingPlanEntry,
  type FundPostingRule,
  type FundPostingRuleLeg,
} from './fund-rule.types'

export * from './fund-initial-rules'
export * from './fund-rule.types'

const POSTING_TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u

function invalidRule(): never {
  throw new FundCalculationError(
    FUND_CALCULATION_ERROR_CODES.POSTING_RULE_INVALID,
    '资金动账规则无效',
  )
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateLeg(value: unknown): FundPostingRuleLeg {
  if (!isRecord(value)) return invalidRule()
  if (!Number.isInteger(value.position) || Number(value.position) < 1) {
    return invalidRule()
  }
  if (!isOneOf(value.accountTarget, FUND_ACCOUNT_TARGETS)) {
    return invalidRule()
  }
  if (!isOneOf(value.directionPolicy, FUND_DIRECTION_POLICIES)) {
    return invalidRule()
  }
  if (!isOneOf(value.amountStrategy, FUND_AMOUNT_STRATEGIES)) {
    return invalidRule()
  }
  if (
    value.adjustmentMode !== undefined
    && !isOneOf(value.adjustmentMode, FUND_ADJUSTMENT_MODES)
  ) {
    return invalidRule()
  }

  return value as unknown as FundPostingRuleLeg
}

function validateConservingGroup(
  legs: readonly FundPostingRuleLeg[],
): void {
  const targets = new Set(legs.map((leg) => leg.accountTarget))
  if (targets.size !== legs.length) return invalidRule()

  const fullAmountLegs = legs.filter(
    (leg) => leg.amountStrategy === 'FULL_AMOUNT',
  )
  if (fullAmountLegs.length === 1 && legs.length === 1) return

  if (
    legs.length !== 2
    || fullAmountLegs.length !== 0
    || !legs.some((leg) => (
      leg.accountTarget === 'USER'
      && leg.amountStrategy === 'USER_SHARE'
    ))
    || !legs.some((leg) => (
      leg.accountTarget === 'COMPANY'
      && leg.amountStrategy === 'COMPANY_REMAINDER'
    ))
  ) {
    return invalidRule()
  }
}

/**
 * 发布规则前执行与持久化无关的语义校验。每个可选择模板都必须独立守恒，
 * 有符号规则必须由金额符号决定方向，避免调用方通过负数绕过业务含义。
 */
export function validateFundPostingRule(input: unknown): FundPostingRule {
  if (!isRecord(input)) return invalidRule()
  if (
    typeof input.postingTypeCode !== 'string'
    || !POSTING_TYPE_CODE_PATTERN.test(input.postingTypeCode)
    || !isOneOf(input.businessCategory, FUND_BUSINESS_CATEGORIES)
    || !isOneOf(input.amountSignPolicy, FUND_AMOUNT_SIGN_POLICIES)
    || typeof input.requiresUser !== 'boolean'
    || !isOneOf(input.inputMode, FUND_RULE_INPUT_MODES)
    || !Array.isArray(input.legs)
    || input.legs.length === 0
    || input.legs.length > 8
  ) {
    return invalidRule()
  }

  const legs = input.legs.map(validateLeg)
  const positions = [...legs].map((leg) => leg.position).sort((a, b) => a - b)
  if (
    positions.some((position, index) => position !== index + 1)
    || new Set(positions).size !== positions.length
  ) {
    return invalidRule()
  }

  const hasUserTarget = legs.some((leg) => leg.accountTarget === 'USER')
  if (input.requiresUser !== hasUserTarget) return invalidRule()

  if (
    input.amountSignPolicy === 'NON_ZERO_SIGNED'
    && legs.some((leg) => leg.directionPolicy !== 'FOLLOW_AMOUNT_SIGN')
  ) {
    return invalidRule()
  }

  if (input.inputMode === 'STANDARD') {
    if (legs.some((leg) => leg.adjustmentMode !== undefined)) {
      return invalidRule()
    }
    validateConservingGroup(legs)
  } else {
    if (
      input.amountSignPolicy !== 'NON_ZERO_SIGNED'
      || legs.some((leg) => leg.adjustmentMode === undefined)
    ) {
      return invalidRule()
    }

    for (const mode of FUND_ADJUSTMENT_MODES) {
      const modeLegs = legs.filter((leg) => leg.adjustmentMode === mode)
      if (modeLegs.length === 0) return invalidRule()
      validateConservingGroup(modeLegs)
    }

    const userOnlyLegs = legs.filter(
      (leg) => leg.adjustmentMode === 'USER_ONLY',
    )
    if (
      userOnlyLegs.length !== 1
      || userOnlyLegs[0].accountTarget !== 'USER'
      || userOnlyLegs[0].amountStrategy !== 'FULL_AMOUNT'
    ) {
      return invalidRule()
    }
  }

  return input as unknown as FundPostingRule
}

function followDirection(
  policy: FundDirectionPolicy,
  businessAmountMinor: bigint,
): FundEntryDirection {
  if (policy === 'CREDIT' || policy === 'DEBIT') return policy
  return businessAmountMinor > 0n ? 'CREDIT' : 'DEBIT'
}

export function calculateFundPostingPlan(
  input: CalculateFundPostingPlanInput,
): FundPostingPlan {
  const rule = validateFundPostingRule(input.rule)
  const businessAmountMinor = parseFundAmountMinor(input.amount)

  if (
    rule.amountSignPolicy === 'POSITIVE_ONLY'
    && businessAmountMinor <= 0n
  ) {
    throw new FundCalculationError(
      FUND_CALCULATION_ERROR_CODES.POSTING_AMOUNT_INVALID,
      '业务金额必须大于零',
    )
  }
  if (
    rule.amountSignPolicy === 'NON_ZERO_SIGNED'
    && businessAmountMinor === 0n
  ) {
    throw new FundCalculationError(
      FUND_CALCULATION_ERROR_CODES.POSTING_AMOUNT_INVALID,
      '业务金额必须为非零值',
    )
  }

  let userShareRateUnits: bigint | null = null
  if (rule.requiresUser) {
    userShareRateUnits = parseFundShareRateUnits(input.userShareRate)
  } else if (input.userShareRate !== undefined) {
    return invalidRule()
  }

  let selectedLegs: readonly FundPostingRuleLeg[]
  if (rule.inputMode === 'ADMIN_ADJUSTMENT') {
    if (!isOneOf(input.adjustmentMode, FUND_ADJUSTMENT_MODES)) {
      throw new FundCalculationError(
        FUND_CALCULATION_ERROR_CODES.ADJUSTMENT_MODE_INVALID,
        '管理员调账模式无效',
      )
    }
    selectedLegs = rule.legs.filter(
      (leg) => leg.adjustmentMode === input.adjustmentMode,
    )
  } else {
    if (input.adjustmentMode !== undefined) {
      throw new FundCalculationError(
        FUND_CALCULATION_ERROR_CODES.ADJUSTMENT_MODE_INVALID,
        '管理员调账模式无效',
      )
    }
    selectedLegs = rule.legs
  }

  const absoluteAmountMinor = businessAmountMinor < 0n
    ? -businessAmountMinor
    : businessAmountMinor
  const split = userShareRateUnits === null
    ? null
    : splitFundMinorByShare(absoluteAmountMinor, userShareRateUnits)

  const entries = selectedLegs.flatMap<FundPostingPlanEntry>((leg) => {
    let amountMinor: bigint
    if (leg.amountStrategy === 'FULL_AMOUNT') {
      amountMinor = absoluteAmountMinor
    } else if (leg.amountStrategy === 'USER_SHARE') {
      if (!split) return invalidRule()
      amountMinor = split.userAmount
    } else {
      if (!split) return invalidRule()
      amountMinor = split.companyAmount
    }

    if (amountMinor === 0n) return []
    return [{
      accountTarget: leg.accountTarget,
      direction: followDirection(leg.directionPolicy, businessAmountMinor),
      amountStrategy: leg.amountStrategy,
      amount: formatFundMinor(amountMinor),
    }]
  })

  const plannedTotal = entries.reduce(
    (total, entry) => total + parseFundAmountMinor(entry.amount),
    0n,
  )
  if (plannedTotal !== absoluteAmountMinor) return invalidRule()

  return {
    businessAmount: formatFundMinor(businessAmountMinor),
    userShareRate: userShareRateUnits === null
      ? null
      : formatFundShareRateUnits(userShareRateUnits),
    companyShareRate: userShareRateUnits === null
      ? null
      : formatFundShareRateUnits(
        calculateCompanyShareRateUnits(userShareRateUnits),
      ),
    entries,
  }
}
