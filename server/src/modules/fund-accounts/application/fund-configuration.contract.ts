import type {
  FundAmountSignPolicy,
  FundBusinessCategory,
  FundPostingRuleLeg,
  FundRuleInputMode,
} from '../domain'
import type { FundAccountCommandContext } from './fund-account.contract'

export const FUND_CONFIGURATION_SORT_ORDERS = ['asc', 'desc'] as const
export const FUND_POSTING_TYPE_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'code',
  'name',
] as const
export const FUND_BUSINESS_SOURCE_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'code',
  'name',
] as const

export type FundConfigurationCommandContext = FundAccountCommandContext
export type FundConfigurationSortOrder =
  (typeof FUND_CONFIGURATION_SORT_ORDERS)[number]
export type FundPostingTypeSortField =
  (typeof FUND_POSTING_TYPE_SORT_FIELDS)[number]
export type FundBusinessSourceSortField =
  (typeof FUND_BUSINESS_SOURCE_SORT_FIELDS)[number]
export type FundPostingRuleStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED'

export interface FundPostingTypeListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly search?: string
  readonly businessCategory?: FundBusinessCategory
  readonly enabled?: boolean
  readonly sortBy?: FundPostingTypeSortField
  readonly sortOrder?: FundConfigurationSortOrder
}

export interface FundBusinessSourceListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly search?: string
  readonly enabled?: boolean
  readonly sortBy?: FundBusinessSourceSortField
  readonly sortOrder?: FundConfigurationSortOrder
}

export interface FundPostingTypeCreateInput {
  readonly code: string
  readonly name: string
  readonly description?: string | null
  readonly businessCategory: Exclude<FundBusinessCategory, 'ADJUSTMENT'>
  readonly requiresUser: boolean
  readonly amountSignPolicy: FundAmountSignPolicy
  readonly legs: readonly FundPostingRuleLeg[]
}

export interface FundPostingTypeUpdateInput {
  readonly postingTypeId: string
  readonly name: string
  readonly description?: string | null
  readonly expectedVersion: number
}

export interface FundDraftRuleReplaceInput {
  readonly postingTypeId: string
  readonly expectedVersion: number
  readonly legs: readonly FundPostingRuleLeg[]
}

export interface FundPostingRulePublishInput {
  readonly postingTypeId: string
  readonly draftRuleVersionId: string
  readonly expectedVersion: number
}

export interface FundPostingTypeEnabledUpdateInput {
  readonly postingTypeId: string
  readonly enabled: boolean
  readonly expectedVersion: number
}

export interface FundBusinessSourceCreateInput {
  readonly code: string
  readonly name: string
  readonly description?: string | null
  readonly enabled: boolean
  readonly allowedPostingTypeIds: readonly string[]
}

export interface FundBusinessSourceUpdateInput {
  readonly businessSourceId: string
  readonly name: string
  readonly description?: string | null
  readonly allowedPostingTypeIds: readonly string[]
  readonly expectedVersion: number
}

export interface FundBusinessSourceEnabledUpdateInput {
  readonly businessSourceId: string
  readonly enabled: boolean
  readonly expectedVersion: number
}

export interface FundPostingRuleLegView
  extends Omit<FundPostingRuleLeg, 'adjustmentMode'> {
  readonly id: string
  readonly adjustmentMode: FundPostingRuleLeg['adjustmentMode'] | null
}

export interface FundPostingRuleVersionView {
  readonly id: string
  readonly revision: number
  readonly status: FundPostingRuleStatus
  readonly createdByUserId: string | null
  readonly publishedByUserId: string | null
  readonly createdAt: string
  readonly publishedAt: string | null
  readonly legs: readonly FundPostingRuleLegView[]
}

export interface FundPostingTypeView {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly businessCategory: FundBusinessCategory
  readonly requiresUser: boolean
  readonly amountSignPolicy: FundAmountSignPolicy
  readonly inputMode: FundRuleInputMode
  readonly enabled: boolean
  readonly currentRuleVersionId: string | null
  readonly version: number
  readonly activeRule: FundPostingRuleVersionView | null
  readonly draftRule: FundPostingRuleVersionView | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface FundPostingTypePage {
  readonly items: readonly FundPostingTypeView[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface FundBusinessSourceAllowedPostingTypeView {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly businessCategory: FundBusinessCategory
  readonly enabled: boolean
  readonly allowedAt: string
}

export interface FundBusinessSourceView {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly enabled: boolean
  readonly version: number
  readonly allowedPostingTypes: readonly FundBusinessSourceAllowedPostingTypeView[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface FundBusinessSourcePage {
  readonly items: readonly FundBusinessSourceView[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface FundPostingTypeMutationResult {
  readonly changed: boolean
  readonly postingType: FundPostingTypeView
}

export interface FundBusinessSourceMutationResult {
  readonly changed: boolean
  readonly businessSource: FundBusinessSourceView
}
