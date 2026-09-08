import { Prisma } from '../../generated/prisma/client'
import {
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
  type NumberingRuleStatus as NumberingRuleStatusValue,
} from '../../generated/prisma/enums'
import { NUMBERING_CONFIG_TIMEZONE } from './numbering-config-fingerprint'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleSegment,
  validateNumberingRuleConfig,
} from './rule-engine'

const ACTIVE_GENERATION_SNAPSHOT_SELECT = {
  id: true,
  revision: true,
  resetPolicy: true,
  timezone: true,
  segments: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      position: true,
      type: true,
      fixedValue: true,
      dateFormat: true,
      separatorValue: true,
      sequenceWidth: true,
      sequenceStartValue: true,
      sequenceStep: true,
      randomLetterLength: true,
      randomDigitLength: true,
      randomMode: true,
    },
  },
} as const satisfies Prisma.NumberingRuleVersionSelect

type StoredActiveGenerationSnapshot =
  Prisma.NumberingRuleVersionGetPayload<{
    select: typeof ACTIVE_GENERATION_SNAPSHOT_SELECT
  }>
type StoredGenerationSegment = StoredActiveGenerationSnapshot['segments'][number]

const STORED_SEGMENT_VALUE_FIELDS = [
  'fixedValue',
  'dateFormat',
  'separatorValue',
  'sequenceWidth',
  'sequenceStartValue',
  'sequenceStep',
  'randomLetterLength',
  'randomDigitLength',
  'randomMode',
] as const satisfies readonly (keyof StoredGenerationSegment)[]

type StoredSegmentValueField =
  (typeof STORED_SEGMENT_VALUE_FIELDS)[number]

interface IdempotentIssuanceDatabaseRow {
  readonly id: string
  readonly ruleCode: string
  readonly revision: number
  readonly generatedNumber: string
  readonly issuedAt: Date
  readonly requestFingerprintHash: Uint8Array
}

interface GenerationRuleDatabaseRow {
  readonly id: string
  readonly status: NumberingRuleStatusValue
  readonly version: number
}

interface PeriodStateDatabaseRow {
  readonly id: string
  readonly ruleId: string
  readonly periodKey: string
  readonly nextSequenceValue: unknown
  readonly usedCount: unknown
}

interface InsertedIssuanceRow {
  readonly id: string
}

export interface IdempotentIssuanceRecord {
  readonly id: string
  readonly ruleCode: string
  readonly revision: number
  readonly generatedNumber: string
  readonly issuedAt: Date
  readonly requestFingerprintHash: Buffer
}

export interface GenerationRuleRecord {
  readonly id: string
  readonly status: NumberingRuleStatusValue
  readonly version: number
}

export interface ActiveGenerationSnapshot {
  readonly versionId: string
  readonly revision: number
  readonly config: NumberingRuleConfig
}

export interface LockOrCreatePeriodStateInput {
  readonly ruleId: string
  readonly periodKey: string
  readonly initialNextSequenceValue: bigint | null
}

export interface LockedPeriodState {
  readonly id: string
  readonly ruleId: string
  readonly periodKey: string
  readonly nextSequenceValue: bigint | null
  readonly usedCount: bigint
}

interface NumberingIssuanceInsertBase {
  readonly ruleId: string
  readonly ruleVersionId: string
  readonly periodKey: string
  readonly generatedNumber: string
  readonly consumerCode: string
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
  /** 必须由 generator 传入同一事务读取到的数据库时间。 */
  readonly issuedAt: Date
}

export interface SequenceIssuanceInsertInput
  extends NumberingIssuanceInsertBase {
  readonly sequenceValue: bigint
}

export interface RandomIssuanceInsertInput
  extends NumberingIssuanceInsertBase {
  readonly sequenceValue: null
}

export interface AdvancePeriodStateInput {
  readonly periodStateId: string
  readonly nextSequenceValue: bigint | null
}

function persistenceInvariant(message: string): never {
  throw new Error(message)
}

