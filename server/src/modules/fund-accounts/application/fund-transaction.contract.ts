import type {
  FundAccountTarget,
  FundAdjustmentMode,
  FundAmountStrategy,
  FundBusinessCategory,
  FundEntryDirection,
} from '../domain'
import type {
  FundAccountOwnerType,
  FundAccountSortOrder,
  FundAccountUserView,
} from './fund-account.contract'
import type { FundMetadata } from './fund-posting.contract'

export const FUND_TRANSACTION_REVERSAL_STATUSES = [
  'NONE',
  'PARTIAL',
  'FULL',
  'NOT_APPLICABLE',
] as const
export const FUND_TRANSACTION_SORT_FIELDS = [
  'postedAt',
  'businessOccurredAt',
  'amount',
] as const

export type FundTransactionReversalStatus =
  (typeof FUND_TRANSACTION_REVERSAL_STATUSES)[number]
export type FundTransactionSortField =
  (typeof FUND_TRANSACTION_SORT_FIELDS)[number]
export type FundPostingBatchKind =
  'BUSINESS' | 'MANUAL_ADJUSTMENT' | 'REVERSAL'

export interface FundTransactionListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly accountId?: string
  readonly userId?: string
  readonly postingTypeId?: string
  readonly businessCategory?: FundBusinessCategory
  readonly businessSourceId?: string
  readonly direction?: FundEntryDirection
  readonly businessNo?: string
  readonly occurredFrom?: string
  readonly occurredTo?: string
  readonly reversalStatus?: FundTransactionReversalStatus
  readonly sortBy?: FundTransactionSortField
  readonly sortOrder?: FundAccountSortOrder
}

export interface FundTransactionAccountView {
  readonly id: string
  readonly ownerType: FundAccountOwnerType
  readonly user: FundAccountUserView | null
}

export interface FundTransactionView {
  readonly entryId: string
  readonly batchId: string
  readonly batchNo: string
  readonly batchKind: FundPostingBatchKind
  readonly account: FundTransactionAccountView
  readonly accountTarget: FundAccountTarget
  readonly postingTypeId: string
  readonly postingTypeCode: string
  readonly postingTypeName: string
  readonly businessCategory: FundBusinessCategory
  readonly businessSourceId: string
  readonly businessSourceCode: string
  readonly businessSourceName: string
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly accountSequence: string
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly businessId: string
  readonly businessNo: string | null
  readonly summary: string
  readonly businessOccurredAt: string
  readonly adjustmentMode: FundAdjustmentMode | null
  readonly reversalOfBatchId: string | null
  readonly reversalStatus: FundTransactionReversalStatus
  readonly postedAt: string
}

export interface FundTransactionPage {
  readonly items: readonly FundTransactionView[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

/**
 * 运营本人流水只开放方向、业务发生时间与业务类型三个筛选维度。
 *
 * accountId 与 userId 由服务端按会话解析，不属于客户端可传入的范围。
 */
export interface FundSelfTransactionListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly direction?: FundEntryDirection
  readonly occurredFrom?: string
  readonly occurredTo?: string
  readonly postingTypeId?: string
  readonly sortBy?: FundTransactionSortField
  readonly sortOrder?: FundAccountSortOrder
}

/**
 * 运营本人流水视图：来源说明随行返回，公司比例、内部批次/账户标识与
 * 规则金额策略不下发。
 */
export interface FundSelfTransactionView {
  readonly entryId: string
  readonly batchNo: string
  readonly batchKind: FundPostingBatchKind
  readonly postingTypeId: string
  readonly postingTypeName: string
  readonly businessCategory: FundBusinessCategory
  readonly businessSourceName: string
  readonly direction: FundEntryDirection
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly accountSequence: string
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly businessNo: string | null
  readonly summary: string
  readonly businessOccurredAt: string
  readonly reversalStatus: FundTransactionReversalStatus
  readonly postedAt: string
}

export interface FundSelfTransactionPage {
  readonly items: readonly FundSelfTransactionView[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

/** 本人流水出现过的业务类型，供运营端筛选下拉使用。 */
export interface FundSelfPostingTypeOption {
  readonly id: string
  readonly name: string
}

export interface FundSelfPostingTypeOptionList {
  readonly items: readonly FundSelfPostingTypeOption[]
}

export interface FundPostingBatchEntryView {
  readonly entryId: string
  readonly lineNo: number
  readonly account: FundTransactionAccountView
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly accountSequence: string
  readonly postedAt: string
}

export interface FundPostingBatchReversalView {
  readonly batchId: string
  readonly batchNo: string
  readonly amount: string
  readonly reason: string
  readonly actorUserId: string
  readonly actorDisplayName: string
  readonly actorAvatarUrl: string | null
  readonly postedAt: string
}

export interface FundPostingBatchReversalChainView {
  readonly originalBatchId: string
  readonly originalBatchNo: string
  readonly status: Exclude<FundTransactionReversalStatus, 'NOT_APPLICABLE'>
  readonly originalAmount: string
  readonly reversedAmount: string
  readonly remainingAmount: string
  readonly reversals: readonly FundPostingBatchReversalView[]
}

export interface FundPostingBatchDetailView {
  readonly id: string
  readonly batchNo: string
  readonly kind: FundPostingBatchKind
  readonly postingTypeId: string
  readonly postingTypeCode: string
  readonly postingTypeName: string
  readonly businessCategory: FundBusinessCategory
  readonly businessSourceId: string
  readonly businessSourceCode: string
  readonly businessSourceName: string
  readonly ruleVersionId: string
  readonly ruleRevision: number
  readonly user: FundAccountUserView | null
  readonly businessAmount: string
  readonly currency: 'CNY'
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly businessId: string
  readonly businessNo: string | null
  readonly summary: string
  readonly metadata: FundMetadata
  readonly businessOccurredAt: string
  readonly adjustmentMode: FundAdjustmentMode | null
  readonly reversalOfBatchId: string | null
  readonly reversalReason: string | null
  readonly actorUserId: string | null
  readonly requestId: string
  readonly correlationId: string | null
  readonly postedAt: string
  readonly entries: readonly FundPostingBatchEntryView[]
  readonly reversalChain: FundPostingBatchReversalChainView
}
