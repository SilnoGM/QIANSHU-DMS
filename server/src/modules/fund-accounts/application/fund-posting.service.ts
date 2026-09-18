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
  calculateFundReversal,
  calculateFundPostingPlan,
  formatFundMinor,
  parseFundAmountMinor,
  type FundAccountTarget,
  type FundPostingPlanEntry,
  type FundPostingRule,
} from '../domain'
import type { FundAccountCommandContext } from './fund-account.contract'
import { normalizeFundAccountCommandContext } from './fund-account.normalizer'
import {
  normalizeFundManualAdjustmentRequest,
  normalizeFundReversalRequest,
  normalizePostBusinessEventRequest,
  type NormalizedFundManualAdjustmentRequest,
  type NormalizedFundReversalRequest,
  type NormalizedPostBusinessEventRequest,
} from './fund-input.normalizer'
import {
  insertFundLedgerEntries,
  insertFundManualAdjustmentBatch,
  insertFundPostingBatch,
  lockFundAccountsForPosting,
  lockFundBusinessSourceForPosting,
  lockFundPostingTypeForPosting,
  readFundAccountIdentitiesForPosting,
  readFundManualAdjustmentIdentities,
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
  FundBusinessTransactionContext,
  FundPostingExpectedContext,
  FundPostingPreview,
  FundManualAdjustmentInput,
  FundPostingContext,
  FundPostingResult,
  FundPostingResultEntry,
  FundReversalInput,
  PostBusinessEventInput,
} from './fund-posting.contract'
import { FundPostingService } from './fund-posting.contract'
import {
  PURCHASE_PAYMENT_FUND_SOURCE,
  PURCHASE_PAYMENT_PAY_CONSUMER,
  PURCHASE_PAYMENT_POSTING_TYPE,
  PURCHASE_PAYMENT_STOCK_PAY_CONSUMER,
  PURCHASE_PAYMENT_VOID_CONSUMER,
} from './fund-purchase-payment'
import {
  isFundIdempotencyUniqueViolation,
  mapFundPersistenceError,
} from './fund-persistence-error.mapper'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorCode,
} from './fund-posting.errors'
import {
  insertFundReversalBatch,
  lockFundOriginalBatchForReversal,
  readFundOriginalEntriesForReversal,
  readFundReversalTargetIdentity,
  type FundOriginalBatchForReversalRecord,
  type FundOriginalEntriesForReversalRecord,
  type FundReversalTargetIdentityRecord,
} from './fund-reversal.persistence'

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n
const SALES_RECEIPT_SOURCE_CODE = 'SALES_RECEIPT'
const SALES_RECEIPT_APPROVE_CONSUMER_CODE = 'SALES_RECEIPT.APPROVE'
const SALES_RECEIPT_VOID_CONSUMER_CODE = 'SALES_RECEIPT.VOID'
const PACKAGING_COST_SOURCE_CODE = 'PACKAGING_COST'
const PACKAGING_COST_PAY_CONSUMER_CODE = 'PACKAGING_COST.PAY'
const ADMIN_REVERSAL_CONSUMER_CODE = 'ADMIN_REVERSAL'
const ADMIN_ADJUSTMENT_CONSUMER_CODE = 'ADMIN_MANUAL_ADJUSTMENT'
const ADMIN_ADJUSTMENT_SOURCE_CODE = 'ADMIN_CONSOLE'
const ADMIN_ADJUSTMENT_POSTING_TYPE_CODE = 'ADMIN_MANUAL_ADJUSTMENT'

interface PlannedLedgerEntry {
  readonly persistence: FundLedgerEntryInsert
  readonly result: FundPostingResultEntry
  readonly account: FundLockedAccountRecord
  readonly balanceAfter: string
}