function invalidStoredConfig(path: string): never {
  throw new NumberingRuleConfigError([
    { path, message: '持久化配置结构不合法' },
  ])
}

function assertNoUnexpectedSegmentValues(
  row: StoredGenerationSegment,
  allowedFields: readonly StoredSegmentValueField[],
): void {
  for (const field of STORED_SEGMENT_VALUE_FIELDS) {
    if (!allowedFields.includes(field) && row[field] !== null) {
      invalidStoredConfig(`segments[${row.position}].${field}`)
    }
  }
}

/**
 * 数据库 CHECK 是第一道防线，这里仍按判别字段重验每个物理列，避免损坏快照
 * 在映射时悄悄丢弃不属于当前 segment type 的非空值。
 */
function mapStoredGenerationSegment(
  row: StoredGenerationSegment,
): NumberingRuleSegment {
  const segmentPath = `segments[${row.position}]`

  switch (row.type) {
    case 'FIXED':
      assertNoUnexpectedSegmentValues(row, ['fixedValue'])
      return row.fixedValue === null
        ? invalidStoredConfig(`${segmentPath}.value`)
        : { type: 'FIXED', value: row.fixedValue }
    case 'DATE':
      assertNoUnexpectedSegmentValues(row, ['dateFormat'])
      return row.dateFormat === null
        ? invalidStoredConfig(`${segmentPath}.format`)
        : { type: 'DATE', format: row.dateFormat }
    case 'SEPARATOR':
      assertNoUnexpectedSegmentValues(row, ['separatorValue'])
      return row.separatorValue !== '-'
        && row.separatorValue !== '_'
        && row.separatorValue !== '.'
        && row.separatorValue !== '/'
        ? invalidStoredConfig(`${segmentPath}.value`)
        : { type: 'SEPARATOR', value: row.separatorValue }
    case 'SEQUENCE':
      assertNoUnexpectedSegmentValues(row, [
        'sequenceWidth',
        'sequenceStartValue',
        'sequenceStep',
      ])
      return row.sequenceWidth === null
        || row.sequenceStartValue === null
        || row.sequenceStep === null
        ? invalidStoredConfig(segmentPath)
        : {
            type: 'SEQUENCE',
            width: row.sequenceWidth,
            startValue: row.sequenceStartValue.toString(),
            step: row.sequenceStep.toString(),
          }
    case 'RANDOM':
      assertNoUnexpectedSegmentValues(row, [
        'randomLetterLength',
        'randomDigitLength',
        'randomMode',
      ])
      return row.randomLetterLength === null
        || row.randomDigitLength === null
        || row.randomMode === null
        ? invalidStoredConfig(segmentPath)
        : {
            type: 'RANDOM',
            letterLength: row.randomLetterLength,
            digitLength: row.randomDigitLength,
            mode: row.randomMode,
          }
    default:
      return invalidStoredConfig(`${segmentPath}.type`)
  }
}

function toDatabaseBigInt(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) {
    return value
  }
  if (
    typeof value === 'string'
    && /^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return BigInt(value)
  }
  return persistenceInvariant('Numbering period state invariant violated')
}

function isNumberingRuleStatus(
  value: unknown,
): value is NumberingRuleStatusValue {
  return value === NumberingRuleStatus.DRAFT
    || value === NumberingRuleStatus.ENABLED
    || value === NumberingRuleStatus.DISABLED
}

/**
 * 该读取是 generator 内部幂等边界：SELECT 不包含幂等 Hash，输入也只接受预先
 * 计算好的 32-byte Hash，原始凭证不会进入 persistence。
 */
