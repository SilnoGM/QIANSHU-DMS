import { Prisma } from '../../../generated/prisma/client'
import {
  FUND_ACCOUNT_TARGETS,
  FUND_ADJUSTMENT_MODES,
  FUND_AMOUNT_SIGN_POLICIES,
  FUND_AMOUNT_STRATEGIES,
  FUND_BUSINESS_CATEGORIES,
  FUND_DIRECTION_POLICIES,
  FUND_ENTRY_DIRECTIONS,
  FUND_RULE_INPUT_MODES,
  formatFundMinor,
  formatFundShareRateUnits,
  parseFundAmountMinor,
  parseFundShareRateUnits,
  type FundAccountTarget,
  type FundAdjustmentMode,
  type FundAmountSignPolicy,
  type FundAmountStrategy,
  type FundBusinessCategory,
  type FundEntryDirection,
  type FundPostingRuleLeg,
  type FundRuleInputMode,
} from '../domain'
import type { FundMetadata } from './fund-posting.contract'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

type FundAccountOwnerType = 'USER' | 'COMPANY'

export interface FundPostingBusinessSourceRecord {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly enabled: boolean
}

export interface FundPostingRuleVersionRecord {
  readonly id: string
  readonly revision: number
  readonly status: 'ACTIVE'
  readonly legs: readonly FundPostingRuleLeg[]
}

export interface FundPostingTypeRecord {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly businessCategory: FundBusinessCategory
  readonly requiresUser: boolean
  readonly amountSignPolicy: FundAmountSignPolicy
  readonly inputMode: FundRuleInputMode
  readonly enabled: boolean
  readonly currentRuleVersionId: string | null
  readonly ruleVersion: FundPostingRuleVersionRecord | null
}

export interface FundPostingAccountIdentities {
  readonly userAccountId: string | null
  readonly companyAccountId: string | null
}

export interface FundManualAdjustmentIdentities
  extends FundPostingAccountIdentities {
  readonly userId: string
  readonly userAccountId: string
}

export interface FundLockedAccountRecord {
  readonly id: string
  readonly ownerType: FundAccountOwnerType
  readonly userId: string | null
  readonly balance: string
  readonly userShareRate: string | null
  readonly nextSequence: bigint
  readonly version: number
}

export interface FundIdempotentPostingRecord {
  readonly requestFingerprintHash: Buffer
  readonly batchId: string
  readonly postingTypeCode: string
  readonly businessCategory: FundBusinessCategory
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly entries: readonly {
    readonly entryId: string
    readonly accountId: string
    readonly accountTarget: FundAccountTarget
    readonly direction: FundEntryDirection
    readonly amount: string
    readonly balanceBefore: string
    readonly balanceAfter: string
    readonly accountSequence: string
  }[]
  readonly postedAt: Date
}

export interface FundPostingBatchInsert {
  readonly id: string
  readonly batchNo: string
  readonly kind: 'BUSINESS'
  readonly postingTypeId: string
  readonly postingTypeCodeSnapshot: string
  readonly postingTypeNameSnapshot: string
  readonly businessCategorySnapshot: FundBusinessCategory
  readonly businessSourceId: string
  readonly businessSourceCodeSnapshot: string
  readonly businessSourceNameSnapshot: string
  readonly ruleVersionId: string
  readonly ruleRevisionSnapshot: number
  readonly userId: string | null
  readonly businessAmount: string
  readonly userShareRateSnapshot: string | null
  readonly companyShareRateSnapshot: string | null
  readonly businessId: string
  readonly businessNo: string | null
  readonly summary: string
  readonly metadata: FundMetadata
  readonly businessOccurredAt: Date
  readonly consumerCode: string
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
  readonly requestId: string
  readonly correlationId: string | null
  readonly postedAt: Date
}

