import { Prisma } from '../../../generated/prisma/client'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_ENTRY_DIRECTIONS,
  formatFundMinor,
  formatFundShareRateUnits,
  parseFundAmountMinor,
  parseFundShareRateUnits,
  type FundAccountTarget,
  type FundAdjustmentMode,
  type FundAmountStrategy,
  type FundBusinessCategory,
  type FundEntryDirection,
  type FundReversibleBatchKind,
} from '../domain'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'
import { PURCHASE_PAYMENT_FUND_SOURCE, PURCHASE_PAYMENT_POSTING_TYPE, PURCHASE_PAYMENT_STOCK_PAY_CONSUMER } from './fund-purchase-payment'

const FUND_REVERSIBLE_BATCH_KINDS = [
  'BUSINESS',
  'MANUAL_ADJUSTMENT',
  'REVERSAL',
] as const satisfies readonly FundReversibleBatchKind[]

export interface FundReversalTargetIdentityRecord {
  readonly id: string
  readonly businessSourceCode: string
}

export interface FundOriginalBatchForReversalRecord {
  readonly id: string
  readonly kind: FundReversibleBatchKind
  readonly postingTypeId: string
  readonly postingTypeCode: string
  readonly businessCategory: FundBusinessCategory
  readonly businessSourceId: string
  readonly businessSourceCode: string
  readonly ruleVersionId: string
  readonly userId: string | null
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly adjustmentMode: FundAdjustmentMode | null
}

export interface FundOriginalEntryForReversalRecord {
  readonly originalLineNo: number
  readonly accountId: string
  readonly accountTarget: FundAccountTarget
  readonly direction: FundEntryDirection
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
  readonly reversedAmount: string
}

export interface FundOriginalEntriesForReversalRecord {
  readonly entries: readonly FundOriginalEntryForReversalRecord[]
  readonly cumulativeReversedBusinessAmount: string
  readonly cumulativeReversedEntryAmount: string
}

export interface FundReversalBatchInsert {
  readonly id: string
  readonly batchNo: string
  readonly originalBatchId: string
  readonly businessAmount: string
  readonly consumerCode: string
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
  readonly reason: string
  readonly actorUserId: string
  readonly requestId: string
  readonly correlationId: string | null
  readonly postedAt: Date
}

interface TargetIdentityDatabaseRow {
  readonly id: unknown
  readonly businessSourceCode: unknown
}

interface OriginalBatchDatabaseRow {
  readonly id: unknown
  readonly kind: unknown
  readonly postingTypeId: unknown
  readonly postingTypeCode: unknown
  readonly businessCategory: unknown
  readonly businessSourceId: unknown
  readonly businessSourceCode: unknown
  readonly consumerCode: unknown
  readonly ruleVersionId: unknown
  readonly userId: unknown
  readonly businessAmount: unknown
  readonly userShareRateSnapshot: unknown
  readonly companyShareRateSnapshot: unknown
  readonly adjustmentMode: unknown
}

interface OriginalEntryDatabaseRow {
  readonly originalLineNo: unknown
  readonly accountId: unknown
  readonly accountTarget: unknown
  readonly direction: unknown
  readonly amountStrategy: unknown
  readonly amount: unknown
  readonly reversedAmount: unknown
  readonly cumulativeReversedBusinessAmount: unknown
  readonly cumulativeReversedEntryAmount: unknown
}

function persistenceInvariant(): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}

function isUuidText(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
}

function isNonblankText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function decimalAmount(value: unknown): string {
  if (!(value instanceof Prisma.Decimal)) return persistenceInvariant()
  try {
    return formatFundMinor(parseFundAmountMinor(value.toFixed(2)))
  }
  catch {
    return persistenceInvariant()
  }
}

function nullableShareRate(value: unknown): string | null {
  if (value === null) return null
  if (!(value instanceof Prisma.Decimal)) return persistenceInvariant()
  try {
    return formatFundShareRateUnits(
      parseFundShareRateUnits(value.toFixed(2)),
    )
  }
  catch {
    return persistenceInvariant()
  }
}

/**
 * 幂等预检只需要不可变的来源编码，因此这里不抢占原批次行锁。真正的冲账状态
 * 串行化由后续 lockFundOriginalBatchForReversal() 完成。
 */
