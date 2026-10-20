import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import type { DataScope } from '../access-control/data-scope'
import { DataScopeService, dataScopeFallback } from '../access-control/data-scope.service'
import { AuditService } from '../audit/audit.service'
import { FundPostingService } from '../fund-accounts/application/fund-posting.contract'
import {
  FUND_WITHDRAWAL_APPROVE_CONSUMER,
  FUND_WITHDRAWAL_FUND_SOURCE,
  FUND_WITHDRAWAL_POSTING_TYPE,
  FUND_WITHDRAWAL_SUMMARY,
} from '../fund-accounts/application/fund-withdrawal'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  FUND_WITHDRAWAL_NO_CONSUMER_CODE,
  FUND_WITHDRAWAL_NO_RULE_CODE,
} from './fund-withdrawal.contract'
import { FundWithdrawalDocumentService } from './fund-withdrawal-document.service'
import {
  FUND_WITHDRAWAL_ERROR_CODES,
  fundWithdrawalFailure,
  mapFundWithdrawalError,
} from './fund-withdrawal.errors'
import type {
  ApproveFundWithdrawalDto,
  CreateFundWithdrawalDto,
  FundWithdrawalDto,
  RejectFundWithdrawalDto,
} from './fund-withdrawal.dto'
import {
  hashFundWithdrawalNumberFingerprint,
  hashFundWithdrawalRequestKey,
  normalizeFundWithdrawalAmount,
  requireFundWithdrawalRequestKey,
} from './fund-withdrawal.logic'
import { FundWithdrawalQueryService } from './fund-withdrawal-query.service'

export interface FundWithdrawalCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

