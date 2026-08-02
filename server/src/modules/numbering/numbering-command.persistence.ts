import { Prisma } from '../../generated/prisma/client'
import {
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
  type NumberingRuleStatus as NumberingRuleStatusValue,
  type NumberingRuleVersionStatus as NumberingRuleVersionStatusValue,
} from '../../generated/prisma/enums'
import { NUMBERING_CONFIG_TIMEZONE } from './numbering-config-fingerprint'
import {
  type NumberingRuleConfig,
  NumberingRuleConfigError,
  type NumberingRuleSegment,
  validateNumberingRuleConfig,
} from './rule-engine'

export interface NumberingRuleMutationRecord {
  readonly id: string
  readonly ruleCode: string
  readonly name: string
  readonly description: string | null
  readonly status: NumberingRuleStatusValue
  readonly version: number
}

export interface NumberingRuleVersionSnapshot {
  readonly id: string
  readonly revision: number
  readonly status: NumberingRuleVersionStatusValue
  readonly configFingerprint: string
  readonly config: NumberingRuleConfig
}

export interface CreateNumberingRuleRecordInput {
  readonly ruleCode: string
  readonly name: string
  readonly description: string | null
}

export interface SaveNumberingDraftVersionInput {
  readonly ruleId: string
  readonly revision: number
  readonly config: NumberingRuleConfig
  readonly configFingerprint: string
}

export interface ReplaceNumberingDraftVersionInput {
  readonly versionId: string
  readonly config: NumberingRuleConfig
  readonly configFingerprint: string
}

export interface UpdateNumberingRuleRecordInput {
  name?: string
  description?: string | null
  status?: NumberingRuleStatusValue
}

export type NumberingRuleVersionStatusTransitionInput =
  | {
      readonly versionId: string
      readonly fromStatus: typeof NumberingRuleVersionStatus.ACTIVE
      readonly toStatus: typeof NumberingRuleVersionStatus.RETIRED
    }
  | {
      readonly versionId: string
      readonly fromStatus: typeof NumberingRuleVersionStatus.DRAFT
      readonly toStatus: typeof NumberingRuleVersionStatus.ACTIVE
      readonly publishedAt: Date
    }

interface TransactionTimestampRow {
  readonly asOf: Date
}

interface LifetimeUsedCountRow {
  readonly lifetimeUsedCount: string
}

const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)$/u

interface StoredSegmentRow {
  readonly position: number
  readonly type: NumberingRuleSegment['type']
  readonly fixedValue: string | null
  readonly dateFormat: Extract<NumberingRuleSegment, { type: 'DATE' }>['format'] | null
  readonly separatorValue: Extract<NumberingRuleSegment, { type: 'SEPARATOR' }>['value'] | null
  readonly sequenceWidth: number | null
  readonly sequenceStartValue: bigint | null
  readonly sequenceStep: bigint | null
  readonly randomLetterLength: number | null
  readonly randomDigitLength: number | null
  readonly randomMode: Extract<NumberingRuleSegment, { type: 'RANDOM' }>['mode'] | null
}

interface StoredVersionRow {
  readonly id: string
  readonly revision: number
  readonly status: NumberingRuleVersionStatusValue
  readonly resetPolicy: NumberingRuleConfig['resetPolicy']
  readonly timezone: string
  readonly configFingerprint: string
  readonly segments: readonly StoredSegmentRow[]
}

function invalidStoredConfig(path: string): never {
  throw new NumberingRuleConfigError([
    { path, message: '持久化配置结构不合法' },
  ])
}

