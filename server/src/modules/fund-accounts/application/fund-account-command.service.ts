import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { DataScopeService, dataScopeFallback } from '../../access-control/data-scope.service'
import { AuditService } from '../../audit/audit.service'
import {
  lockFundAccountForShareRateUpdate,
  readFundAccountCreateTarget,
  readFundAccountView,
  updateFundAccountShareRate,
} from './fund-account-command.persistence'
import { createUserFundAccountInTransaction } from './fund-account-provisioning'
import type {
  FundAccountCommandContext,
  FundAccountCreateInput,
  FundAccountShareRateUpdateInput,
  FundAccountShareRateUpdateResult,
  FundAccountView,
} from './fund-account.contract'
import { mapFundAccountView, type FundAccountViewRow } from './fund-account.mapper'
import {
  normalizeFundAccountCommandContext,
  normalizeFundAccountCreate,
  normalizeFundAccountShareRateUpdate,
} from './fund-account.normalizer'
import { mapFundPersistenceError } from './fund-persistence-error.mapper'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
} from './fund-posting.errors'

function accountError(
  code: FundPostingErrorCode,
): FundPostingError {
  return new FundPostingError(code)
}

function requireAccountView(row: FundAccountViewRow | null): FundAccountView {
  if (row === null) {
    throw accountError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return mapFundAccountView(row)
}

/**
 * 开户和比例修改统一持有 transaction、超时与 Audit 边界。规范化在事务外完成；
 * 进入 interactive transaction 后第一条 SQL 固定设置超时，Audit 失败即整体回滚。
 */
@Injectable()
export class FundAccountCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async createUserAccount(
    rawContext: FundAccountCommandContext,
    rawInput: FundAccountCreateInput,
  ): Promise<FundAccountView> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundAccountCreate(rawInput)
    const scope = await this.dataScope.resolve(context.actorUserId)

    return this.runMutation(async (transaction) => {
      // SELF 角色只能为本人开户；目标用户不可见时与不存在同样返回 404。
      if (scope === 'SELF' && input.userId !== context.actorUserId) {
        throw accountError(FUND_POSTING_ERROR_CODES.USER_NOT_FOUND)
      }
      const target = await readFundAccountCreateTarget(transaction, input.userId)
      if (target === null) {
        throw accountError(FUND_POSTING_ERROR_CODES.USER_NOT_FOUND)
      }
      if (target.existingAccountId !== null) {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_ALREADY_EXISTS)
      }

      const created = await createUserFundAccountInTransaction(
        transaction,
        this.audit,
        {
          userId: input.userId,
          userShareRate: input.userShareRate,
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          ...(context.correlationId === undefined
            ? {}
            : { correlationId: context.correlationId }),
        },
      )
      const account = requireAccountView(
        await readFundAccountView(transaction, created.id),
      )

      return account
    })
  }

  async updateUserShareRate(
    rawContext: FundAccountCommandContext,
    rawInput: FundAccountShareRateUpdateInput,
  ): Promise<FundAccountShareRateUpdateResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const input = normalizeFundAccountShareRateUpdate(rawInput)
    const scope = await this.dataScope.resolve(context.actorUserId)

    return this.runMutation(async (transaction) => {
      const currentRow = await lockFundAccountForShareRateUpdate(
        transaction,
        input.accountId,
      )
      if (currentRow === null) {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND)
      }
      // 防御 SELF 角色按账户 id 操作他人账户：不可见即按不存在处理。
      if (scope === 'SELF' && currentRow.userId !== context.actorUserId) {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND)
      }
      if (currentRow.ownerType !== 'USER') {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE)
      }
      if (currentRow.version !== input.expectedVersion) {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_STATE_CHANGED)
      }

      const current = mapFundAccountView(currentRow)
      if (current.userShareRate === input.userShareRate) {
        return Object.freeze({ changed: false, account: current })
      }

      const updated = await updateFundAccountShareRate(transaction, {
        accountId: input.accountId,
        userShareRate: input.userShareRate,
        expectedVersion: input.expectedVersion,
      })
      if (updated === null) {
        throw accountError(FUND_POSTING_ERROR_CODES.ACCOUNT_STATE_CHANGED)
      }

      const account = mapFundAccountView({
        ...currentRow,
        ...updated,
      })
      if (current.user === null || account.user === null) {
        throw accountError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
      }

      await this.audit.record(transaction, {
        eventType: AuditEventType.FUND_ACCOUNT_SHARE_RATE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'FundAccount',
        targetId: account.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        metadata: {
          previousUserShareRate: current.userShareRate,
          reason: input.reason,
          userId: account.user.id,
          userShareRate: input.userShareRate,
        },
      })

      return Object.freeze({ changed: true, account })
    })
  }

  private async runMutation<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return operation(transaction)
      })
    }
    catch (error) {
      throw mapFundPersistenceError(error)
    }
  }
}
