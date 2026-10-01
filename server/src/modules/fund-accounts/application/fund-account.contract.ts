export const FUND_ACCOUNT_OWNER_TYPES = ['USER', 'COMPANY'] as const
export const FUND_ACCOUNT_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'balance',
  'userShareRate',
] as const

export type FundAccountOwnerType = (typeof FUND_ACCOUNT_OWNER_TYPES)[number]
export type FundAccountSortField = (typeof FUND_ACCOUNT_SORT_FIELDS)[number]
export type FundAccountSortOrder = 'asc' | 'desc'
export type FundAccountUserStatus = 'ACTIVE' | 'DISABLED'

export interface FundAccountCommandContext {
  readonly actorUserId: string
  readonly requestId: string
  readonly correlationId?: string
}

export interface FundAccountListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly search?: string
  readonly ownerType?: FundAccountOwnerType
  readonly sortBy?: FundAccountSortField
  readonly sortOrder?: FundAccountSortOrder
}

export interface FundAccountCreateInput {
  readonly userId: string
  readonly userShareRate: string
}

export interface FundAccountShareRateUpdateInput {
  readonly accountId: string
  readonly userShareRate: string
  readonly expectedVersion: number
  readonly reason: string
}

export interface FundAccountUserView {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly status: FundAccountUserStatus
}

export interface FundAccountView {
  readonly id: string
  readonly ownerType: FundAccountOwnerType
  readonly user: FundAccountUserView | null
  readonly currency: 'CNY'
  readonly balance: string
  readonly userShareRate: string | null
  readonly companyShareRate: string | null
  readonly version: number
  readonly shareRateUpdatedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface FundAccountPage {
  readonly items: readonly FundAccountView[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

/**
 * 新建账户的候选归属人：还没有 USER 账户的用户。
 *
 * 该读取专供资金域的下拉选择，字段与 FundAccountUserView 一致，
 * 使资金域不必依赖用户管理的读取权限。
 */
export interface FundAccountOwnerCandidates {
  readonly items: readonly FundAccountUserView[]
}

export interface FundAccountShareRateUpdateResult {
  readonly changed: boolean
  readonly account: FundAccountView
}
