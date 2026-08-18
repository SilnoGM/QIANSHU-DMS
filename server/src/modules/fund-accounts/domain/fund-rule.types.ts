export const FUND_ACCOUNT_TARGETS = ['USER', 'COMPANY'] as const
export const FUND_ENTRY_DIRECTIONS = ['CREDIT', 'DEBIT'] as const
export const FUND_DIRECTION_POLICIES = [
  'CREDIT',
  'DEBIT',
  'FOLLOW_AMOUNT_SIGN',
] as const
export const FUND_AMOUNT_STRATEGIES = [
  'FULL_AMOUNT',
  'USER_SHARE',
  'COMPANY_REMAINDER',
] as const
export const FUND_ADJUSTMENT_MODES = [
  'USER_ONLY',
  'USER_AND_COMPANY_BY_SHARE',
] as const
export const FUND_AMOUNT_SIGN_POLICIES = [
  'POSITIVE_ONLY',
  'NON_ZERO_SIGNED',
] as const
export const FUND_RULE_INPUT_MODES = [
  'STANDARD',
  'ADMIN_ADJUSTMENT',
] as const
export const FUND_BUSINESS_CATEGORIES = [
  'REVENUE',
  'COST',
  'NEUTRAL',
  'ADJUSTMENT',
] as const

export type FundAccountTarget = (typeof FUND_ACCOUNT_TARGETS)[number]
export type FundEntryDirection = (typeof FUND_ENTRY_DIRECTIONS)[number]
export type FundDirectionPolicy = (typeof FUND_DIRECTION_POLICIES)[number]
export type FundAmountStrategy = (typeof FUND_AMOUNT_STRATEGIES)[number]
export type FundAdjustmentMode = (typeof FUND_ADJUSTMENT_MODES)[number]
export type FundAmountSignPolicy = (typeof FUND_AMOUNT_SIGN_POLICIES)[number]
export type FundRuleInputMode = (typeof FUND_RULE_INPUT_MODES)[number]
export type FundBusinessCategory = (typeof FUND_BUSINESS_CATEGORIES)[number]

export interface FundPostingRuleLeg {
  readonly position: number
  readonly accountTarget: FundAccountTarget
  readonly directionPolicy: FundDirectionPolicy
  readonly amountStrategy: FundAmountStrategy
  readonly adjustmentMode?: FundAdjustmentMode
}

export interface FundPostingRule {
  readonly postingTypeCode: string
  readonly businessCategory: FundBusinessCategory
  readonly amountSignPolicy: FundAmountSignPolicy
  readonly requiresUser: boolean
  readonly inputMode: FundRuleInputMode
  readonly legs: readonly FundPostingRuleLeg[]
}

export interface CalculateFundPostingPlanInput {
  readonly rule: FundPostingRule
  readonly amount: string
  readonly userShareRate?: string
  readonly adjustmentMode?: FundAdjustmentMode
}

export interface FundPostingPlanEntry {
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
}

export interface FundPostingPlan {
  readonly businessAmount: string
  readonly userShareRate: string | null
  readonly companyShareRate: string | null
  readonly entries: readonly FundPostingPlanEntry[]
}