interface ControlledBusinessReversal {
  readonly sourceCode: string
  readonly consumerCode: string
  readonly postingTypeCode: string
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

function requireManualAdjustmentPostingType(
  postingType: FundPostingTypeRecord | null,
): FundPostingTypeRecord & {
  readonly ruleVersion: NonNullable<FundPostingTypeRecord['ruleVersion']>
  readonly businessCategory: 'ADJUSTMENT'
  readonly inputMode: 'ADMIN_ADJUSTMENT'
} {
  if (postingType === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_FOUND)
  }
  if (!postingType.enabled) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_DISABLED)
  }
  if (
    postingType.code !== ADMIN_ADJUSTMENT_POSTING_TYPE_CODE
    || postingType.businessCategory !== 'ADJUSTMENT'
    || postingType.inputMode !== 'ADMIN_ADJUSTMENT'
    || !postingType.requiresUser
    || postingType.currentRuleVersionId === null
    || postingType.ruleVersion === null
    || postingType.ruleVersion.id !== postingType.currentRuleVersionId
    || postingType.ruleVersion.status !== 'ACTIVE'
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
  }
  return postingType as FundPostingTypeRecord & {
    readonly ruleVersion: NonNullable<FundPostingTypeRecord['ruleVersion']>
    readonly businessCategory: 'ADJUSTMENT'
    readonly inputMode: 'ADMIN_ADJUSTMENT'
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

function requireReversalIdentity(
  identity: FundReversalTargetIdentityRecord | null,
): FundReversalTargetIdentityRecord {
  if (identity === null) {
    throw postingError(FUND_POSTING_ERROR_CODES.POSTING_BATCH_NOT_FOUND)
  }
  return identity
}

function requireOriginalReversalBatch(
  original: FundOriginalBatchForReversalRecord | null,
  identity: FundReversalTargetIdentityRecord,
): FundOriginalBatchForReversalRecord {
  if (original === null || original.kind === 'REVERSAL') {
    throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_TARGET_INVALID)
  }
  if (
    original.id !== identity.id
    || original.businessSourceCode !== identity.businessSourceCode
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID)
  }
  return original
}

function requireConsistentReversalHistory(
  snapshot: FundOriginalEntriesForReversalRecord,
): void {
  const reversedByOriginalAccounts = snapshot.entries.reduce(
    (total, entry) => total + parseFundAmountMinor(entry.reversedAmount),
    0n,
  )
  const reversedBusiness = parseFundAmountMinor(
    snapshot.cumulativeReversedBusinessAmount,
  )
  const reversedEntries = parseFundAmountMinor(
    snapshot.cumulativeReversedEntryAmount,
  )
  if (
    reversedBusiness < 0n
    || reversedEntries < 0n
    || reversedByOriginalAccounts < 0n
    || reversedBusiness !== reversedEntries
    || reversedEntries !== reversedByOriginalAccounts
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID)
  }
}

