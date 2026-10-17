import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_ENTRY_DIRECTIONS,
  formatFundMinor,
  parseFundAmountMinor,
} from '../domain'
import type {
  FundAccountSortOrder,
  FundAccountUserStatus,
} from './fund-account.contract'
import { normalizeFundMetadata } from './fund-metadata'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorField,
} from './fund-posting.errors'
import {
  FUND_TRANSACTION_REVERSAL_STATUSES,
  FUND_TRANSACTION_SORT_FIELDS,
  type FundPostingBatchDetailView,
  type FundSelfPostingTypeOptionList,
  type FundSelfTransactionListQuery,
  type FundSelfTransactionPage,
  type FundTransactionListQuery,
  type FundTransactionPage,
  type FundTransactionReversalStatus,
  type FundTransactionSortField,
  type FundTransactionView,
} from './fund-transaction.contract'
import { mapFundSelfTransactionView } from './fund-self.mapper'
import { resolveFundTransactionSummary } from './fund-summary'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const BATCH_KINDS = ['BUSINESS', 'MANUAL_ADJUSTMENT', 'REVERSAL'] as const
const SORT_ORDERS = ['asc', 'desc'] as const
const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const

interface NormalizedFundTransactionListQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly accountId: string | null
  readonly userId: string | null
  readonly postingTypeId: string | null
  readonly businessCategory: (typeof FUND_BUSINESS_CATEGORIES)[number] | null
  readonly businessSourceId: string | null
  readonly direction: (typeof FUND_ENTRY_DIRECTIONS)[number] | null
  readonly businessNo: string | null
  readonly occurredFrom: Date | null
  readonly occurredTo: Date | null
  readonly reversalStatus: FundTransactionReversalStatus | null
  readonly sortBy: FundTransactionSortField
  readonly sortOrder: FundAccountSortOrder
}

interface CountDatabaseRow {
  readonly total: unknown
}

interface TransactionDatabaseRow {
  readonly entryId: unknown
  readonly batchId: unknown
  readonly batchNo: unknown
  readonly batchKind: unknown
  readonly accountId: unknown
  readonly ownerType: unknown
  readonly userId: unknown
  readonly username: unknown
  readonly displayName: unknown
  readonly userStatus: unknown
  readonly accountTarget: unknown
  readonly postingTypeId: unknown
  readonly postingTypeCode: unknown
  readonly postingTypeName: unknown
  readonly businessCategory: unknown
  readonly businessSourceId: unknown
  readonly businessSourceCode: unknown
  readonly businessSourceName: unknown
  readonly direction: unknown
  readonly amountStrategy: unknown
  readonly amount: unknown
  readonly balanceBefore: unknown
  readonly balanceAfter: unknown
  readonly accountSequence: unknown
  readonly businessAmount: unknown
  readonly userShareRateSnapshot: unknown
  readonly companyShareRateSnapshot: unknown
  readonly businessId: unknown
  readonly businessNo: unknown
  readonly summary: unknown
  readonly businessOccurredAt: unknown
  readonly adjustmentMode: unknown
  readonly reversalOfBatchId: unknown
  readonly reversalStatus: unknown
  readonly postedAt: unknown
}

function validationFailed(field: FundPostingErrorField): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, field)
}

function readPlainValues(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailed('body')
  }
  const allowed = new Set([
    'page', 'pageSize', 'accountId', 'userId', 'postingTypeId',
    'businessCategory', 'businessSourceId', 'direction', 'businessNo',
    'occurredFrom', 'occurredTo', 'reversalStatus', 'sortBy', 'sortOrder',
  ])
  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      return validationFailed('body')
    }
    const keys = Reflect.ownKeys(input)
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) {
      return validationFailed('body')
    }
    return input as Readonly<Record<string, unknown>>
  }
  catch {
    return validationFailed('body')
  }
}

function normalizePositiveInteger(
  value: unknown,
  field: 'page' | 'pageSize',
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    return validationFailed(field)
  }
  return Number(value)
}

function normalizeOptionalUuid(
  value: unknown,
  field: FundPostingErrorField,
): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return validationFailed(field)
  }
  return value
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') return validationFailed('businessNo')
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0 || [...normalized].length > 128) {
    return validationFailed('businessNo')
  }
  return normalized
}