export interface FundManualAdjustmentBatchInsert {
  readonly id: string
  readonly batchNo: string
  readonly kind: 'MANUAL_ADJUSTMENT'
  readonly postingTypeId: string
  readonly postingTypeCodeSnapshot: string
  readonly postingTypeNameSnapshot: string
  readonly businessCategorySnapshot: 'ADJUSTMENT'
  readonly businessSourceId: string
  readonly businessSourceCodeSnapshot: string
  readonly businessSourceNameSnapshot: string
  readonly ruleVersionId: string
  readonly ruleRevisionSnapshot: number
  readonly userId: string
  readonly businessAmount: string
  readonly userShareRateSnapshot: string
  readonly companyShareRateSnapshot: string
  readonly businessId: string
  readonly summary: string
  readonly metadata: FundMetadata
  readonly businessOccurredAt: Date
  readonly consumerCode: string
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
  readonly adjustmentMode: FundAdjustmentMode
  readonly actorUserId: string
  readonly requestId: string
  readonly correlationId: string | null
  readonly postedAt: Date
}

export interface FundPostingAccountUpdate {
  readonly accountId: string
  readonly expectedVersion: number
  readonly expectedNextSequence: bigint
  readonly balanceAfter: string
  readonly nextSequence: bigint
  readonly asOf: Date
}

export interface FundLedgerEntryInsert {
  readonly id: string
  readonly batchId: string
  readonly lineNo: number
  readonly accountId: string
  readonly direction: FundEntryDirection
  readonly accountTarget: FundAccountTarget
  readonly amountStrategy: FundAmountStrategy
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly accountSequence: bigint
  readonly postedAt: Date
}

interface TransactionTimestampRow {
  readonly asOf: unknown
}

interface BusinessSourceDatabaseRow {
  readonly id: unknown
  readonly code: unknown
  readonly name: unknown
  readonly enabled: unknown
}

interface PostingTypeDatabaseRow {
  readonly id: unknown
  readonly code: unknown
  readonly name: unknown
  readonly businessCategory: unknown
  readonly requiresUser: unknown
  readonly amountSignPolicy: unknown
  readonly inputMode: unknown
  readonly enabled: unknown
  readonly currentRuleVersionId: unknown
  readonly ruleVersionId: unknown
  readonly ruleRevision: unknown
  readonly ruleStatus: unknown
  readonly legPosition: unknown
  readonly accountTarget: unknown
  readonly directionPolicy: unknown
  readonly amountStrategy: unknown
  readonly adjustmentMode: unknown
}

interface AuthorizationDatabaseRow {
  readonly allowed: unknown
}

interface AccountIdentityDatabaseRow {
  readonly id: unknown
  readonly ownerType: unknown
  readonly userId: unknown
}

interface LockedAccountDatabaseRow extends AccountIdentityDatabaseRow {
  readonly balance: unknown
  readonly userShareRate: unknown
  readonly nextSequence: unknown
  readonly version: unknown
}

interface IdempotentPostingDatabaseRow {
  readonly batchId: unknown
  readonly postingTypeCode: unknown
  readonly businessCategory: unknown
  readonly businessAmount: unknown
  readonly userShareRateSnapshot: unknown
  readonly companyShareRateSnapshot: unknown
  readonly postedAt: unknown
  readonly requestFingerprintHash: unknown
  readonly lineNo: unknown
  readonly entryId: unknown
  readonly accountId: unknown
  readonly accountTarget: unknown
  readonly direction: unknown
  readonly entryAmount: unknown
  readonly balanceBefore: unknown
  readonly balanceAfter: unknown
  readonly accountSequence: unknown
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

function isNonblankText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function isUuidText(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index])
}

export async function readFundPostingTransactionTimestamp(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<TransactionTimestampRow[]>(
    Prisma.sql`SELECT transaction_timestamp() AS "asOf"`,
  )
  const asOf = rows[0]?.asOf
  if (!isDate(asOf)) return persistenceInvariant()
  return asOf
}

