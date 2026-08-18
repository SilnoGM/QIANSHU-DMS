import { randomUUID, timingSafeEqual } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { AuditService } from '../../audit/audit.service'
import {
  FundCalculationError,
  calculateFundPostingPlan,
  formatFundMinor,
  parseFundAmountMinor,
  type FundAccountTarget,
  type FundPostingPlanEntry,
  type FundPostingRule,
} from '../domain'
import {
  normalizePostBusinessEventRequest,
  type NormalizedPostBusinessEventRequest,
} from './fund-input.normalizer'
import {
  insertFundLedgerEntries,
  insertFundPostingBatch,
  lockFundAccountsForPosting,
  lockFundBusinessSourceForPosting,
  lockFundPostingTypeForPosting,
  readFundAccountIdentitiesForPosting,
  readFundPostingTransactionTimestamp,
  readFundSourceTypeAuthorization,
  readIdempotentFundPosting,
  updateFundAccountForPosting,
  type FundIdempotentPostingRecord,
  type FundLedgerEntryInsert,
  type FundLockedAccountRecord,
  type FundPostingAccountIdentities,
  type FundPostingBusinessSourceRecord,
  type FundPostingTypeRecord,
} from './fund-posting.persistence'
import type {
  FundPostingContext,
  FundPostingResult,
  FundPostingResultEntry,
  PostBusinessEventInput,
} from './fund-posting.contract'
import { FundPostingService } from './fund-posting.contract'
import {
  isFundIdempotencyUniqueViolation,
  mapFundPersistenceError,
} from './fund-persistence-error.mapper'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
} from './fund-posting.errors'

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n

interface PlannedLedgerEntry {
  readonly persistence: FundLedgerEntryInsert
  readonly result: FundPostingResultEntry
  readonly account: FundLockedAccountRecord
  readonly balanceAfter: string
}

function postingError(
  code: FundPostingErrorCode,
  field?: 'userId' | 'amount',
): FundPostingError {
  return new FundPostingError(code, field)
}

function toPostingError(error: unknown): FundPostingError {
  if (error instanceof FundPostingError) return error
  if (error instanceof FundCalculationError) {
    return new FundPostingError(
      error.code,
      error.code === FUND_POSTING_ERROR_CODES.POSTING_AMOUNT_INVALID
        ? 'amount'
        : undefined,
    )
  }
  return mapFundPersistenceError(error)
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength
    && timingSafeEqual(left, right)
}

function resolveReplay(
  record: FundIdempotentPostingRecord | null,
  requestFingerprintHash: Buffer,
): FundPostingResult | null {
  if (record === null) return null
  if (!sameHash(record.requestFingerprintHash, requestFingerprintHash)) {
    throw postingError(FUND_POSTING_ERROR_CODES.IDEMPOTENCY_CONFLICT)
  }
  return Object.freeze({
    batchId: record.batchId,
    postingTypeCode: record.postingTypeCode,
    businessCategory: record.businessCategory,
    businessAmount: record.businessAmount,
    userShareRateSnapshot: record.userShareRateSnapshot,
    companyShareRateSnapshot: record.companyShareRateSnapshot,
    entries: record.entries,
    postedAt: record.postedAt.toISOString(),
    idempotentReplay: true,
  })
}

function createBatchIdentity(): { readonly id: string; readonly batchNo: string } {
  const id = randomUUID()
  return Object.freeze({
    id,
    batchNo: `FUND_${id.replaceAll('-', '').toUpperCase()}`,
  })
}

function requireSource(
  source: FundPostingBusinessSourceRecord | null,
): FundPostingBusinessSourceRecord {
  if (source === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_NOT_FOUND)
  }
  if (!source.enabled) {
    throw postingError(FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_DISABLED)
  }
  return source
}