export async function readFundReversalTargetIdentity(
  transaction: Prisma.TransactionClient,
  originalBatchId: string,
): Promise<FundReversalTargetIdentityRecord | null> {
  const rows = await transaction.$queryRaw<TargetIdentityDatabaseRow[]>(
    Prisma.sql`
      SELECT
        batch."id",
        batch."business_source_code_snapshot" AS "businessSourceCode"
      FROM "fund_posting_batches" AS batch
      WHERE batch."id" = CAST(${originalBatchId} AS uuid)
    `,
  )
  const row = rows[0]
  if (row === undefined) return null
  if (
    rows.length !== 1
    || !isUuidText(row.id)
    || !isNonblankText(row.businessSourceCode)
  ) {
    return persistenceInvariant()
  }
  return Object.freeze({
    id: row.id,
    businessSourceCode: row.businessSourceCode,
  })
}

/**
 * 原批次锁必须由独立 SQL 获取。随后再用一条新 SQL 汇总历史冲账，确保在
 * READ COMMITTED 下等待锁的事务能看见前一个事务刚提交的冲账事实。
 */
export async function lockFundOriginalBatchForReversal(
  transaction: Prisma.TransactionClient,
  originalBatchId: string,
): Promise<FundOriginalBatchForReversalRecord | null> {
  const rows = await transaction.$queryRaw<OriginalBatchDatabaseRow[]>(
    Prisma.sql`
      SELECT
        batch."id",
        batch."kind"::text AS "kind",
        batch."posting_type_id" AS "postingTypeId",
        batch."posting_type_code_snapshot" AS "postingTypeCode",
        batch."business_category_snapshot"::text AS "businessCategory",
        batch."business_source_id" AS "businessSourceId",
        batch."business_source_code_snapshot" AS "businessSourceCode",
        batch."consumer_code" AS "consumerCode",
        batch."rule_version_id" AS "ruleVersionId",
        batch."user_id" AS "userId",
        batch."business_amount" AS "businessAmount",
        batch."user_share_rate_snapshot" AS "userShareRateSnapshot",
        batch."company_share_rate_snapshot" AS "companyShareRateSnapshot",
        batch."adjustment_mode"::text AS "adjustmentMode"
      FROM "fund_posting_batches" AS batch
      WHERE batch."id" = CAST(${originalBatchId} AS uuid)
      FOR UPDATE OF batch
    `,
  )
  const row = rows[0]
  if (row === undefined) return null
  if (
    rows.length !== 1
    || !isUuidText(row.id)
    || !isOneOf(row.kind, FUND_REVERSIBLE_BATCH_KINDS)
    || !isUuidText(row.postingTypeId)
    || !isNonblankText(row.postingTypeCode)
    || !isOneOf(row.businessCategory, FUND_BUSINESS_CATEGORIES)
    || !isUuidText(row.businessSourceId)
    || !isNonblankText(row.businessSourceCode)
    || !isUuidText(row.ruleVersionId)
    || (row.userId !== null && !isUuidText(row.userId))
    || (row.adjustmentMode !== null
      && !isOneOf(row.adjustmentMode, FUND_ADJUSTMENT_MODES))
  ) {
    return persistenceInvariant()
  }
  const userShareRateSnapshot = nullableShareRate(row.userShareRateSnapshot)
  const companyShareRateSnapshot = nullableShareRate(
    row.companyShareRateSnapshot,
  )
  // 备货采购没有用户身份，但须保留有效 0/100 快照才能按原分录冲正；只开放该受控原批次。
  const companyOnlyPurchase = row.kind === 'BUSINESS'
    && row.businessSourceCode === PURCHASE_PAYMENT_FUND_SOURCE
    && row.postingTypeCode === PURCHASE_PAYMENT_POSTING_TYPE
    && row.businessCategory === 'COST'
    && row.consumerCode === PURCHASE_PAYMENT_STOCK_PAY_CONSUMER
    && row.userId === null && userShareRateSnapshot === '0.00' && companyShareRateSnapshot === '100.00'
  if (
    (userShareRateSnapshot === null) !== (companyShareRateSnapshot === null)
    || (!companyOnlyPurchase && (row.userId === null) !== (userShareRateSnapshot === null))
    || (row.kind === 'MANUAL_ADJUSTMENT') !== (row.adjustmentMode !== null)
  ) {
    return persistenceInvariant()
  }

  return Object.freeze({
    id: row.id,
    kind: row.kind,
    postingTypeId: row.postingTypeId,
    postingTypeCode: row.postingTypeCode,
    businessCategory: row.businessCategory,
    businessSourceId: row.businessSourceId,
    businessSourceCode: row.businessSourceCode,
    ruleVersionId: row.ruleVersionId,
    userId: row.userId,
    businessAmount: decimalAmount(row.businessAmount),
    userShareRateSnapshot,
    companyShareRateSnapshot,
    adjustmentMode: row.adjustmentMode,
  })
}