/** 来源使用 SHARE 锁：并发业务调用可共存，但来源启停与授权修改必须等待。 */
export async function lockFundBusinessSourceForPosting(
  transaction: Prisma.TransactionClient,
  sourceCode: string,
): Promise<FundPostingBusinessSourceRecord | null> {
  const rows = await transaction.$queryRaw<BusinessSourceDatabaseRow[]>(
    Prisma.sql`
      SELECT
        source."id",
        source."code",
        source."name",
        source."enabled"
      FROM "fund_business_sources" AS source
      WHERE source."code" = ${sourceCode}
      FOR SHARE OF source
    `,
  )
  const row = rows[0]
  if (row === undefined) return null
  if (
    rows.length !== 1
    || !isUuidText(row.id)
    || !isNonblankText(row.code)
    || !isNonblankText(row.name)
    || typeof row.enabled !== 'boolean'
  ) {
    return persistenceInvariant()
  }
  return Object.freeze({
    id: row.id,
    code: row.code,
    name: row.name,
    enabled: row.enabled,
  })
}

/**
 * 类型主行使用 SHARE 锁，使 current rule 指针在本次事务内稳定；ACTIVE 版本和
 * legs 已由数据库冻结，因此无需扩大行锁范围。
 */
export async function lockFundPostingTypeForPosting(
  transaction: Prisma.TransactionClient,
  postingTypeCode: string,
): Promise<FundPostingTypeRecord | null> {
  const rows = await transaction.$queryRaw<PostingTypeDatabaseRow[]>(
    Prisma.sql`
      SELECT
        posting_type."id",
        posting_type."code",
        posting_type."name",
        posting_type."business_category"::text AS "businessCategory",
        posting_type."requires_user" AS "requiresUser",
        posting_type."amount_sign_policy"::text AS "amountSignPolicy",
        posting_type."input_mode"::text AS "inputMode",
        posting_type."enabled",
        posting_type."current_rule_version_id" AS "currentRuleVersionId",
        rule_version."id" AS "ruleVersionId",
        rule_version."revision" AS "ruleRevision",
        rule_version."status"::text AS "ruleStatus",
        leg."position" AS "legPosition",
        leg."account_target"::text AS "accountTarget",
        leg."direction_policy"::text AS "directionPolicy",
        leg."amount_strategy"::text AS "amountStrategy",
        leg."adjustment_mode"::text AS "adjustmentMode"
      FROM "fund_posting_types" AS posting_type
      LEFT JOIN "fund_posting_rule_versions" AS rule_version
        ON rule_version."id" = posting_type."current_rule_version_id"
        AND rule_version."posting_type_id" = posting_type."id"
      LEFT JOIN "fund_posting_rule_legs" AS leg
        ON leg."rule_version_id" = rule_version."id"
      WHERE posting_type."code" = ${postingTypeCode}
      ORDER BY leg."position" ASC, leg."id" ASC
      FOR SHARE OF posting_type
    `,
  )
  const first = rows[0]
  if (first === undefined) return null
  if (
    !isUuidText(first.id)
    || !isNonblankText(first.code)
    || !isNonblankText(first.name)
    || !isOneOf(first.businessCategory, FUND_BUSINESS_CATEGORIES)
    || typeof first.requiresUser !== 'boolean'
    || !isOneOf(first.amountSignPolicy, FUND_AMOUNT_SIGN_POLICIES)
    || !isOneOf(first.inputMode, FUND_RULE_INPUT_MODES)
    || typeof first.enabled !== 'boolean'
    || (first.currentRuleVersionId !== null
      && !isUuidText(first.currentRuleVersionId))
  ) {
    return persistenceInvariant()
  }

  const sameType = rows.every(row => (
    row.id === first.id
    && row.code === first.code
    && row.name === first.name
    && row.businessCategory === first.businessCategory
    && row.requiresUser === first.requiresUser
    && row.amountSignPolicy === first.amountSignPolicy
    && row.inputMode === first.inputMode
    && row.enabled === first.enabled
    && row.currentRuleVersionId === first.currentRuleVersionId
  ))
  if (!sameType) return persistenceInvariant()

  let ruleVersion: FundPostingRuleVersionRecord | null = null
  if (first.currentRuleVersionId === null) {
    if (rows.length !== 1 || first.ruleVersionId !== null) {
      return persistenceInvariant()
    }
  }
  else {
    if (
      !isUuidText(first.ruleVersionId)
      || first.ruleVersionId !== first.currentRuleVersionId
      || !Number.isInteger(first.ruleRevision)
      || Number(first.ruleRevision) < 1
      || first.ruleStatus !== 'ACTIVE'
      || rows.some(row => (
        row.ruleVersionId !== first.ruleVersionId
        || row.ruleRevision !== first.ruleRevision
        || row.ruleStatus !== first.ruleStatus
      ))
    ) {
      return persistenceInvariant()
    }

    const legs = rows.flatMap<FundPostingRuleLeg>((row) => {
      const allNull = row.legPosition === null
        && row.accountTarget === null
        && row.directionPolicy === null
        && row.amountStrategy === null
        && row.adjustmentMode === null
      if (allNull) return []
      if (
        !Number.isInteger(row.legPosition)
        || Number(row.legPosition) < 1
        || !isOneOf(row.accountTarget, FUND_ACCOUNT_TARGETS)
        || !isOneOf(row.directionPolicy, FUND_DIRECTION_POLICIES)
        || !isOneOf(row.amountStrategy, FUND_AMOUNT_STRATEGIES)
        || (row.adjustmentMode !== null
          && !isOneOf(row.adjustmentMode, FUND_ADJUSTMENT_MODES))
      ) {
        return persistenceInvariant()
      }
      return [Object.freeze({
        position: Number(row.legPosition),
        accountTarget: row.accountTarget,
        directionPolicy: row.directionPolicy,
        amountStrategy: row.amountStrategy,
        ...(row.adjustmentMode === null
          ? {}
          : { adjustmentMode: row.adjustmentMode }),
      })]
    })
    ruleVersion = Object.freeze({
      id: first.ruleVersionId,
      revision: Number(first.ruleRevision),
      status: 'ACTIVE',
      legs: Object.freeze(legs),
    })
  }

  return Object.freeze({
    id: first.id,
    code: first.code,
    name: first.name,
    businessCategory: first.businessCategory,
    requiresUser: first.requiresUser,
    amountSignPolicy: first.amountSignPolicy,
    inputMode: first.inputMode,
    enabled: first.enabled,
    currentRuleVersionId: first.currentRuleVersionId,
    ruleVersion,
  })
}

