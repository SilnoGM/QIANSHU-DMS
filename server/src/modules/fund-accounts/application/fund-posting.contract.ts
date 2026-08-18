import type {
  FundAccountTarget,
  FundAdjustmentMode,
  FundBusinessCategory,
  FundEntryDirection,
} from '../domain'

export type FundMetadataValue = string | number | boolean | null
export type FundMetadata = Readonly<Record<string, FundMetadataValue>>

export interface FundPostingContext {
  readonly consumerCode: string
  readonly sourceCode: string
  readonly requestId: string
  readonly correlationId?: string
}

export interface PostBusinessEventInput {
  readonly postingTypeCode: string
  readonly userId?: string
  readonly amount: string
  readonly businessId: string
  readonly businessNo?: string
  readonly summary: string
  readonly metadata?: FundMetadata
  readonly businessOccurredAt?: string
  readonly idempotencyKey: string
}

export interface FundManualAdjustmentInput {
  readonly userAccountId: string
  readonly amount: string
  readonly adjustmentMode: FundAdjustmentMode
  readonly reason: string
  readonly metadata?: FundMetadata
  readonly idempotencyKey: string
}

export interface FundReversalInput {
  readonly originalBatchId: string
  readonly amount: string
  readonly reason: string
  readonly idempotencyKey: string
}

export interface FundPostingResultEntry {
  readonly entryId: string
  readonly accountId: string
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly accountSequence: string
}

export interface FundPostingResult {
  readonly batchId: string
  readonly postingTypeCode: string
  readonly businessCategory: FundBusinessCategory
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly entries: readonly FundPostingResultEntry[]
  readonly postedAt: string
  readonly idempotentReplay: boolean
}

/**
 * 同一 Server 内业务域唯一可依赖的资金动账端口。Task 4 只冻结契约；具体事务、
 * 账户解析和流水写入由后续统一动账引擎实现。
 */
export abstract class FundPostingService {
  abstract postBusinessEvent(
    context: FundPostingContext,
    input: PostBusinessEventInput,
  ): Promise<FundPostingResult>
}