/**
 * 本查询只能在原批次行锁取得后执行。三个独立聚合同时校验累计业务额度、全部
 * 冲账分录额度和映射回原账户的额度，防止损坏快照被静默忽略。
 */
export async function readFundOriginalEntriesForReversal(
  transaction: Prisma.TransactionClient,
  originalBatchId: string,
): Promise<FundOriginalEntriesForReversalRecord> {
  const rows = await transaction.$queryRaw<OriginalEntryDatabaseRow[]>(
    Prisma.sql`
      WITH reversal_business AS (
        SELECT COALESCE(
          SUM(ABS(reversal."business_amount")),
          CAST(0 AS numeric)
        ) AS "cumulativeReversedBusinessAmount"
        FROM "fund_posting_batches" AS reversal
        WHERE reversal."reversal_of_batch_id" = CAST(${originalBatchId} AS uuid)
          AND reversal."kind" = 'REVERSAL'::"fund_posting_batch_kind"
      ),
      reversal_entry_by_account AS (
        SELECT
          reversal_entry."account_id" AS "accountId",
          SUM(reversal_entry."amount") AS "reversedAmount"
        FROM "fund_posting_batches" AS reversal
        INNER JOIN "fund_ledger_entries" AS reversal_entry
          ON reversal_entry."batch_id" = reversal."id"
        WHERE reversal."reversal_of_batch_id" = CAST(${originalBatchId} AS uuid)
          AND reversal."kind" = 'REVERSAL'::"fund_posting_batch_kind"
        GROUP BY reversal_entry."account_id"
      ),
      reversal_entry_total AS (
        SELECT COALESCE(
          SUM(reversal_entry."amount"),
          CAST(0 AS numeric)
        ) AS "cumulativeReversedEntryAmount"
        FROM "fund_posting_batches" AS reversal
        INNER JOIN "fund_ledger_entries" AS reversal_entry
          ON reversal_entry."batch_id" = reversal."id"
        WHERE reversal."reversal_of_batch_id" = CAST(${originalBatchId} AS uuid)
          AND reversal."kind" = 'REVERSAL'::"fund_posting_batch_kind"
      )
      SELECT
        original_entry."line_no" AS "originalLineNo",
        original_entry."account_id" AS "accountId",
        original_entry."account_target"::text AS "accountTarget",
        original_entry."direction"::text AS "direction",
        original_entry."amount_strategy"::text AS "amountStrategy",
        original_entry."amount",
        COALESCE(
          reversal_entry_by_account."reversedAmount",
          CAST(0 AS numeric)
        ) AS "reversedAmount",
        reversal_business."cumulativeReversedBusinessAmount",
        reversal_entry_total."cumulativeReversedEntryAmount"
      FROM "fund_ledger_entries" AS original_entry
      CROSS JOIN reversal_business
      CROSS JOIN reversal_entry_total
      LEFT JOIN reversal_entry_by_account
        ON reversal_entry_by_account."accountId" = original_entry."account_id"
      WHERE original_entry."batch_id" = CAST(${originalBatchId} AS uuid)
      ORDER BY original_entry."line_no" ASC, original_entry."id" ASC
    `,
  )
  if (rows.length === 0) {
    return Object.freeze({
      entries: Object.freeze([]),
      cumulativeReversedBusinessAmount: '0.00',
      cumulativeReversedEntryAmount: '0.00',
    })
  }

  const first = rows[0]
  if (first === undefined) return persistenceInvariant()
  const cumulativeReversedBusinessAmount = decimalAmount(
    first.cumulativeReversedBusinessAmount,
  )
  const cumulativeReversedEntryAmount = decimalAmount(
    first.cumulativeReversedEntryAmount,
  )
  const entries = rows.map((row) => {
    if (
      !Number.isInteger(row.originalLineNo)
      || Number(row.originalLineNo) < 1
      || !isUuidText(row.accountId)
      || !isOneOf(row.accountTarget, FUND_ACCOUNT_TARGETS)
      || !isOneOf(row.direction, FUND_ENTRY_DIRECTIONS)
      || !isOneOf(row.amountStrategy, FUND_AMOUNT_STRATEGIES)
      || decimalAmount(row.cumulativeReversedBusinessAmount)
        !== cumulativeReversedBusinessAmount
      || decimalAmount(row.cumulativeReversedEntryAmount)
        !== cumulativeReversedEntryAmount
    ) {
      return persistenceInvariant()
    }
    return Object.freeze({
      originalLineNo: Number(row.originalLineNo),
      accountId: row.accountId,
      accountTarget: row.accountTarget,
      direction: row.direction,
      amountStrategy: row.amountStrategy,
      amount: decimalAmount(row.amount),
      reversedAmount: decimalAmount(row.reversedAmount),
    })
  })

  return Object.freeze({
    entries: Object.freeze(entries),
    cumulativeReversedBusinessAmount,
    cumulativeReversedEntryAmount,
  })
}