export async function readIdempotentIssuance(
  transaction: Prisma.TransactionClient,
  consumerCode: string,
  idempotencyKeyHash: Buffer,
): Promise<IdempotentIssuanceRecord | null> {
  const rows = await transaction.$queryRaw<IdempotentIssuanceDatabaseRow[]>(
    Prisma.sql`
      SELECT
        i."id",
        r."rule_code" AS "ruleCode",
        v."revision",
        i."generated_number" AS "generatedNumber",
        i."issued_at" AS "issuedAt",
        i."request_fingerprint_hash" AS "requestFingerprintHash"
      FROM "numbering_issuances" i
      INNER JOIN "numbering_rules" r
        ON r."id" = i."rule_id"
      INNER JOIN "numbering_rule_versions" v
        ON v."id" = i."rule_version_id"
        AND v."rule_id" = i."rule_id"
      WHERE i."consumer_code" = ${consumerCode}
        AND i."idempotency_key_hash" = ${idempotencyKeyHash}
      LIMIT 1
    `,
  )
  const row = rows[0]

  if (row === undefined) {
    return null
  }
  if (
    typeof row.id !== 'string'
    || typeof row.ruleCode !== 'string'
    || !Number.isInteger(row.revision)
    || row.revision < 1
    || typeof row.generatedNumber !== 'string'
    || !(row.issuedAt instanceof Date)
    || Number.isNaN(row.issuedAt.getTime())
    || !(row.requestFingerprintHash instanceof Uint8Array)
    || row.requestFingerprintHash.byteLength !== 32
  ) {
    return persistenceInvariant('Numbering issuance invariant violated')
  }

  return {
    id: row.id,
    ruleCode: row.ruleCode,
    revision: row.revision,
    generatedNumber: row.generatedNumber,
    issuedAt: row.issuedAt,
    requestFingerprintHash: Buffer.from(row.requestFingerprintHash),
  }
}

/** rule query 不带 JOIN，因此 FOR SHARE 只锁定匹配的 NumberingRule 行。 */
export async function readRuleForGeneration(
  transaction: Prisma.TransactionClient,
  ruleCode: string,
): Promise<GenerationRuleRecord | null> {
  const rows = await transaction.$queryRaw<GenerationRuleDatabaseRow[]>(
    Prisma.sql`
      SELECT "id", "status"::text AS "status", "version"
      FROM "numbering_rules"
      WHERE "rule_code" = ${ruleCode}
      FOR SHARE
    `,
  )
  const row = rows[0]

  if (row === undefined) {
    return null
  }
  if (
    typeof row.id !== 'string'
    || !isNumberingRuleStatus(row.status)
    || !Number.isInteger(row.version)
    || row.version < 1
  ) {
    return persistenceInvariant('Numbering rule invariant violated')
  }
  return row
}

/**
 * rule shared lock 已由调用方持有；ACTIVE 版本和 segments 在该锁下不可变。本函数
 * 只读取一个 ACTIVE 快照，并在交给渲染器前重建、重验全部配置不变量。
 */