function requirePostingType(
  postingType: FundPostingTypeRecord | null,
): FundPostingTypeRecord & {
  readonly ruleVersion: NonNullable<FundPostingTypeRecord['ruleVersion']>
} {
  if (postingType === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_FOUND)
  }
  if (!postingType.enabled) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_DISABLED)
  }
  // 管理员调账只能由后续受权限保护的管理入口调用，普通业务域不能选择它。
  if (
    postingType.inputMode !== 'STANDARD'
    || postingType.businessCategory === 'ADJUSTMENT'
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
  }
  if (
    postingType.currentRuleVersionId === null
    || postingType.ruleVersion === null
    || postingType.ruleVersion.id !== postingType.currentRuleVersionId
    || postingType.ruleVersion.status !== 'ACTIVE'
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
  }
  return postingType as FundPostingTypeRecord & {
    readonly ruleVersion: NonNullable<FundPostingTypeRecord['ruleVersion']>
  }
}

function requireConditionalUser(
  postingType: FundPostingTypeRecord,
  userId: string | null,
): void {
  if (postingType.requiresUser && userId === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.USER_REQUIRED)
  }
  if (!postingType.requiresUser && userId !== null) {
    throw postingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, 'userId')
  }
}

function requireAccountIds(
  identities: FundPostingAccountIdentities,
  requireUserAccount: boolean,
  requireCompanyAccount: boolean,
): readonly string[] {
  if (requireUserAccount && identities.userAccountId === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND)
  }
  if (requireCompanyAccount && identities.companyAccountId === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.COMPANY_ACCOUNT_UNAVAILABLE)
  }
  const ids = [
    ...(identities.userAccountId === null ? [] : [identities.userAccountId]),
    ...(identities.companyAccountId === null
      ? []
      : [identities.companyAccountId]),
  ]
  return Object.freeze(ids.sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  )))
}

function mapTargetAccounts(
  accounts: readonly FundLockedAccountRecord[],
  identities: FundPostingAccountIdentities,
  userId: string | null,
): Readonly<Record<FundAccountTarget, FundLockedAccountRecord | null>> {
  const byId = new Map(accounts.map(account => [account.id, account]))
  const userAccount = identities.userAccountId === null
    ? null
    : byId.get(identities.userAccountId) ?? null
  const companyAccount = identities.companyAccountId === null
    ? null
    : byId.get(identities.companyAccountId) ?? null
  if (
    (userAccount !== null
      && (userAccount.ownerType !== 'USER' || userAccount.userId !== userId))
    || (companyAccount !== null
      && (companyAccount.ownerType !== 'COMPANY'
        || companyAccount.userId !== null))
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE)
  }
  return Object.freeze({ USER: userAccount, COMPANY: companyAccount })
}

function buildRule(postingType: ReturnType<typeof requirePostingType>): FundPostingRule {
  return Object.freeze({
    postingTypeCode: postingType.code,
    businessCategory: postingType.businessCategory,
    amountSignPolicy: postingType.amountSignPolicy,
    requiresUser: postingType.requiresUser,
    inputMode: postingType.inputMode,
    legs: postingType.ruleVersion.legs,
  })
}

function planLedgerEntry(
  planEntry: FundPostingPlanEntry,
  lineNo: number,
  batchId: string,
  targetAccounts: Readonly<Record<
    FundAccountTarget,
    FundLockedAccountRecord | null
  >>,
  postedAt: Date,
): PlannedLedgerEntry {
  const account = targetAccounts[planEntry.accountTarget]
  if (account === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE)
  }
  if (account.nextSequence >= MAX_POSTGRES_BIGINT) {
    throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE)
  }
  const balanceBeforeMinor = parseFundAmountMinor(account.balance)
  const amountMinor = parseFundAmountMinor(planEntry.amount)
  const balanceAfterMinor = planEntry.direction === 'CREDIT'
    ? balanceBeforeMinor + amountMinor
    : balanceBeforeMinor - amountMinor
  const balanceAfter = formatFundMinor(balanceAfterMinor)
  const entryId = randomUUID()

  return Object.freeze({
    account,
    balanceAfter,
    persistence: Object.freeze({
      id: entryId,
      batchId,
      lineNo,
      accountId: account.id,
      direction: planEntry.direction,
      accountTarget: planEntry.accountTarget,
      amountStrategy: planEntry.amountStrategy,
      amount: planEntry.amount,
      balanceBefore: account.balance,
      balanceAfter,
      accountSequence: account.nextSequence,
      postedAt,
    }),
    result: Object.freeze({
      entryId,
      accountId: account.id,
      accountTarget: planEntry.accountTarget,
      direction: planEntry.direction,
      amount: planEntry.amount,
      balanceBefore: account.balance,
      balanceAfter,
      accountSequence: account.nextSequence.toString(),
    }),
  })
}