function mapStoredSegment(row: StoredSegmentRow): NumberingRuleSegment {
  switch (row.type) {
    case 'FIXED':
      return row.fixedValue === null
        ? invalidStoredConfig(`segments[${row.position}].value`)
        : { type: 'FIXED', value: row.fixedValue }
    case 'DATE':
      return row.dateFormat === null
        ? invalidStoredConfig(`segments[${row.position}].format`)
        : { type: 'DATE', format: row.dateFormat }
    case 'SEPARATOR':
      return row.separatorValue === null
        ? invalidStoredConfig(`segments[${row.position}].value`)
        : { type: 'SEPARATOR', value: row.separatorValue }
    case 'SEQUENCE':
      return row.sequenceWidth === null
        || row.sequenceStartValue === null
        || row.sequenceStep === null
        ? invalidStoredConfig(`segments[${row.position}]`)
        : {
            type: 'SEQUENCE',
            width: row.sequenceWidth,
            startValue: row.sequenceStartValue.toString(),
            step: row.sequenceStep.toString(),
          }
    case 'RANDOM':
      return row.randomLetterLength === null
        || row.randomDigitLength === null
        || row.randomMode === null
        ? invalidStoredConfig(`segments[${row.position}]`)
        : {
            type: 'RANDOM',
            letterLength: row.randomLetterLength,
            digitLength: row.randomDigitLength,
            mode: row.randomMode,
          }
  }
}

function mapSegmentCreateRows(
  versionId: string,
  config: NumberingRuleConfig,
) {
  return config.segments.map((segment, position) => ({
    versionId,
    position,
    type: segment.type,
    fixedValue: segment.type === 'FIXED' ? segment.value : null,
    dateFormat: segment.type === 'DATE' ? segment.format : null,
    separatorValue: segment.type === 'SEPARATOR' ? segment.value : null,
    sequenceWidth: segment.type === 'SEQUENCE' ? segment.width : null,
    sequenceStartValue: segment.type === 'SEQUENCE'
      ? BigInt(segment.startValue)
      : null,
    sequenceStep: segment.type === 'SEQUENCE' ? BigInt(segment.step) : null,
    randomLetterLength: segment.type === 'RANDOM'
      ? segment.letterLength
      : null,
    randomDigitLength: segment.type === 'RANDOM'
      ? segment.digitLength
      : null,
    randomMode: segment.type === 'RANDOM' ? segment.mode : null,
  }))
}

async function createSegments(
  transaction: Prisma.TransactionClient,
  versionId: string,
  config: NumberingRuleConfig,
): Promise<void> {
  await transaction.numberingRuleSegment.createMany({
    data: mapSegmentCreateRows(versionId, config),
  })
}

export async function readNumberingTransactionTimestamp(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<TransactionTimestampRow[]>(
    Prisma.sql`SELECT transaction_timestamp() AS "asOf"`,
  )
  const asOf = rows[0]?.asOf
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new Error('Numbering transaction timestamp invariant violated')
  }
  return asOf
}