export async function readFundSourceTypeAuthorization(
  transaction: Prisma.TransactionClient,
  businessSourceId: string,
  postingTypeId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<AuthorizationDatabaseRow[]>(
    Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "fund_business_source_posting_types"
        WHERE "business_source_id" = CAST(${businessSourceId} AS uuid)
          AND "posting_type_id" = CAST(${postingTypeId} AS uuid)
      ) AS "allowed"
    `,
  )
  const allowed = rows[0]?.allowed
  if (rows.length !== 1 || typeof allowed !== 'boolean') {
    return persistenceInvariant()
  }
  return allowed
}

/** 身份读取只定位稳定账户 ID；真正余额、比例和序号必须在后续 FOR UPDATE 内读取。 */
export async function readFundAccountIdentitiesForPosting(
  transaction: Prisma.TransactionClient,
  input: {
    readonly userId: string | null
    readonly requireUserAccount: boolean
    readonly requireCompanyAccount: boolean
  },
): Promise<FundPostingAccountIdentities> {
  const rows = await transaction.$queryRaw<AccountIdentityDatabaseRow[]>(
    Prisma.sql`
      SELECT
        account."id",
        account."owner_type"::text AS "ownerType",
        account."user_id" AS "userId"
      FROM "fund_accounts" AS account
      WHERE (
        ${input.requireUserAccount}
        AND account."owner_type" = 'USER'::"fund_account_owner_type"
        AND account."user_id" = CAST(${input.userId} AS uuid)
      ) OR (
        ${input.requireCompanyAccount}
        AND account."owner_type" = 'COMPANY'::"fund_account_owner_type"
      )
      ORDER BY account."id" ASC
    `,
  )

  let userAccountId: string | null = null
  let companyAccountId: string | null = null
  for (const row of rows) {
    if (
      !isUuidText(row.id)
      || !isOneOf(row.ownerType, ['USER', 'COMPANY'] as const)
      || (row.userId !== null && !isUuidText(row.userId))
    ) {
      return persistenceInvariant()
    }
    if (row.ownerType === 'USER') {
      if (userAccountId !== null || row.userId !== input.userId) {
        return persistenceInvariant()
      }
      userAccountId = row.id
    }
    else {
      if (companyAccountId !== null || row.userId !== null) {
        return persistenceInvariant()
      }
      companyAccountId = row.id
    }
  }
  return Object.freeze({ userAccountId, companyAccountId })
}

/** 管理员调账从路径账户反查用户，绝不接受调用方自行声明 userId 或账户比例。 */
export async function readFundManualAdjustmentIdentities(
  transaction: Prisma.TransactionClient,
  input: {
    readonly userAccountId: string
    readonly requireCompanyAccount: boolean
  },
): Promise<FundManualAdjustmentIdentities | null> {
  const rows = await transaction.$queryRaw<AccountIdentityDatabaseRow[]>(
    Prisma.sql`
      SELECT
        account."id",
        account."owner_type"::text AS "ownerType",
        account."user_id" AS "userId"
      FROM "fund_accounts" AS account
      WHERE account."id" = CAST(${input.userAccountId} AS uuid)
        OR (
          ${input.requireCompanyAccount}
          AND account."owner_type" = 'COMPANY'::"fund_account_owner_type"
        )
      ORDER BY account."id" ASC
    `,
  )

  let selectedUserId: string | null = null
  let selectedUserAccountId: string | null = null
  let companyAccountId: string | null = null
  for (const row of rows) {
    if (
      !isUuidText(row.id)
      || !isOneOf(row.ownerType, ['USER', 'COMPANY'] as const)
      || (row.userId !== null && !isUuidText(row.userId))
    ) {
      return persistenceInvariant()
    }
    if (row.id === input.userAccountId) {
      if (row.ownerType !== 'USER' || row.userId === null) return null
      selectedUserAccountId = row.id
      selectedUserId = row.userId
      continue
    }
    if (row.ownerType !== 'COMPANY' || row.userId !== null) {
      return persistenceInvariant()
    }
    if (companyAccountId !== null) return persistenceInvariant()
    companyAccountId = row.id
  }

  if (selectedUserAccountId === null || selectedUserId === null) return null
  return Object.freeze({
    userId: selectedUserId,
    userAccountId: selectedUserAccountId,
    companyAccountId,
  })
}

export async function lockFundAccountsForPosting(
  transaction: Prisma.TransactionClient,
  accountIds: readonly string[],
): Promise<readonly FundLockedAccountRecord[]> {
  if (
    accountIds.length === 0
    || new Set(accountIds).size !== accountIds.length
    || accountIds.some((id, index) => index > 0 && accountIds[index - 1] > id)
  ) {
    return persistenceInvariant()
  }
  const idSql = accountIds.map(id => Prisma.sql`CAST(${id} AS uuid)`)
  const rows = await transaction.$queryRaw<LockedAccountDatabaseRow[]>(
    Prisma.sql`
      SELECT
        account."id",
        account."owner_type"::text AS "ownerType",
        account."user_id" AS "userId",
        account."balance",
        account."user_share_rate" AS "userShareRate",
        account."next_sequence" AS "nextSequence",
        account."version"
      FROM "fund_accounts" AS account
      WHERE account."id" IN (${Prisma.join(idSql)})
      ORDER BY account."id" ASC
      FOR UPDATE OF account
    `,
  )
  if (rows.length !== accountIds.length) return persistenceInvariant()

  return Object.freeze(rows.map((row, index) => {
    if (
      row.id !== accountIds[index]
      || !isUuidText(row.id)
      || !isOneOf(row.ownerType, ['USER', 'COMPANY'] as const)
      || (row.userId !== null && !isUuidText(row.userId))
      || typeof row.nextSequence !== 'bigint'
      || row.nextSequence < 1n
      || !Number.isInteger(row.version)
      || Number(row.version) < 1
    ) {
      return persistenceInvariant()
    }
    const userShareRate = nullableShareRate(row.userShareRate)
    if (
      (row.ownerType === 'USER'
        && (row.userId === null || userShareRate === null))
      || (row.ownerType === 'COMPANY'
        && (row.userId !== null || userShareRate !== null))
    ) {
      return persistenceInvariant()
    }
    return Object.freeze({
      id: row.id,
      ownerType: row.ownerType,
      userId: row.userId,
      balance: decimalAmount(row.balance),
      userShareRate,
      nextSequence: row.nextSequence,
      version: Number(row.version),
    })
  }))
}

export async function readIdempotentFundPosting(
  transaction: Prisma.TransactionClient,
  input: {
    readonly consumerCode: string
    readonly sourceCode: string
    readonly idempotencyKeyHash: Buffer
  },
): Promise<FundIdempotentPostingRecord | null> {
  const rows = await transaction.$queryRaw<IdempotentPostingDatabaseRow[]>(
    Prisma.sql`
      SELECT
        batch."id" AS "batchId",
        batch."posting_type_code_snapshot" AS "postingTypeCode",
        batch."business_category_snapshot"::text AS "businessCategory",
        batch."business_amount" AS "businessAmount",
        batch."user_share_rate_snapshot" AS "userShareRateSnapshot",
        batch."company_share_rate_snapshot" AS "companyShareRateSnapshot",
        batch."posted_at" AS "postedAt",
        batch."request_fingerprint_hash" AS "requestFingerprintHash",
        entry."line_no" AS "lineNo",
        entry."id" AS "entryId",
        entry."account_id" AS "accountId",
        entry."account_target"::text AS "accountTarget",
        entry."direction"::text AS "direction",
        entry."amount" AS "entryAmount",
        entry."balance_before" AS "balanceBefore",
        entry."balance_after" AS "balanceAfter",
        entry."account_sequence" AS "accountSequence"
      FROM "fund_posting_batches" AS batch
      INNER JOIN "fund_ledger_entries" AS entry
        ON entry."batch_id" = batch."id"
      WHERE batch."consumer_code" = ${input.consumerCode}
        AND batch."business_source_code_snapshot" = ${input.sourceCode}
        AND batch."idempotency_key_hash" = ${input.idempotencyKeyHash}
      ORDER BY entry."line_no" ASC, entry."id" ASC
    `,
  )
  const first = rows[0]
  if (first === undefined) return null
  if (
    !isUuidText(first.batchId)
    || !isNonblankText(first.postingTypeCode)
    || !isOneOf(first.businessCategory, FUND_BUSINESS_CATEGORIES)
    || !isDate(first.postedAt)
    || !(first.requestFingerprintHash instanceof Uint8Array)
    || first.requestFingerprintHash.byteLength !== 32
  ) {
    return persistenceInvariant()
  }
  const firstPostedAt = first.postedAt
  const firstFingerprintHash = first.requestFingerprintHash
  const businessAmount = decimalAmount(first.businessAmount)
  const userShareRateSnapshot = nullableShareRate(first.userShareRateSnapshot)
  const companyShareRateSnapshot = nullableShareRate(
    first.companyShareRateSnapshot,
  )
  if ((userShareRateSnapshot === null) !== (companyShareRateSnapshot === null)) {
    return persistenceInvariant()
  }

  const entries = rows.map((row, index) => {
    if (
      row.batchId !== first.batchId
      || row.postingTypeCode !== first.postingTypeCode
      || row.businessCategory !== first.businessCategory
      || decimalAmount(row.businessAmount) !== businessAmount
      || nullableShareRate(row.userShareRateSnapshot) !== userShareRateSnapshot
      || nullableShareRate(row.companyShareRateSnapshot)
        !== companyShareRateSnapshot
      || !isDate(row.postedAt)
      || row.postedAt.getTime() !== firstPostedAt.getTime()
      || !(row.requestFingerprintHash instanceof Uint8Array)
      || !equalBytes(row.requestFingerprintHash, firstFingerprintHash)
      || row.lineNo !== index + 1
      || !isUuidText(row.entryId)
      || !isUuidText(row.accountId)
      || !isOneOf(row.accountTarget, FUND_ACCOUNT_TARGETS)
      || !isOneOf(row.direction, FUND_ENTRY_DIRECTIONS)
      || typeof row.accountSequence !== 'bigint'
      || row.accountSequence < 1n
    ) {
      return persistenceInvariant()
    }
    const amount = decimalAmount(row.entryAmount)
    if (parseFundAmountMinor(amount) <= 0n) return persistenceInvariant()
    return Object.freeze({
      entryId: row.entryId,
      accountId: row.accountId,
      accountTarget: row.accountTarget,
      direction: row.direction,
      amount,
      balanceBefore: decimalAmount(row.balanceBefore),
      balanceAfter: decimalAmount(row.balanceAfter),
      accountSequence: row.accountSequence.toString(),
    })
  })

  return Object.freeze({
    requestFingerprintHash: Buffer.from(firstFingerprintHash),
    batchId: first.batchId,
    postingTypeCode: first.postingTypeCode,
    businessCategory: first.businessCategory,
    businessAmount,
    userShareRateSnapshot,
    companyShareRateSnapshot,
    entries: Object.freeze(entries),
    postedAt: firstPostedAt,
  })
}

export async function insertFundPostingBatch(
  transaction: Prisma.TransactionClient,
  input: FundPostingBatchInsert,
): Promise<void> {
  if (
    input.idempotencyKeyHash.byteLength !== 32
    || input.requestFingerprintHash.byteLength !== 32
  ) {
    return persistenceInvariant()
  }
  const metadata = Object.fromEntries(
    Object.entries(input.metadata),
  ) as Prisma.InputJsonObject
  const created = await transaction.fundPostingBatch.create({
    data: {
      id: input.id,
      batchNo: input.batchNo,
      kind: input.kind,
      postingTypeId: input.postingTypeId,
      postingTypeCodeSnapshot: input.postingTypeCodeSnapshot,
      postingTypeNameSnapshot: input.postingTypeNameSnapshot,
      businessCategorySnapshot: input.businessCategorySnapshot,
      businessSourceId: input.businessSourceId,
      businessSourceCodeSnapshot: input.businessSourceCodeSnapshot,
      businessSourceNameSnapshot: input.businessSourceNameSnapshot,
      ruleVersionId: input.ruleVersionId,
      ruleRevisionSnapshot: input.ruleRevisionSnapshot,
      userId: input.userId,
      businessAmount: new Prisma.Decimal(input.businessAmount),
      currency: 'CNY',
      userShareRateSnapshot: input.userShareRateSnapshot === null
        ? null
        : new Prisma.Decimal(input.userShareRateSnapshot),
      companyShareRateSnapshot: input.companyShareRateSnapshot === null
        ? null
        : new Prisma.Decimal(input.companyShareRateSnapshot),
      businessId: input.businessId,
      businessNo: input.businessNo,
      summary: input.summary,
      metadata,
      businessOccurredAt: input.businessOccurredAt,
      consumerCode: input.consumerCode,
      idempotencyKeyHash: Uint8Array.from(input.idempotencyKeyHash),
      requestFingerprintHash: Uint8Array.from(input.requestFingerprintHash),
      adjustmentMode: null,
      reversalOfBatchId: null,
      reversalReason: null,
      actorUserId: null,
      requestId: input.requestId,
      correlationId: input.correlationId,
      postedAt: input.postedAt,
    },
    select: { id: true },
  })
  if (created.id !== input.id) return persistenceInvariant()
}

/** 管理员调账单独写入 actor 和模式；普通业务写账入口无法构造该批次类型。 */
export async function insertFundManualAdjustmentBatch(
  transaction: Prisma.TransactionClient,
  input: FundManualAdjustmentBatchInsert,
): Promise<void> {
  if (
    input.idempotencyKeyHash.byteLength !== 32
    || input.requestFingerprintHash.byteLength !== 32
  ) {
    return persistenceInvariant()
  }
  const metadata = Object.fromEntries(
    Object.entries(input.metadata),
  ) as Prisma.InputJsonObject
  const created = await transaction.fundPostingBatch.create({
    data: {
      id: input.id,
      batchNo: input.batchNo,
      kind: input.kind,
      postingTypeId: input.postingTypeId,
      postingTypeCodeSnapshot: input.postingTypeCodeSnapshot,
      postingTypeNameSnapshot: input.postingTypeNameSnapshot,
      businessCategorySnapshot: input.businessCategorySnapshot,
      businessSourceId: input.businessSourceId,
      businessSourceCodeSnapshot: input.businessSourceCodeSnapshot,
      businessSourceNameSnapshot: input.businessSourceNameSnapshot,
      ruleVersionId: input.ruleVersionId,
      ruleRevisionSnapshot: input.ruleRevisionSnapshot,
      userId: input.userId,
      businessAmount: new Prisma.Decimal(input.businessAmount),
      currency: 'CNY',
      userShareRateSnapshot: new Prisma.Decimal(input.userShareRateSnapshot),
      companyShareRateSnapshot: new Prisma.Decimal(
        input.companyShareRateSnapshot,
      ),
      businessId: input.businessId,
      businessNo: null,
      summary: input.summary,
      metadata,
      businessOccurredAt: input.businessOccurredAt,
      consumerCode: input.consumerCode,
      idempotencyKeyHash: Uint8Array.from(input.idempotencyKeyHash),
      requestFingerprintHash: Uint8Array.from(input.requestFingerprintHash),
      adjustmentMode: input.adjustmentMode,
      reversalOfBatchId: null,
      reversalReason: null,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      postedAt: input.postedAt,
    },
    select: { id: true },
  })
  if (created.id !== input.id) return persistenceInvariant()
}

export async function updateFundAccountForPosting(
  transaction: Prisma.TransactionClient,
  input: FundPostingAccountUpdate,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ readonly id: unknown }>>(
    Prisma.sql`
      UPDATE "fund_accounts"
      SET
        "balance" = CAST(${input.balanceAfter} AS numeric(30, 4)),
        "next_sequence" = ${input.nextSequence},
        "version" = "version" + 1,
        "updated_at" = ${input.asOf}
      WHERE "id" = CAST(${input.accountId} AS uuid)
        AND "version" = ${input.expectedVersion}
        AND "next_sequence" = ${input.expectedNextSequence}
      RETURNING "id"
    `,
  )
  if (rows.length === 0) return false
  if (rows.length !== 1 || rows[0]?.id !== input.accountId) {
    return persistenceInvariant()
  }
  return true
}

export async function insertFundLedgerEntries(
  transaction: Prisma.TransactionClient,
  entries: readonly FundLedgerEntryInsert[],
): Promise<void> {
  if (entries.length === 0) return persistenceInvariant()
  const result = await transaction.fundLedgerEntry.createMany({
    data: entries.map(entry => ({
      id: entry.id,
      batchId: entry.batchId,
      lineNo: entry.lineNo,
      accountId: entry.accountId,
      direction: entry.direction,
      accountTarget: entry.accountTarget,
      amountStrategy: entry.amountStrategy,
      amount: new Prisma.Decimal(entry.amount),
      balanceBefore: new Prisma.Decimal(entry.balanceBefore),
      balanceAfter: new Prisma.Decimal(entry.balanceAfter),
      accountSequence: entry.accountSequence,
      postedAt: entry.postedAt,
    })),
  })
  if (result.count !== entries.length) return persistenceInvariant()
}