@Injectable()
export class FundWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: FundWithdrawalQueryService,
    private readonly documents: FundWithdrawalDocumentService,
    private readonly funds: FundPostingService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  /**
   * 提交只产生 PENDING 记录，不扣款，也不做余额下限校验：账户允许负余额，
   * 是否扣款完全取决于财务审批。同一用户复用幂等键时恢复原记录。
   */
  async submit(
    context: FundWithdrawalCommandContext,
    input: CreateFundWithdrawalDto,
    key: unknown,
  ): Promise<FundWithdrawalDto> {
    let requestKey: string
    let amount: string
    try {
      requestKey = requireFundWithdrawalRequestKey(key)
      amount = normalizeFundWithdrawalAmount(input.amount)
    }
    catch {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.AMOUNT_INVALID,
        '提款金额或幂等键无效',
        422,
      )
    }

    try {
      const id = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await transaction.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${['fund-withdrawal.create:', context.actorUserId, ':', requestKey].join('')}, 0)
          )
        `)
        const requestKeyHash = hashFundWithdrawalRequestKey(requestKey)
        const previous = await transaction.fundWithdrawalRequest.findUnique({
          where: {
            userId_requestKeyHash: {
              userId: context.actorUserId,
              requestKeyHash,
            },
          },
          select: { id: true, amount: true },
        })
        if (previous !== null) {
          if (previous.amount.toFixed(2) !== amount) {
            fundWithdrawalFailure(
              FUND_WITHDRAWAL_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              '同一个幂等键已用于不同的提款金额',
              409,
            )
          }
          return previous.id
        }

        const account = await transaction.fundAccount.findFirst({
          where: {
            ownerType: 'USER',
            userId: context.actorUserId,
          },
          select: { id: true },
        })
        if (account === null) {
          fundWithdrawalFailure(
            FUND_WITHDRAWAL_ERROR_CODES.ACCOUNT_UNAVAILABLE,
            '当前用户还没有可用的资金账户，请联系财务开户',
            409,
          )
        }

        const issuance = await this.numbering.generateScopedInTransaction(
          transaction,
          {
            ruleCode: FUND_WITHDRAWAL_NO_RULE_CODE,
            consumerCode: FUND_WITHDRAWAL_NO_CONSUMER_CODE,
            idempotencyKey: [context.actorUserId, ':', requestKey].join(''),
            requestFingerprint: hashFundWithdrawalNumberFingerprint({
              accountId: account.id,
              amount,
              userId: context.actorUserId,
              requestKey,
            }),
          },
        )
        const created = await transaction.fundWithdrawalRequest.create({
          data: {
            withdrawalNo: issuance.number,
            numberingIssuanceId: issuance.issuanceId,
            userId: context.actorUserId,
            accountId: account.id,
            amount: new Prisma.Decimal(amount),
            status: 'PENDING',
            requestKeyHash,
          },
          select: { id: true, withdrawalNo: true },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.FUND_WITHDRAWAL_SUBMITTED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'FUND_WITHDRAWAL_REQUEST',
          targetId: created.id,
          metadata: {
            amount,
            withdrawalNo: created.withdrawalNo,
          },
        })
        return created.id
      }, { timeout: 60_000 })
      return await this.queries.getOwn(context.actorUserId, id)
    }
    catch (error) {
      return mapFundWithdrawalError(error)
    }
  }

  /** 拒绝：只改状态与原因，不触碰资金；与通过一样受行锁和版本号保护。 */
  async reject(
    context: FundWithdrawalCommandContext,
    id: string,
    input: RejectFundWithdrawalDto,
  ): Promise<FundWithdrawalDto> {
    const reason = input.reason.trim()
    if (reason.length === 0) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.VALIDATION_FAILED,
        '请填写拒绝原因',
        422,
      )
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
        this.assertReviewVisible(row, scope, context.actorUserId)
        this.assertPendingVersion(row, input.expectedVersion)
        const reviewedAt = new Date()
        await transaction.fundWithdrawalRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reviewedAt,
            reviewedByUserId: context.actorUserId,
            rejectReason: reason,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.FUND_WITHDRAWAL_REJECTED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'FUND_WITHDRAWAL_REQUEST',
          targetId: id,
          metadata: {
            reason,
            withdrawalNo: row.withdrawalNo,
          },
        })
      }, { timeout: 60_000 })
      return await this.queries.getReview(id, context.actorUserId)
    }
    catch (error) {
      return mapFundWithdrawalError(error)
    }
  }

  /**
   * 通过：付款截图认领、资金扣款与状态流转在同一事务内完成。
   * 账户允许被扣成负数，因此这里不检查余额；资金批次仍用统一的受控来源与幂等键。
   */
  async approve(
    context: FundWithdrawalCommandContext,
    id: string,
    input: ApproveFundWithdrawalDto,
  ): Promise<FundWithdrawalDto> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await this.lock(transaction, id)
        const scope = await this.dataScope.resolveInTransaction(transaction, context.actorUserId)
        this.assertReviewVisible(row, scope, context.actorUserId)
        this.assertPendingVersion(row, input.expectedVersion)
        await this.documents.attach(transaction, {
          actorUserId: context.actorUserId,
          mediaAssetId: input.paymentProofMediaAssetId,
        })

        const fundContext = {
          actorUserId: context.actorUserId,
          consumerCode: FUND_WITHDRAWAL_APPROVE_CONSUMER,
          requestId: context.requestId,
          sourceCode: FUND_WITHDRAWAL_FUND_SOURCE,
        }
        const fundInput = {
          postingTypeCode: FUND_WITHDRAWAL_POSTING_TYPE,
          userId: row.userId,
          amount: row.amount.toFixed(2),
          businessId: id,
          businessNo: row.withdrawalNo,
          summary: FUND_WITHDRAWAL_SUMMARY,
          metadata: {
            applicantUserId: row.userId,
            withdrawalRequestId: id,
          },
          idempotencyKey: `fund-withdrawal:${id}:approve`,
        }
        await this.funds.lockBusinessEventAccountsInTransaction(transaction, [{ context: fundContext, input: fundInput }])
        const preview = await this.funds.previewBusinessEventInTransaction(transaction, fundContext, fundInput)
        const posting = await this.funds.postBusinessEventInTransaction(transaction, fundContext, fundInput, preview)
        const reviewedAt = new Date()
        await transaction.fundWithdrawalRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedAt,
            reviewedByUserId: context.actorUserId,
            paymentProofMediaAssetId: input.paymentProofMediaAssetId,
            fundPostingBatchId: posting.batchId,
            version: { increment: 1 },
          },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.FUND_WITHDRAWAL_APPROVED,
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'FUND_WITHDRAWAL_REQUEST',
          targetId: id,
          metadata: {
            amount: row.amount.toFixed(2),
            fundPostingBatchId: posting.batchId,
            paymentProofMediaAssetId: input.paymentProofMediaAssetId,
            withdrawalNo: row.withdrawalNo,
          },
        })
      }, { timeout: 60_000 })
      return await this.queries.getReview(id, context.actorUserId)
    }
    catch (error) {
      return mapFundWithdrawalError(error)
    }
  }

  /** SELF 视角下审批写操作同样不能按 id 操作他人申请；不可见按不存在处理。 */
  private assertReviewVisible(
    row: { readonly userId: string },
    scope: DataScope,
    actorUserId: string,
  ): void {
    if (scope === 'SELF' && row.userId !== actorUserId) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.NOT_FOUND,
        '提款申请不存在',
        404,
      )
    }
  }

  private async lock(
    transaction: Prisma.TransactionClient,
    id: string,
  ): Promise<{
    readonly amount: Prisma.Decimal
    readonly status: string
    readonly userId: string
    readonly version: number
    readonly withdrawalNo: string
  }> {
    const locks = await transaction.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
      SELECT id FROM fund_withdrawal_requests WHERE id = CAST(${id} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.NOT_FOUND,
        '提款申请不存在',
        404,
      )
    }
    const row = await transaction.fundWithdrawalRequest.findUnique({
      where: { id },
      select: {
        amount: true,
        status: true,
        userId: true,
        version: true,
        withdrawalNo: true,
      },
    })
    if (row === null) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.NOT_FOUND,
        '提款申请不存在',
        404,
      )
    }
    return row
  }

  private assertPendingVersion(
    row: { readonly status: string, readonly version: number },
    expectedVersion: number,
  ): void {
    if (row.version !== expectedVersion) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.STATE_CHANGED,
        '提款申请已被其他人处理，请刷新后重试',
        409,
      )
    }
    if (row.status !== 'PENDING') {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.STATUS_NOT_ALLOWED,
        '只有审核中的提款申请可以审批',
        409,
      )
    }
  }
}