function normalizeOptionalDate(
  value: unknown,
  field: 'occurredFrom' | 'occurredTo',
): Date | null {
  if (value === undefined) return null
  if (typeof value !== 'string') return validationFailed(field)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return validationFailed(field)
  }
  return new Date(timestamp)
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: FundPostingErrorField,
): T | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return validationFailed(field)
  }
  return value as T
}

export function normalizeFundTransactionListQuery(
  input: FundTransactionListQuery,
): NormalizedFundTransactionListQuery {
  const values = readPlainValues(input)
  const page = normalizePositiveInteger(values.page ?? 1, 'page', 1_000_000)
  const pageSize = normalizePositiveInteger(values.pageSize ?? 20, 'pageSize', 100)
  const occurredFrom = normalizeOptionalDate(values.occurredFrom, 'occurredFrom')
  const occurredTo = normalizeOptionalDate(values.occurredTo, 'occurredTo')
  if (
    occurredFrom !== null
    && occurredTo !== null
    && occurredFrom.getTime() > occurredTo.getTime()
  ) {
    return validationFailed('businessOccurredAt')
  }

  return Object.freeze({
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    accountId: normalizeOptionalUuid(values.accountId, 'accountId'),
    userId: normalizeOptionalUuid(values.userId, 'userId'),
    postingTypeId: normalizeOptionalUuid(values.postingTypeId, 'postingTypeId'),
    businessCategory: optionalEnum(
      values.businessCategory,
      FUND_BUSINESS_CATEGORIES,
      'businessCategory',
    ),
    businessSourceId: normalizeOptionalUuid(
      values.businessSourceId,
      'businessSourceId',
    ),
    direction: optionalEnum(values.direction, FUND_ENTRY_DIRECTIONS, 'direction'),
    businessNo: normalizeOptionalText(values.businessNo),
    occurredFrom,
    occurredTo,
    reversalStatus: optionalEnum(
      values.reversalStatus,
      FUND_TRANSACTION_REVERSAL_STATUSES,
      'reversalStatus',
    ),
    sortBy: optionalEnum(
      values.sortBy ?? 'postedAt',
      FUND_TRANSACTION_SORT_FIELDS,
      'sortBy',
    ) ?? 'postedAt',
    sortOrder: optionalEnum(
      values.sortOrder ?? 'desc',
      SORT_ORDERS,
      'sortOrder',
    ) ?? 'desc',
  })
}

function reversalStatusSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN batch."kind" = 'REVERSAL'::"fund_posting_batch_kind"
        THEN 'NOT_APPLICABLE'
      WHEN COALESCE(reversal_total."amount", 0) = 0 THEN 'NONE'
      WHEN COALESCE(reversal_total."amount", 0) < ABS(batch."business_amount")
        THEN 'PARTIAL'
      ELSE 'FULL'
    END
  `
}

function transactionFromWhereSql(
  query: NormalizedFundTransactionListQuery,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (query.accountId !== null) {
    conditions.push(Prisma.sql`entry."account_id" = CAST(${query.accountId} AS uuid)`)
  }
  if (query.userId !== null) {
    conditions.push(Prisma.sql`batch."user_id" = CAST(${query.userId} AS uuid)`)
  }
  if (query.postingTypeId !== null) {
    conditions.push(Prisma.sql`batch."posting_type_id" = CAST(${query.postingTypeId} AS uuid)`)
  }
  if (query.businessCategory !== null) {
    conditions.push(Prisma.sql`batch."business_category_snapshot" = CAST(${query.businessCategory} AS "fund_business_category")`)
  }
  if (query.businessSourceId !== null) {
    conditions.push(Prisma.sql`batch."business_source_id" = CAST(${query.businessSourceId} AS uuid)`)
  }
  if (query.direction !== null) {
    conditions.push(Prisma.sql`entry."direction" = CAST(${query.direction} AS "fund_entry_direction")`)
  }
  if (query.businessNo !== null) {
    conditions.push(Prisma.sql`POSITION(LOWER(${query.businessNo}) IN LOWER(COALESCE(batch."business_no", ''))) > 0`)
  }
  if (query.occurredFrom !== null) {
    conditions.push(Prisma.sql`batch."business_occurred_at" >= ${query.occurredFrom}`)
  }
  if (query.occurredTo !== null) {
    conditions.push(Prisma.sql`batch."business_occurred_at" <= ${query.occurredTo}`)
  }
  if (query.reversalStatus !== null) {
    conditions.push(Prisma.sql`${reversalStatusSql()} = ${query.reversalStatus}`)
  }

  return Prisma.sql`
    FROM "fund_ledger_entries" AS entry
    INNER JOIN "fund_posting_batches" AS batch ON batch."id" = entry."batch_id"
    INNER JOIN "fund_accounts" AS account ON account."id" = entry."account_id"
    LEFT JOIN "users" AS owner_user ON owner_user."id" = account."user_id"
    LEFT JOIN (
      SELECT
        reversal."reversal_of_batch_id" AS "originalBatchId",
        SUM(ABS(reversal."business_amount")) AS "amount"
      FROM "fund_posting_batches" AS reversal
      WHERE reversal."kind" = 'REVERSAL'::"fund_posting_batch_kind"
      GROUP BY reversal."reversal_of_batch_id"
    ) AS reversal_total ON reversal_total."originalBatchId" = batch."id"
    WHERE ${Prisma.join(conditions, ' AND ')}
  `
}

function transactionOrderSql(
  query: NormalizedFundTransactionListQuery,
): Prisma.Sql {
  const columnBySort: Record<FundTransactionSortField, string> = {
    postedAt: 'entry."posted_at"',
    businessOccurredAt: 'batch."business_occurred_at"',
    amount: 'entry."amount"',
  }
  const column = Prisma.raw(columnBySort[query.sortBy])
  const direction = Prisma.raw(query.sortOrder === 'asc' ? 'ASC' : 'DESC')
  return Prisma.sql`${column} ${direction}, entry."id" ${direction}`
}

function decimalString(value: unknown): string {
  if (!Prisma.Decimal.isDecimal(value)) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return value.toFixed(2)
}

function nullableDecimalString(value: unknown): string | null {
  return value === null ? null : decimalString(value)
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return value
}

function nullableString(value: unknown): string | null {
  return value === null ? null : requiredString(value)
}

function requiredDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return value
}

function requiredEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return value as T
}

function mapTransactionRow(row: TransactionDatabaseRow): FundTransactionView {
  const ownerType = requiredEnum(row.ownerType, ['USER', 'COMPANY'] as const)
  const userId = nullableString(row.userId)
  const username = nullableString(row.username)
  const displayName = nullableString(row.displayName)
  const userStatus = row.userStatus === null
    ? null
    : requiredEnum(row.userStatus, USER_STATUSES)
  if (
    (ownerType === 'USER' && (
      userId === null || username === null || displayName === null || userStatus === null
    ))
    || (ownerType === 'COMPANY' && (
      userId !== null || username !== null || displayName !== null || userStatus !== null
    ))
  ) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  if (typeof row.accountSequence !== 'bigint' || row.accountSequence < 1n) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }

  return Object.freeze({
    entryId: requiredString(row.entryId),
    batchId: requiredString(row.batchId),
    batchNo: requiredString(row.batchNo),
    batchKind: requiredEnum(row.batchKind, BATCH_KINDS),
    account: Object.freeze({
      id: requiredString(row.accountId),
      ownerType,
      user: userId === null ? null : Object.freeze({
        id: userId,
        username: username as string,
        displayName: displayName as string,
        status: userStatus as FundAccountUserStatus,
      }),
    }),
    accountTarget: requiredEnum(row.accountTarget, FUND_ACCOUNT_TARGETS),
    postingTypeId: requiredString(row.postingTypeId),
    postingTypeCode: requiredString(row.postingTypeCode),
    postingTypeName: requiredString(row.postingTypeName),
    businessCategory: requiredEnum(row.businessCategory, FUND_BUSINESS_CATEGORIES),
    businessSourceId: requiredString(row.businessSourceId),
    businessSourceCode: requiredString(row.businessSourceCode),
    businessSourceName: requiredString(row.businessSourceName),
    direction: requiredEnum(row.direction, FUND_ENTRY_DIRECTIONS),
    amountStrategy: requiredEnum(row.amountStrategy, FUND_AMOUNT_STRATEGIES),
    amount: decimalString(row.amount),
    balanceBefore: decimalString(row.balanceBefore),
    balanceAfter: decimalString(row.balanceAfter),
    accountSequence: row.accountSequence.toString(),
    businessAmount: decimalString(row.businessAmount),
    userShareRateSnapshot: nullableDecimalString(row.userShareRateSnapshot),
    companyShareRateSnapshot: nullableDecimalString(row.companyShareRateSnapshot),
    businessId: requiredString(row.businessId),
    businessNo: nullableString(row.businessNo),
    summary: resolveFundTransactionSummary({
      postingTypeCode: requiredString(row.postingTypeCode),
      businessNo: nullableString(row.businessNo),
      summary: requiredString(row.summary),
    }),
    businessOccurredAt: requiredDate(row.businessOccurredAt).toISOString(),
    adjustmentMode: row.adjustmentMode === null
      ? null
      : requiredEnum(row.adjustmentMode, FUND_ADJUSTMENT_MODES),
    reversalOfBatchId: nullableString(row.reversalOfBatchId),
    reversalStatus: requiredEnum(
      row.reversalStatus,
      FUND_TRANSACTION_REVERSAL_STATUSES,
    ),
    postedAt: requiredDate(row.postedAt).toISOString(),
  })
}

function safeTotal(value: unknown): number {
  if (typeof value !== 'bigint' || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return Number(value)
}

function absoluteAmount(value: string): string {
  const minor = parseFundAmountMinor(value)
  return formatFundMinor(minor < 0n ? -minor : minor)
}

/** 资金流水读取使用历史快照，不回查当前类型、来源名称或当前分成比例。 */
@Injectable()
export class FundTransactionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listTransactions(
    input: FundTransactionListQuery,
  ): Promise<FundTransactionPage> {
    const query = normalizeFundTransactionListQuery(input)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const fromWhere = transactionFromWhereSql(query)
        const countRows = await transaction.$queryRaw<CountDatabaseRow[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS "total" ${fromWhere}`,
        )
        if (countRows.length !== 1) {
          throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
        }
        const rows = await transaction.$queryRaw<TransactionDatabaseRow[]>(
          Prisma.sql`
            SELECT
              entry."id" AS "entryId",
              batch."id" AS "batchId",
              batch."batch_no" AS "batchNo",
              batch."kind"::text AS "batchKind",
              account."id" AS "accountId",
              account."owner_type"::text AS "ownerType",
              owner_user."id" AS "userId",
              owner_user."username",
              owner_user."display_name" AS "displayName",
              owner_user."status"::text AS "userStatus",
              entry."account_target"::text AS "accountTarget",
              batch."posting_type_id" AS "postingTypeId",
              batch."posting_type_code_snapshot" AS "postingTypeCode",
              batch."posting_type_name_snapshot" AS "postingTypeName",
              batch."business_category_snapshot"::text AS "businessCategory",
              batch."business_source_id" AS "businessSourceId",
              batch."business_source_code_snapshot" AS "businessSourceCode",
              batch."business_source_name_snapshot" AS "businessSourceName",
              entry."direction"::text AS "direction",
              entry."amount_strategy"::text AS "amountStrategy",
              entry."amount",
              entry."balance_before" AS "balanceBefore",
              entry."balance_after" AS "balanceAfter",
              entry."account_sequence" AS "accountSequence",
              batch."business_amount" AS "businessAmount",
              batch."user_share_rate_snapshot" AS "userShareRateSnapshot",
              batch."company_share_rate_snapshot" AS "companyShareRateSnapshot",
              batch."business_id" AS "businessId",
              batch."business_no" AS "businessNo",
              batch."summary",
              batch."business_occurred_at" AS "businessOccurredAt",
              batch."adjustment_mode"::text AS "adjustmentMode",
              batch."reversal_of_batch_id" AS "reversalOfBatchId",
              ${reversalStatusSql()} AS "reversalStatus",
              entry."posted_at" AS "postedAt"
            ${fromWhere}
            ORDER BY ${transactionOrderSql(query)}
            OFFSET ${query.skip}
            LIMIT ${query.pageSize}
          `,
        )
        return Object.freeze({
          items: Object.freeze(rows.map(mapTransactionRow)),
          page: query.page,
          pageSize: query.pageSize,
          total: safeTotal(countRows[0]?.total),
        })
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  async getBatchDetail(batchId: string): Promise<FundPostingBatchDetailView> {
    if (!UUID_V4_PATTERN.test(batchId)) return validationFailed('originalBatchId')
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const batch = await transaction.fundPostingBatch.findUnique({
          where: { id: batchId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                status: true,
              },
            },
            entries: {
              orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
              include: {
                account: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        username: true,
                        displayName: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
        if (batch === null) {
          throw new FundPostingError(
            FUND_POSTING_ERROR_CODES.POSTING_BATCH_NOT_FOUND,
          )
        }
        const originalBatchId = batch.reversalOfBatchId ?? batch.id
        const original = await transaction.fundPostingBatch.findUnique({
          where: { id: originalBatchId },
          select: {
            id: true,
            batchNo: true,
            businessAmount: true,
            reversalBatches: {
              orderBy: [{ postedAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                batchNo: true,
                businessAmount: true,
                reversalReason: true,
                actorUserId: true,
                postedAt: true,
              },
            },
          },
        })
        if (original === null) {
          throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
        }

        const originalAmount = absoluteAmount(original.businessAmount.toFixed(2))
        const originalMinor = parseFundAmountMinor(originalAmount)
        const reversedMinor = original.reversalBatches.reduce(
          (total, reversal) => total + parseFundAmountMinor(
            absoluteAmount(reversal.businessAmount.toFixed(2)),
          ),
          0n,
        )
        if (reversedMinor < 0n || reversedMinor > originalMinor) {
          throw new FundPostingError(
            FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID,
          )
        }
        const reversalStatus = reversedMinor === 0n
          ? 'NONE'
          : reversedMinor === originalMinor ? 'FULL' : 'PARTIAL'

        return Object.freeze({
          id: batch.id,
          batchNo: batch.batchNo,
          kind: batch.kind,
          postingTypeId: batch.postingTypeId,
          postingTypeCode: batch.postingTypeCodeSnapshot,
          postingTypeName: batch.postingTypeNameSnapshot,
          businessCategory: batch.businessCategorySnapshot,
          businessSourceId: batch.businessSourceId,
          businessSourceCode: batch.businessSourceCodeSnapshot,
          businessSourceName: batch.businessSourceNameSnapshot,
          ruleVersionId: batch.ruleVersionId,
          ruleRevision: batch.ruleRevisionSnapshot,
          user: batch.user === null ? null : Object.freeze({
            id: batch.user.id,
            username: batch.user.username,
            displayName: batch.user.displayName,
            status: batch.user.status,
          }),
          businessAmount: batch.businessAmount.toFixed(2),
          currency: 'CNY',
          userShareRateSnapshot: batch.userShareRateSnapshot?.toFixed(2) ?? null,
          companyShareRateSnapshot:
            batch.companyShareRateSnapshot?.toFixed(2) ?? null,
          businessId: batch.businessId,
          businessNo: batch.businessNo,
          summary: resolveFundTransactionSummary({
            postingTypeCode: batch.postingTypeCodeSnapshot,
            businessNo: batch.businessNo,
            summary: batch.summary,
          }),
          metadata: normalizeFundMetadata(batch.metadata),
          businessOccurredAt: batch.businessOccurredAt.toISOString(),
          adjustmentMode: batch.adjustmentMode,
          reversalOfBatchId: batch.reversalOfBatchId,
          reversalReason: batch.reversalReason,
          actorUserId: batch.actorUserId,
          requestId: batch.requestId,
          correlationId: batch.correlationId,
          postedAt: batch.postedAt.toISOString(),
          entries: Object.freeze(batch.entries.map(entry => Object.freeze({
            entryId: entry.id,
            lineNo: entry.lineNo,
            account: Object.freeze({
              id: entry.account.id,
              ownerType: entry.account.ownerType,
              user: entry.account.user === null ? null : Object.freeze({
                id: entry.account.user.id,
                username: entry.account.user.username,
                displayName: entry.account.user.displayName,
                status: entry.account.user.status,
              }),
            }),
            accountTarget: entry.accountTarget,
            direction: entry.direction,
            amountStrategy: entry.amountStrategy,
            amount: entry.amount.toFixed(2),
            balanceBefore: entry.balanceBefore.toFixed(2),
            balanceAfter: entry.balanceAfter.toFixed(2),
            accountSequence: entry.accountSequence.toString(),
            postedAt: entry.postedAt.toISOString(),
          }))),
          reversalChain: Object.freeze({
            originalBatchId: original.id,
            originalBatchNo: original.batchNo,
            status: reversalStatus,
            originalAmount,
            reversedAmount: formatFundMinor(reversedMinor),
            remainingAmount: formatFundMinor(originalMinor - reversedMinor),
            reversals: Object.freeze(original.reversalBatches.map((reversal) => {
              if (reversal.reversalReason === null || reversal.actorUserId === null) {
                throw new FundPostingError(
                  FUND_POSTING_ERROR_CODES.REVERSAL_SNAPSHOT_INVALID,
                )
              }
              return Object.freeze({
                batchId: reversal.id,
                batchNo: reversal.batchNo,
                amount: absoluteAmount(reversal.businessAmount.toFixed(2)),
                reason: reversal.reversalReason,
                actorUserId: reversal.actorUserId,
                postedAt: reversal.postedAt.toISOString(),
              })
            })),
          }),
        })
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  /**
   * 运营本人流水。
   *
   * userId 来自会话，服务端按唯一 user_id 解析本人账户后强制按 account_id
   * 过滤；不能只按 batch.user_id 过滤，否则同一批次的 COMPANY 账户分录
   * 会连同公司余额一起暴露给运营。未开户返回空页而不是错误。
   */
  async listOwnTransactions(
    userId: string,
    input: FundSelfTransactionListQuery,
  ): Promise<FundSelfTransactionPage> {
    try {
      const account = await this.prisma.fundAccount.findUnique({
        where: { userId },
        select: { id: true },
      })
      if (account === null) {
        const query = normalizeFundTransactionListQuery({ ...input })
        return Object.freeze({
          items: Object.freeze([]),
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
        })
      }

      const page = await this.listTransactions({
        ...input,
        accountId: account.id,
      })
      return Object.freeze({
        items: Object.freeze(page.items.map(mapFundSelfTransactionView)),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  /**
   * 本人流水中实际出现过的业务类型。
   *
   * 只取本人账户的分录，避免把同批次公司分录或他人流水的类型带进筛选下拉；
   * 名称取当前类型名，历史流水行仍展示各自的名称快照。
   */
  async listOwnPostingTypes(
    userId: string,
  ): Promise<FundSelfPostingTypeOptionList> {
    try {
      const account = await this.prisma.fundAccount.findUnique({
        where: { userId },
        select: { id: true },
      })
      if (account === null) {
        return Object.freeze({ items: Object.freeze([]) })
      }

      const rows = await this.prisma.$queryRaw<
        Array<{ readonly id: unknown, readonly name: unknown }>
      >(Prisma.sql`
        SELECT DISTINCT
          batch."posting_type_id" AS "id",
          posting_type."name" AS "name"
        FROM "fund_ledger_entries" AS entry
        INNER JOIN "fund_posting_batches" AS batch
          ON batch."id" = entry."batch_id"
        INNER JOIN "fund_posting_types" AS posting_type
          ON posting_type."id" = batch."posting_type_id"
        WHERE entry."account_id" = CAST(${account.id} AS uuid)
        ORDER BY "name" ASC, "id" ASC
      `)

      const items = rows.map((row) => {
        if (
          typeof row.id !== 'string'
          || row.id.length === 0
          || typeof row.name !== 'string'
          || row.name.length === 0
        ) {
          throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
        }
        return Object.freeze({ id: row.id, name: row.name })
      })

      return Object.freeze({ items: Object.freeze(items) })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }
}