export async function readActiveGenerationSnapshot(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<ActiveGenerationSnapshot | null> {
  const row = await transaction.numberingRuleVersion.findFirst({
    where: {
      ruleId,
      status: NumberingRuleVersionStatus.ACTIVE,
    },
    select: ACTIVE_GENERATION_SNAPSHOT_SELECT,
  })

  if (row === null) {
    return null
  }
  if (
    typeof row.id !== 'string'
    || !Number.isInteger(row.revision)
    || row.revision < 1
  ) {
    return invalidStoredConfig('version')
  }
  if (row.timezone !== NUMBERING_CONFIG_TIMEZONE) {
    return invalidStoredConfig('timezone')
  }
  row.segments.forEach((segment, index) => {
    if (segment.position !== index) {
      invalidStoredConfig(`segments[${index}].position`)
    }
  })

  return {
    versionId: row.id,
    revision: row.revision,
    config: validateNumberingRuleConfig({
      resetPolicy: row.resetPolicy,
      segments: row.segments.map(mapStoredGenerationSegment),
    }),
  }
}

/**
 * 并发首次进入同一周期时，唯一键只负责选出一个 state；DO NOTHING 保证迟到
 * 的事务不会用初始值覆盖已推进状态，随后统一通过 FOR UPDATE 串行化发号。
 */
export async function lockOrCreatePeriodState(
  transaction: Prisma.TransactionClient,
  input: LockOrCreatePeriodStateInput,
): Promise<LockedPeriodState> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "numbering_period_states" (
      "rule_id",
      "period_key",
      "next_sequence_value",
      "used_count"
    ) VALUES (
      CAST(${input.ruleId} AS uuid),
      ${input.periodKey},
      ${input.initialNextSequenceValue},
      0
    )
    ON CONFLICT ("rule_id", "period_key") DO NOTHING
  `)

  const rows = await transaction.$queryRaw<PeriodStateDatabaseRow[]>(Prisma.sql`
    SELECT
      "id",
      "rule_id" AS "ruleId",
      "period_key" AS "periodKey",
      "next_sequence_value" AS "nextSequenceValue",
      "used_count" AS "usedCount"
    FROM "numbering_period_states"
    WHERE "rule_id" = CAST(${input.ruleId} AS uuid)
      AND "period_key" = ${input.periodKey}
    FOR UPDATE
  `)
  const row = rows[0]

  if (
    row === undefined
    || typeof row.id !== 'string'
    || row.ruleId !== input.ruleId
    || row.periodKey !== input.periodKey
  ) {
    return persistenceInvariant('Numbering period state invariant violated')
  }

  return {
    id: row.id,
    ruleId: row.ruleId,
    periodKey: row.periodKey,
    nextSequenceValue: row.nextSequenceValue === null
      ? null
      : toDatabaseBigInt(row.nextSequenceValue),
    usedCount: toDatabaseBigInt(row.usedCount),
  }
}

/** sequence 和 mixed 的重复输出属于状态损坏，保留普通 INSERT 的唯一键异常。 */
export async function insertSequenceIssuance(
  transaction: Prisma.TransactionClient,
  input: SequenceIssuanceInsertInput,
): Promise<string> {
  const issuance = await transaction.numberingIssuance.create({
    data: {
      ...input,
      idempotencyKeyHash: Uint8Array.from(input.idempotencyKeyHash),
      requestFingerprintHash: Uint8Array.from(input.requestFingerprintHash),
    },
    select: { id: true },
  })
  return issuance.id
}

/**
 * pure random 只吞掉规则内 generatedNumber 碰撞。幂等唯一键不在 conflict target
 * 内，其异常必须继续冒泡，由事务回滚后的 replay 协调流程裁决。
 */
export async function tryInsertRandomIssuance(
  transaction: Prisma.TransactionClient,
  input: RandomIssuanceInsertInput,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<InsertedIssuanceRow[]>(Prisma.sql`
    INSERT INTO "numbering_issuances" (
      "rule_id",
      "rule_version_id",
      "period_key",
      "generated_number",
      "sequence_value",
      "consumer_code",
      "idempotency_key_hash",
      "request_fingerprint_hash",
      "issued_at"
    ) VALUES (
      CAST(${input.ruleId} AS uuid),
      CAST(${input.ruleVersionId} AS uuid),
      ${input.periodKey},
      ${input.generatedNumber},
      ${input.sequenceValue},
      ${input.consumerCode},
      ${input.idempotencyKeyHash},
      ${input.requestFingerprintHash},
      ${input.issuedAt}
    )
    ON CONFLICT ("rule_id", "generated_number") DO NOTHING
    RETURNING "id"
  `)

  if (rows.length > 1) {
    return persistenceInvariant('Numbering issuance insert invariant violated')
  }
  const row = rows[0]
  if (row !== undefined && typeof row.id !== 'string') {
    return persistenceInvariant('Numbering issuance insert invariant violated')
  }
  return row?.id ?? null
}

/**
 * 调用方只能在 issuance 已成功占位后调用；拆成独立原语让碰撞、重放或异常路径
 * 无法在 insert helper 内提前推进容量。
 */
export async function advancePeriodState(
  transaction: Prisma.TransactionClient,
  input: AdvancePeriodStateInput,
): Promise<void> {
  await transaction.numberingPeriodState.update({
    where: { id: input.periodStateId },
    data: {
      usedCount: { increment: 1n },
      nextSequenceValue: input.nextSequenceValue,
    },
    select: { id: true },
  })
}