function reversalAccountIdentities(
  snapshot: FundOriginalEntriesForReversalRecord,
): FundPostingAccountIdentities {
  const userEntry = snapshot.entries.find(entry => entry.accountTarget === 'USER')
  const companyEntry = snapshot.entries.find(
    entry => entry.accountTarget === 'COMPANY',
  )
  const ids = snapshot.entries.map(entry => entry.accountId)
  if (
    ids.length === 0
    || new Set(ids).size !== ids.length
    || (userEntry === undefined && companyEntry === undefined)
  ) {
    throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID)
  }
  return Object.freeze({
    userAccountId: userEntry?.accountId ?? null,
    companyAccountId: companyEntry?.accountId ?? null,
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
    // 受控业务必须与业务状态共用事务，不能独立动账后再补写状态。
    if ([SALES_RECEIPT_SOURCE_CODE, PACKAGING_COST_SOURCE_CODE, PURCHASE_PAYMENT_FUND_SOURCE].includes(request.context.sourceCode)) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
    }
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

  private normalizeBusinessContext(
    context: FundBusinessTransactionContext,
    action: 'POST' | 'REVERSE',
  ): FundAccountCommandContext {
    const salesReceipt = context.sourceCode === SALES_RECEIPT_SOURCE_CODE
      && context.consumerCode === (action === 'POST' ? SALES_RECEIPT_APPROVE_CONSUMER_CODE : SALES_RECEIPT_VOID_CONSUMER_CODE)
    const packagingPayment = action === 'POST' && context.sourceCode === PACKAGING_COST_SOURCE_CODE
      && context.consumerCode === PACKAGING_COST_PAY_CONSUMER_CODE
    const purchasePayment = context.sourceCode === PURCHASE_PAYMENT_FUND_SOURCE
      && (action === 'POST'
        ? [PURCHASE_PAYMENT_PAY_CONSUMER, PURCHASE_PAYMENT_STOCK_PAY_CONSUMER].includes(context.consumerCode)
        : context.consumerCode === PURCHASE_PAYMENT_VOID_CONSUMER)
    if (!salesReceipt && !packagingPayment && !purchasePayment) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
    }
    return normalizeFundAccountCommandContext({
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    })
  }

  private normalizeBusinessRequest(context: FundBusinessTransactionContext, input: PostBusinessEventInput) {
    const postingTypeCode = context.sourceCode === PURCHASE_PAYMENT_FUND_SOURCE
      ? PURCHASE_PAYMENT_POSTING_TYPE
      : context.sourceCode === PACKAGING_COST_SOURCE_CODE ? 'WOODEN_PACKING_COST' : 'ORDER_SETTLEMENT'
    if (input.postingTypeCode !== postingTypeCode) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
    }
    return normalizePostBusinessEventRequest({
      consumerCode: context.consumerCode,
      sourceCode: context.sourceCode,
      requestId: context.requestId,
      ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
    }, input)
  }

  async lockBusinessEventAccountsInTransaction(
    transaction: Prisma.TransactionClient,
    entries: readonly { context: FundBusinessTransactionContext, input: PostBusinessEventInput }[],
  ): Promise<void> {
    try {
      const accountIds = new Set<string>()
      for (const entry of entries) {
        this.normalizeBusinessContext(entry.context, 'POST')
        const request = this.normalizeBusinessRequest(entry.context, entry.input)
        const resolved = await this.resolveBusinessPlanAccounts(transaction, request)
        for (const id of resolved.accountIds) accountIds.add(id)
      }
      // 跨用户批量付款先取得完整账户集合并统一排序；逐笔锁公司/用户组合可能形成反序等待。
      if (accountIds.size) await lockFundAccountsForPosting(transaction, [...accountIds].sort())
    } catch (error) { throw toPostingError(error) }
  }

  async previewBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: PostBusinessEventInput,
  ): Promise<FundPostingPreview> {
    this.normalizeBusinessContext(context, 'POST')
    const request = this.normalizeBusinessRequest(context, input)
    const { postingType, plan, userShareRate } = await this.prepareBusinessPlan(transaction, request)
    if (userShareRate === undefined || plan.companyShareRate === null) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_INVALID)
    }
    return Object.freeze({
      ruleVersionId: postingType.ruleVersion.id,
      userShareRate,
      companyShareRate: plan.companyShareRate,
      businessAmount: plan.businessAmount,
      entries: plan.entries.map(({ accountTarget, direction, amount }) => ({ accountTarget, direction, amount })),
    })
  }

  /** 外层业务事务拥有提交与回滚权；唯一冲突原样上抛，不能在失败事务内恢复。 */
  async postBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: PostBusinessEventInput,
    expectedContext: FundPostingExpectedContext,
  ): Promise<FundPostingResult> {
    const actor = this.normalizeBusinessContext(context, 'POST')
    const request = this.normalizeBusinessRequest(context, input)
    return this.postInTransaction(transaction, request, { actorUserId: actor.actorUserId, expectedContext })
  }

  async reverseBusinessEventInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundBusinessTransactionContext,
    input: FundReversalInput,
  ): Promise<FundPostingResult> {
    const actor = this.normalizeBusinessContext(context, 'REVERSE')
    return this.reverseInTransaction(transaction, actor, normalizeFundReversalRequest(input), {
      sourceCode: context.sourceCode,
      consumerCode: context.consumerCode,
      postingTypeCode: context.sourceCode === PURCHASE_PAYMENT_FUND_SOURCE ? PURCHASE_PAYMENT_POSTING_TYPE : 'ORDER_SETTLEMENT',
    })
  }

  /**
   * 管理员调账只供受权限保护的管理 Controller 调用，不加入 FundPostingService。
   * 路径账户决定用户身份，来源、类型和 consumer 均由资金模块固定。
   */
  async postManualAdjustment(
    rawContext: FundAccountCommandContext,
    rawInput: FundManualAdjustmentInput,
  ): Promise<FundPostingResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const request = normalizeFundManualAdjustmentRequest(rawInput)
    try {
      return await this.prisma.$transaction(transaction => (
        this.postManualAdjustmentInTransaction(transaction, context, request)
      ))
    }
    catch (error) {
      if (isFundIdempotencyUniqueViolation(error)) {
        return this.recoverManualAdjustmentIdempotencyRace(request)
      }
      throw toPostingError(error)
    }
  }

  /**
   * 供后续受超级管理员权限保护的 HTTP Controller 使用。该方法不加入业务域公开
   * FundPostingService 端口，避免普通业务模块获得人工冲账能力。
   */
  async reversePostingBatch(
    rawContext: FundAccountCommandContext,
    rawInput: FundReversalInput,
  ): Promise<FundPostingResult> {
    const context = normalizeFundAccountCommandContext(rawContext)
    const request = normalizeFundReversalRequest(rawInput)
    try {
      return await this.prisma.$transaction(transaction => (
        this.reverseInTransaction(transaction, context, request)
      ))
    }
    catch (error) {
      if (isFundIdempotencyUniqueViolation(error)) {
        return this.recoverReversalIdempotencyRace(request)
      }
      throw toPostingError(error)
    }
  }

  private async postManualAdjustmentInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundAccountCommandContext,
    request: NormalizedFundManualAdjustmentRequest,
  ): Promise<FundPostingResult> {
    await applyTransactionTimeouts(transaction)
    const asOf = await readFundPostingTransactionTimestamp(transaction)
    const replayInput = {
      consumerCode: ADMIN_ADJUSTMENT_CONSUMER_CODE,
      sourceCode: ADMIN_ADJUSTMENT_SOURCE_CODE,
      idempotencyKeyHash: request.idempotencyKeyHash,
    } as const
    const replay = resolveReplay(
      await readIdempotentFundPosting(transaction, replayInput),
      request.requestFingerprintHash,
    )
    if (replay !== null) return replay

    const source = requireSource(await lockFundBusinessSourceForPosting(
      transaction,
      ADMIN_ADJUSTMENT_SOURCE_CODE,
    ))
    if (source.code !== ADMIN_ADJUSTMENT_SOURCE_CODE) {
      throw postingError(FUND_POSTING_ERROR_CODES.BUSINESS_SOURCE_NOT_FOUND)
    }
    const postingType = requireManualAdjustmentPostingType(
      await lockFundPostingTypeForPosting(
        transaction,
        ADMIN_ADJUSTMENT_POSTING_TYPE_CODE,
      ),
    )
    if (!await readFundSourceTypeAuthorization(
      transaction,
      source.id,
      postingType.id,
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_TYPE_NOT_ALLOWED)
    }

    const requireCompanyAccount =
      request.input.adjustmentMode === 'USER_AND_COMPANY_BY_SHARE'
    const identities = await readFundManualAdjustmentIdentities(transaction, {
      userAccountId: request.input.userAccountId,
      requireCompanyAccount,
    })
    if (identities === null) {
      throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_NOT_FOUND)
    }
    const accountIds = requireAccountIds(
      identities,
      true,
      requireCompanyAccount,
    )
    const accounts = await lockFundAccountsForPosting(transaction, accountIds)
    const targetAccounts = mapTargetAccounts(
      accounts,
      identities,
      identities.userId,
    )
    const userShareRate = targetAccounts.USER?.userShareRate
    if (userShareRate === null || userShareRate === undefined) {
      throw postingError(FUND_POSTING_ERROR_CODES.ACCOUNT_UNAVAILABLE)
    }

    // 账户行锁使同一账户的相同请求串行；锁后重读可直接复用先提交的赢家。
    const lockedReplay = resolveReplay(
      await readIdempotentFundPosting(transaction, replayInput),
      request.requestFingerprintHash,
    )
    if (lockedReplay !== null) return lockedReplay

    const plan = calculateFundPostingPlan({
      rule: buildRule(postingType),
      amount: request.input.amount,
      userShareRate,
      adjustmentMode: request.input.adjustmentMode,
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

    await insertFundManualAdjustmentBatch(transaction, {
      id: identity.id,
      batchNo: identity.batchNo,
      kind: 'MANUAL_ADJUSTMENT',
      postingTypeId: postingType.id,
      postingTypeCodeSnapshot: postingType.code,
      postingTypeNameSnapshot: postingType.name,
      businessCategorySnapshot: 'ADJUSTMENT',
      businessSourceId: source.id,
      businessSourceCodeSnapshot: source.code,
      businessSourceNameSnapshot: source.name,
      ruleVersionId: postingType.ruleVersion.id,
      ruleRevisionSnapshot: postingType.ruleVersion.revision,
      userId: identities.userId,
      businessAmount: plan.businessAmount,
      userShareRateSnapshot: plan.userShareRate ?? userShareRate,
      companyShareRateSnapshot: plan.companyShareRate ?? '0.00',
      businessId: identity.id,
      summary: request.input.reason,
      metadata: request.input.metadata,
      businessOccurredAt: asOf,
      consumerCode: ADMIN_ADJUSTMENT_CONSUMER_CODE,
      idempotencyKeyHash: request.idempotencyKeyHash,
      requestFingerprintHash: request.requestFingerprintHash,
      adjustmentMode: request.input.adjustmentMode,
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      correlationId: context.correlationId ?? null,
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
      eventType: AuditEventType.FUND_MANUAL_ADJUSTMENT_POSTED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'FundPostingBatch',
      targetId: identity.id,
      requestId: context.requestId,
      correlationId: context.correlationId,
      metadata: {
        adjustmentMode: request.input.adjustmentMode,
        batchNo: identity.batchNo,
        businessAmount: plan.businessAmount,
        entryCount: plannedEntries.length,
        userAccountId: request.input.userAccountId,
      },
    })

    return Object.freeze({
      batchId: identity.id,
      postingTypeCode: postingType.code,
      businessCategory: 'ADJUSTMENT',
      businessAmount: plan.businessAmount,
      userShareRateSnapshot: plan.userShareRate,
      companyShareRateSnapshot: plan.companyShareRate,
      entries: Object.freeze(plannedEntries.map(entry => entry.result)),
      postedAt: asOf.toISOString(),
      idempotentReplay: false,
    })
  }

  private async recoverManualAdjustmentIdempotencyRace(
    request: NormalizedFundManualAdjustmentRequest,
  ): Promise<FundPostingResult> {
    let record: FundIdempotentPostingRecord | null
    try {
      record = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return readIdempotentFundPosting(transaction, {
          consumerCode: ADMIN_ADJUSTMENT_CONSUMER_CODE,
          sourceCode: ADMIN_ADJUSTMENT_SOURCE_CODE,
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

  private async reverseInTransaction(
    transaction: Prisma.TransactionClient,
    context: FundAccountCommandContext,
    request: NormalizedFundReversalRequest,
    business?: ControlledBusinessReversal,
  ): Promise<FundPostingResult> {
    await applyTransactionTimeouts(transaction)
    const asOf = await readFundPostingTransactionTimestamp(transaction)
    const identity = requireReversalIdentity(
      await readFundReversalTargetIdentity(
        transaction,
        request.input.originalBatchId,
      ),
    )
    // 采购作废必须由采购域持有业务锁；身份在幂等重放之前也要验证，避免跨域重放。
    if ((business !== undefined && identity.businessSourceCode !== business.sourceCode)
      || (business === undefined && identity.businessSourceCode === PURCHASE_PAYMENT_FUND_SOURCE)) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_TARGET_INVALID)
    }
    const replayInput = {
      consumerCode: business?.consumerCode ?? ADMIN_REVERSAL_CONSUMER_CODE,
      sourceCode: identity.businessSourceCode,
      idempotencyKeyHash: request.idempotencyKeyHash,
    } as const
    const replay = resolveReplay(
      await readIdempotentFundPosting(transaction, replayInput),
      request.requestFingerprintHash,
    )
    if (replay !== null) return replay

    const original = requireOriginalReversalBatch(
      await lockFundOriginalBatchForReversal(
        transaction,
        request.input.originalBatchId,
      ),
      identity,
    )
    // 原批次锁内继续校验业务身份；账本不能先于收款或采购付款作废。
    if (business === undefined && original.businessSourceCode === SALES_RECEIPT_SOURCE_CODE) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_REQUIRES_RECEIPT_VOID)
    }
    if (business !== undefined && (
      original.businessSourceCode !== business.sourceCode
      || original.postingTypeCode !== business.postingTypeCode
      || original.kind !== 'BUSINESS'
      || (business.sourceCode === PURCHASE_PAYMENT_FUND_SOURCE
        && (original.businessCategory !== 'COST' || parseFundAmountMinor(original.businessAmount) <= 0n))
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_TARGET_INVALID)
    }
    // 同一原批次上的冲账在行锁处串行；锁后重读可复用刚提交的相同请求。
    const lockedReplay = resolveReplay(
      await readIdempotentFundPosting(transaction, replayInput),
      request.requestFingerprintHash,
    )
    if (lockedReplay !== null) return lockedReplay

    // 聚合必须使用取得原批次锁后的新语句，才能看见等待期间提交的冲账事实。
    const originalEntries = await readFundOriginalEntriesForReversal(
      transaction,
      original.id,
    )
    requireConsistentReversalHistory(originalEntries)
    if (business !== undefined && (
      parseFundAmountMinor(originalEntries.cumulativeReversedBusinessAmount) !== 0n
      || parseFundAmountMinor(request.input.amount) !== parseFundAmountMinor(original.businessAmount)
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_STATE_CHANGED)
    }
    const plan = calculateFundReversal({
      originalBatchKind: original.kind,
      originalBusinessAmount: original.businessAmount,
      userShareRateSnapshot: original.userShareRateSnapshot,
      entries: originalEntries.entries,
      reversalAmount: request.input.amount,
    })

    const identities = reversalAccountIdentities(originalEntries)
    const accountIds = Object.freeze(
      originalEntries.entries
        .map(entry => entry.accountId)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    )
    const accounts = await lockFundAccountsForPosting(transaction, accountIds)
    const targetAccounts = mapTargetAccounts(accounts, identities, original.userId)
    const batchIdentity = createBatchIdentity()
    const plannedEntries = plan.entries.map((entry, index) => (
      planLedgerEntry(
        entry,
        index + 1,
        batchIdentity.id,
        targetAccounts,
        asOf,
      )
    ))
    if (plannedEntries.length === 0) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID)
    }

    await insertFundReversalBatch(transaction, {
      id: batchIdentity.id,
      batchNo: batchIdentity.batchNo,
      originalBatchId: original.id,
      businessAmount: plan.reversalBusinessAmount,
      consumerCode: business?.consumerCode ?? ADMIN_REVERSAL_CONSUMER_CODE,
      idempotencyKeyHash: request.idempotencyKeyHash,
      requestFingerprintHash: request.requestFingerprintHash,
      reason: request.input.reason,
      actorUserId: context.actorUserId,
      requestId: context.requestId,
      correlationId: context.correlationId ?? null,
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
        throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_STATE_CHANGED)
      }
    }
    await insertFundLedgerEntries(
      transaction,
      plannedEntries.map(entry => entry.persistence),
    )
    await this.audit.record(transaction, {
      eventType: AuditEventType.FUND_POSTING_REVERSED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'FundPostingBatch',
      targetId: batchIdentity.id,
      requestId: context.requestId,
      correlationId: context.correlationId,
      metadata: {
        batchNo: batchIdentity.batchNo,
        entryCount: plannedEntries.length,
        originalBatchId: original.id,
        reversalAmount: request.input.amount,
        reversalState: plan.reversalState,
      },
    })

    return Object.freeze({
      batchId: batchIdentity.id,
      postingTypeCode: original.postingTypeCode,
      businessCategory: original.businessCategory,
      businessAmount: plan.reversalBusinessAmount,
      userShareRateSnapshot: original.userShareRateSnapshot,
      companyShareRateSnapshot: original.companyShareRateSnapshot,
      entries: Object.freeze(plannedEntries.map(entry => entry.result)),
      postedAt: asOf.toISOString(),
      idempotentReplay: false,
    })
  }

  /** 唯一竞争已使主事务回滚；恢复路径只读取赢家，不再尝试任何余额修改。 */
  private async recoverReversalIdempotencyRace(
    request: NormalizedFundReversalRequest,
  ): Promise<FundPostingResult> {
    let record: FundIdempotentPostingRecord | null
    try {
      record = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const identity = requireReversalIdentity(
          await readFundReversalTargetIdentity(
            transaction,
            request.input.originalBatchId,
          ),
        )
        return readIdempotentFundPosting(transaction, {
          consumerCode: ADMIN_REVERSAL_CONSUMER_CODE,
          sourceCode: identity.businessSourceCode,
          idempotencyKeyHash: request.idempotencyKeyHash,
        })
      })
    }
    catch (error) {
      throw toPostingError(error)
    }

    const replay = resolveReplay(record, request.requestFingerprintHash)
    if (replay === null) {
      throw postingError(FUND_POSTING_ERROR_CODES.REVERSAL_STATE_CHANGED)
    }
    return replay
  }

  private async resolveBusinessPlanAccounts(
    transaction: Prisma.TransactionClient,
    request: NormalizedPostBusinessEventRequest,
  ) {
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
    const stockPurchase = request.context.sourceCode === PURCHASE_PAYMENT_FUND_SOURCE
      && request.context.consumerCode === PURCHASE_PAYMENT_STOCK_PAY_CONSUMER
    if (stockPurchase) {
      if (request.input.userId !== null) {
        throw postingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, 'userId')
      }
      // 备货仍使用已发布的同一分摊规则，仅有效比例固定为 0/100。不能把不兼容
      // 的配置改写成临时公司规则，否则批次记录的规则版本将与实际计算不一致。
      const legs = postingType.ruleVersion.legs
      if (!postingType.requiresUser || legs.length !== 2
        || !legs.some(leg => leg.accountTarget === 'USER' && leg.amountStrategy === 'USER_SHARE')
        || !legs.some(leg => leg.accountTarget === 'COMPANY' && leg.amountStrategy === 'COMPANY_REMAINDER')) {
        throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
      }
    }
    else {
      requireConditionalUser(postingType, request.input.userId)
    }

    const requireCompanyAccount = postingType.ruleVersion.legs.some(
      leg => leg.accountTarget === 'COMPANY',
    )
    const requireUserAccount = postingType.requiresUser && !stockPurchase
    const identities = await readFundAccountIdentitiesForPosting(transaction, {
      userId: request.input.userId,
      requireUserAccount,
      requireCompanyAccount,
    })
    const accountIds = requireAccountIds(
      identities,
      requireUserAccount,
      requireCompanyAccount,
    )
    return { source, postingType, stockPurchase, identities, accountIds }
  }

  private async prepareBusinessPlan(transaction: Prisma.TransactionClient, request: NormalizedPostBusinessEventRequest) {
    const { source, postingType, stockPurchase, identities, accountIds } = await this.resolveBusinessPlanAccounts(transaction, request)
    const accounts = await lockFundAccountsForPosting(transaction, accountIds)
    const targetAccounts = mapTargetAccounts(
      accounts,
      identities,
      request.input.userId,
    )

    // 不读取或锁定任何用户账户，也不借用付款人的比例；零额 USER 分录由引擎省略。
    const userShareRate = stockPurchase ? '0.00' : targetAccounts.USER?.userShareRate ?? undefined
    const plan = calculateFundPostingPlan({
      rule: buildRule(postingType),
      amount: request.input.amount,
      ...(userShareRate === undefined ? {} : { userShareRate }),
    })
    // 可配置的结算规则仍须满足收款语义；财务通过只能增加账户余额。
    if (request.context.sourceCode === SALES_RECEIPT_SOURCE_CODE && (
      postingType.businessCategory !== 'REVENUE'
      || parseFundAmountMinor(plan.businessAmount) <= 0n
      || plan.entries.some(entry => entry.direction !== 'CREDIT')
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
    }
    // 包装费用可调整分摊规则，但必须仍是归属人的成本支出，不能变为收入或仅公司业务。
    // 用户比例为零时引擎会省略零额分录，因此按规则分录校验 USER 目标。
    if ([PACKAGING_COST_SOURCE_CODE, PURCHASE_PAYMENT_FUND_SOURCE].includes(request.context.sourceCode) && (
      postingType.businessCategory !== 'COST'
      || !postingType.requiresUser
      || !postingType.ruleVersion.legs.some(leg => leg.accountTarget === 'USER')
      || parseFundAmountMinor(plan.businessAmount) <= 0n
      || plan.entries.some(entry => entry.direction !== 'DEBIT')
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.POSTING_RULE_UNAVAILABLE)
    }
    return { source, postingType, targetAccounts, plan, userShareRate }
  }

  private async postInTransaction(
    transaction: Prisma.TransactionClient,
    request: NormalizedPostBusinessEventRequest,
    business?: { readonly actorUserId: string; readonly expectedContext: FundPostingExpectedContext },
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

    const { source, postingType, targetAccounts, plan, userShareRate } = await this.prepareBusinessPlan(transaction, request)
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

    // 比较的快照就是后续分录使用的快照，不能在锁外检查后再读取另一组比例。
    if (business !== undefined && (
      business.expectedContext.ruleVersionId !== postingType.ruleVersion.id
      || business.expectedContext.userShareRate !== userShareRate
    )) {
      throw postingError(FUND_POSTING_ERROR_CODES.CONCURRENT_STATE_CHANGED)
    }
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
      ...(business === undefined ? {} : { actorUserId: business.actorUserId }),
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
      actorType: business === undefined ? AuditActorType.SYSTEM : AuditActorType.USER,
      ...(business === undefined ? {} : { actorUserId: business.actorUserId }),
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
