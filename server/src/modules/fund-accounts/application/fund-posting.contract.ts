import type { Prisma } from '../../../generated/prisma/client'
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

export interface FundBusinessTransactionContext extends FundPostingContext {
  readonly actorUserId: string
}

export interface FundPostingExpectedContext {
  readonly ruleVersionId: string
  readonly userShareRate: string
}

export interface FundPostingPreview extends FundPostingExpectedContext {
  readonly companyShareRate: string
  readonly businessAmount: string
  readonly entries: readonly Pick<FundPostingResultEntry, 'accountTarget' | 'direction' | 'amount'>[]
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
 * 同一 Server 内业务域唯一可依赖的资金动账端口。销售收款、包装与采购付款
 * 复用调用方事务，保证业务状态、资金和审计同时提交；管理员能力留在资金模块。
 * 采购 STOCK_PAY 不传 userId，资金模块只锁公司账户并按有效 0/100 比例执行
 * 已发布的 PURCHASE_PAYMENT 分摊规则；PAY 必须传销售出单人的身份快照。
 * 采购 VOID 仅允许全额冲正原始批次，由调用方同步作废对应的实际付款记录。
 */
export abstract class FundPostingService {
  abstract lockBusinessEventAccountsInTransaction(
    transaction: Prisma.TransactionClient,
    entries: readonly { context: FundBusinessTransactionContext, input: PostBusinessEventInput }[],
  ): Promise<void>

  abstract previewBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: PostBusinessEventInput,
  ): Promise<FundPostingPreview>

  abstract postBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: PostBusinessEventInput,
    expectedContext: FundPostingExpectedContext,
  ): Promise<FundPostingResult>

  abstract reverseBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: FundReversalInput,
  ): Promise<FundPostingResult>

  abstract postBusinessEvent(
    context: FundPostingContext,
    input: PostBusinessEventInput,
  ): Promise<FundPostingResult>
}