/**
 * 冲账批次使用 INSERT ... SELECT 复制原批次全部业务快照，只覆盖冲账语义字段。
 * 这样不会因为应用层遗漏字段而把当前配置误写进历史纠错记录。
 */
export async function insertFundReversalBatch(
  transaction: Prisma.TransactionClient,
  input: FundReversalBatchInsert,
): Promise<void> {
  if (
    input.idempotencyKeyHash.byteLength !== 32
    || input.requestFingerprintHash.byteLength !== 32
  ) {
    return persistenceInvariant()
  }
  const rows = await transaction.$queryRaw<Array<{ readonly id: unknown }>>(
    Prisma.sql`
      INSERT INTO "fund_posting_batches" (
        "id",
        "batch_no",
        "kind",
        "posting_type_id",
        "posting_type_code_snapshot",
        "posting_type_name_snapshot",
        "business_category_snapshot",
        "business_source_id",
        "business_source_code_snapshot",
        "business_source_name_snapshot",
        "rule_version_id",
        "rule_revision_snapshot",
        "user_id",
        "business_amount",
        "currency",
        "user_share_rate_snapshot",
        "company_share_rate_snapshot",
        "business_id",
        "business_no",
        "summary",
        "metadata",
        "business_occurred_at",
        "consumer_code",
        "idempotency_key_hash",
        "request_fingerprint_hash",
        "adjustment_mode",
        "reversal_of_batch_id",
        "reversal_reason",
        "actor_user_id",
        "request_id",
        "correlation_id",
        "posted_at"
      )
      SELECT
        CAST(${input.id} AS uuid),
        ${input.batchNo},
        'REVERSAL'::"fund_posting_batch_kind",
        original."posting_type_id",
        original."posting_type_code_snapshot",
        original."posting_type_name_snapshot",
        original."business_category_snapshot",
        original."business_source_id",
        original."business_source_code_snapshot",
        original."business_source_name_snapshot",
        original."rule_version_id",
        original."rule_revision_snapshot",
        original."user_id",
        CAST(${input.businessAmount} AS numeric(30, 4)),
        original."currency",
        original."user_share_rate_snapshot",
        original."company_share_rate_snapshot",
        original."business_id",
        original."business_no",
        original."summary",
        original."metadata",
        original."business_occurred_at",
        ${input.consumerCode},
        ${input.idempotencyKeyHash},
        ${input.requestFingerprintHash},
        NULL,
        original."id",
        ${input.reason},
        CAST(${input.actorUserId} AS uuid),
        ${input.requestId},
        ${input.correlationId},
        ${input.postedAt}
      FROM "fund_posting_batches" AS original
      WHERE original."id" = CAST(${input.originalBatchId} AS uuid)
      RETURNING "id"
    `,
  )
  if (rows.length !== 1 || rows[0]?.id !== input.id) {
    return persistenceInvariant()
  }
}