export async function readNumberingRuleForUpdate(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<NumberingRuleMutationRecord | null> {
  const rows = await transaction.$queryRaw<NumberingRuleMutationRecord[]>(
    Prisma.sql`
      SELECT "id", "rule_code" AS "ruleCode", "name", "description",
        "status"::text AS "status", "version"
      FROM "numbering_rules"
      WHERE "id" = CAST(${ruleId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] ?? null
}

export async function readNumberingRuleForClone(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<NumberingRuleMutationRecord | null> {
  const rows = await transaction.$queryRaw<NumberingRuleMutationRecord[]>(
    Prisma.sql`
      SELECT "id", "rule_code" AS "ruleCode", "name", "description",
        "status"::text AS "status", "version"
      FROM "numbering_rules"
      WHERE "id" = CAST(${ruleId} AS uuid)
      FOR SHARE
    `,
  )
  return rows[0] ?? null
}

/**
 * 调用方必须先持有 rule 的排他锁，使 period state 的 SUM 与随后的版本切换处于
 * 同一稳定生命周期快照。数据库直接返回 decimal text，禁止经过 JS number。
 */
export async function readNumberingLifetimeUsedCount(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<string> {
  const rows = await transaction.$queryRaw<LifetimeUsedCountRow[]>(Prisma.sql`
    SELECT COALESCE(SUM("used_count"), 0)::text AS "lifetimeUsedCount"
    FROM "numbering_period_states"
    WHERE "rule_id" = CAST(${ruleId} AS uuid)
  `)
  const lifetimeUsedCount = rows[0]?.lifetimeUsedCount
  if (
    typeof lifetimeUsedCount !== 'string'
    || !NON_NEGATIVE_DECIMAL_PATTERN.test(lifetimeUsedCount)
  ) {
    throw new Error('Numbering lifetime usage invariant violated')
  }
  return lifetimeUsedCount
}

export async function createNumberingRuleRecord(
  transaction: Prisma.TransactionClient,
  input: CreateNumberingRuleRecordInput,
): Promise<{ id: string }> {
  return transaction.numberingRule.create({
    data: {
      ...input,
      status: NumberingRuleStatus.DRAFT,
      version: 1,
    },
    select: { id: true },
  })
}

export async function createNumberingDraftVersion(
  transaction: Prisma.TransactionClient,
  input: SaveNumberingDraftVersionInput,
): Promise<{ id: string }> {
  const version = await transaction.numberingRuleVersion.create({
    data: {
      ruleId: input.ruleId,
      revision: input.revision,
      status: NumberingRuleVersionStatus.DRAFT,
      resetPolicy: input.config.resetPolicy,
      timezone: NUMBERING_CONFIG_TIMEZONE,
      configFingerprint: input.configFingerprint,
    },
    select: { id: true },
  })
  await createSegments(transaction, version.id, input.config)
  return version
}

export async function replaceNumberingDraftVersion(
  transaction: Prisma.TransactionClient,
  input: ReplaceNumberingDraftVersionInput,
): Promise<void> {
  await transaction.numberingRuleVersion.update({
    where: { id: input.versionId },
    data: {
      resetPolicy: input.config.resetPolicy,
      timezone: NUMBERING_CONFIG_TIMEZONE,
      configFingerprint: input.configFingerprint,
    },
    select: { id: true },
  })
  await transaction.numberingRuleSegment.deleteMany({
    where: { versionId: input.versionId },
  })
  await createSegments(transaction, input.versionId, input.config)
}

export async function readNumberingRuleVersionSnapshots(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<NumberingRuleVersionSnapshot[]> {
  const rows = await transaction.numberingRuleVersion.findMany({
    where: {
      ruleId,
      status: {
        in: [
          NumberingRuleVersionStatus.ACTIVE,
          NumberingRuleVersionStatus.DRAFT,
        ],
      },
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      revision: true,
      status: true,
      resetPolicy: true,
      timezone: true,
      configFingerprint: true,
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
    },
  }) as StoredVersionRow[]

  return rows.map((row) => {
    if (row.timezone !== NUMBERING_CONFIG_TIMEZONE) {
      return invalidStoredConfig('timezone')
    }
    return {
      id: row.id,
      revision: row.revision,
      status: row.status,
      configFingerprint: row.configFingerprint,
      config: validateNumberingRuleConfig({
        resetPolicy: row.resetPolicy,
        segments: row.segments.map(mapStoredSegment),
      }),
    }
  })
}

/**
 * 生命周期状态变更以来源状态作为条件，避免把陈旧快照静默覆盖。返回 false
 * 表示锁内不变量已经变化，由 command 映射为稳定的 state-changed 冲突。
 */
export async function transitionNumberingRuleVersionStatus(
  transaction: Prisma.TransactionClient,
  input: NumberingRuleVersionStatusTransitionInput,
): Promise<boolean> {
  const result = await transaction.numberingRuleVersion.updateMany({
    where: {
      id: input.versionId,
      status: input.fromStatus,
    },
    data: input.toStatus === NumberingRuleVersionStatus.ACTIVE
      ? {
          status: input.toStatus,
          publishedAt: input.publishedAt,
        }
      : { status: input.toStatus },
  })
  return result.count === 1
}

export async function updateNumberingRuleRecord(
  transaction: Prisma.TransactionClient,
  ruleId: string,
  input: UpdateNumberingRuleRecordInput,
): Promise<void> {
  await transaction.numberingRule.update({
    where: { id: ruleId },
    data: {
      ...input,
      version: { increment: 1 },
    },
    select: { id: true },
  })
}

export async function hasNumberingIssuance(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<boolean> {
  return await transaction.numberingIssuance.findFirst({
    where: { ruleId },
    select: { id: true },
  }) !== null
}