/**
 * 同一 Server 内普通业务域的唯一资金写账实现。业务方只提交业务语义；账户、
 * 比例、方向、拆分、序号和余额均在事务锁内由资金模块解析。
 */
@Injectable()
export class FundPostingApplicationService extends FundPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super()
  }

  async postBusinessEvent(
    rawContext: FundPostingContext,
    rawInput: PostBusinessEventInput,
  ): Promise<FundPostingResult> {
    const request = normalizePostBusinessEventRequest(rawContext, rawInput)
    try {
      return await this.prisma.$transaction(transaction => (
        this.postInTransaction(transaction, request)
      ))
    }
    catch (error) {
      if (isFundIdempotencyUniqueViolation(error)) {
        return this.recoverIdempotencyRace(request)
      }
      throw toPostingError(error)
    }
  }

  private async postInTransaction(
    transaction: Prisma.TransactionClient,
    request: NormalizedPostBusinessEventRequest,
  ): Promise<FundPostingResult> {
    // timeout 固定为事务第一条 SQL，之后所有时间语义只复用这一次数据库读取。
    await applyTransactionTimeouts(transaction)
    const asOf = await readFundPostingTransactionTimestamp(transaction)
    const replay = resolveReplay(
      await readIdempotentFundPosting(transaction, {
        consumerCode: request.context.consumerCode,
        sourceCode: request.context.sourceCode,
        idempotencyKeyHash: request.idempotencyKeyHash,
      }),
      request.requestFingerprintHash,
    )
    if (replay !== null) return replay

    const source = requireSource(await lockFundBusinessSourceForPosting(
      transaction,
      request.context.sourceCode,
    ))
    const postingType = requirePostingType(await lockFundPostingTypeForPosting(
      transaction,
      request.input.postingTypeCode,
    ))
    if (!await readFundSourceTypeAuthorization(
      transaction,
      source.id,
      postingType.id,
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
    }
    requireConditionalUser(postingType, request.input.userId)

    const requireCompanyAccount = postingType.ruleVersion.legs.some(
      leg => leg.accountTarget === 'COMPANY',
    )
    const identities = await readFundAccountIdentitiesForPosting(transaction, {
      userId: request.input.userId,
      requireUserAccount: postingType.requiresUser,
      requireCompanyAccount,
    })
    const accountIds = requireAccountIds(
      identities,
      postingType.requiresUser,
      requireCompanyAccount,
    )
    const accounts = await lockFundAccountsForPosting(transaction, accountIds)
    const targetAccounts = mapTargetAccounts(
      accounts,
      identities,
      request.input.userId,
    )

    // 同账户的相同请求会在行锁处串行；锁后再读一次可直接复用先提交的赢家。
    const lockedReplay = resolveReplay(
      await readIdempotentFundPosting(transaction, {
        consumerCode: request.context.consumerCode,
        sourceCode: request.context.sourceCode,
        idempotencyKeyHash: request.idempotencyKeyHash,
      }),
      request.requestFingerprintHash,
    )
    if (lockedReplay !== null) return lockedReplay

    const userShareRate = targetAccounts.USER?.userShareRate ?? undefined
    const plan = calculateFundPostingPlan({
      rule: buildRule(postingType),
      amount: request.input.amount,
      ...(userShareRate === undefined ? {} : { userShareRate }),
    })
    const identity = createBatchIdentity()
    const plannedEntries = plan.entries.map((entry, index) => (
      planLedgerEntry(
        entry,
        index + 1,
        identity.id,
        targetAccounts,
        asOf,
      )
    ))
    if (plannedEntries.length === 0) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID)
    }

    await insertFundPostingBatch(transaction, {
      id: identity.id,
      batchNo: identity.batchNo,
      kind: 'BUSINESS',
      postingTypeId: postingType.id,
      postingTypeCodeSnapshot: postingType.code,
      postingTypeNameSnapshot: postingType.name,
      businessCategorySnapshot: postingType.businessCategory,
      businessSourceId: source.id,
      businessSourceCodeSnapshot: source.code,
      businessSourceNameSnapshot: source.name,
      ruleVersionId: postingType.ruleVersion.id,
      ruleRevisionSnapshot: postingType.ruleVersion.revision,
      userId: request.input.userId,
      businessAmount: plan.businessAmount,
      userShareRateSnapshot: plan.userShareRate,
      companyShareRateSnapshot: plan.companyShareRate,
      businessId: request.input.businessId,
      businessNo: request.input.businessNo,
      summary: request.input.summary,
      metadata: request.input.metadata,
      businessOccurredAt: request.input.businessOccurredAt === null
        ? asOf
        : new Date(request.input.businessOccurredAt),
      consumerCode: request.context.consumerCode,
      idempotencyKeyHash: request.idempotencyKeyHash,
      requestFingerprintHash: request.requestFingerprintHash,
      requestId: request.context.requestId,
      correlationId: request.context.correlationId ?? null,
      postedAt: asOf,
    })

    const entriesByAccountId = [...plannedEntries].sort((left, right) => (
      left.account.id < right.account.id
        ? -1
        : left.account.id > right.account.id ? 1 : 0
    ))
    for (const entry of entriesByAccountId) {
      const updated = await updateFundAccountForPosting(transaction, {
        accountId: entry.account.id,
        expectedVersion: entry.account.version,
        expectedNextSequence: entry.account.nextSequence,
        balanceAfter: entry.balanceAfter,
        nextSequence: entry.account.nextSequence + 1n,
        asOf,
      })
      if (!updated) {
        throw postingError(FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED)
      }
    }
    await insertFundLedgerEntries(
      transaction,
      plannedEntries.map(entry => entry.persistence),
    )
    await this.audit.record(transaction, {
      eventType: AuditEventType.FUND_BUSINESS_POSTED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.SYSTEM,
      targetType: 'FundPostingBatch',
      targetId: identity.id,
      requestId: request.context.requestId,
      correlationId: request.context.correlationId,
      metadata: {
        batchNo: identity.batchNo,
        businessAmount: plan.businessAmount,
        businessId: request.input.businessId,
        businessSourceCode: source.code,
        entryCount: plannedEntries.length,
        postingTypeCode: postingType.code,
      },
    })

    return Object.freeze({
      batchId: identity.id,
      postingTypeCode: postingType.code,
      businessCategory: postingType.businessCategory,
      businessAmount: plan.businessAmount,
      userShareRateSnapshot: plan.userShareRate,
      companyShareRateSnapshot: plan.companyShareRate,
      entries: Object.freeze(plannedEntries.map(entry => entry.result)),
      postedAt: asOf.toISOString(),
      idempotentReplay: false,
    })
  }

  /** 主事务已因唯一竞争回滚；恢复事务只读赢家，不自动再次执行任何余额修改。 */
  private async recoverIdempotencyRace(
    request: NormalizedPostBusinessEventRequest,
  ): Promise<FundPostingResult> {
    let record: FundIdempotentPostingRecord | null
    try {
      record = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return readIdempotentFundPosting(transaction, {
          consumerCode: request.context.consumerCode,
          sourceCode: request.context.sourceCode,
          idempotencyKeyHash: request.idempotencyKeyHash,
        })
      })
    }
    catch (error) {
      throw toPostingError(error)
    }

    const replay = resolveReplay(record, request.requestFingerprintHash)
    if (replay === null) {
      throw postingError(FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED)
    }
    return replay
  }
}
