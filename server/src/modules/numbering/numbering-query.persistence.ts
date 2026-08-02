import { Prisma } from '../../generated/prisma/client'
import type {
  NumberingGeneratedNumberMatch,
  NumberingRuleSortOrder,
  NumberingRuleStatus,
} from './dto/numbering-management.dto'
import {
  toDecimalString,
  toNullableDecimalString,
} from './numbering-decimal'

const NUMBERING_SEGMENT_READ_SELECT = {
  id: true,
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
} as const satisfies Prisma.NumberingRuleSegmentSelect

export const NUMBERING_VERSION_READ_SELECT = {
  id: true,
  revision: true,
  status: true,
  resetPolicy: true,
  timezone: true,
  createdAt: true,
  publishedAt: true,
  segments: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: NUMBERING_SEGMENT_READ_SELECT,
  },
} as const satisfies Prisma.NumberingRuleVersionSelect

export const NUMBERING_RULE_READ_SELECT = {
  id: true,
  ruleCode: true,
  name: true,
  description: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    where: {
      status: { in: ['ACTIVE', 'DRAFT'] },
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: NUMBERING_VERSION_READ_SELECT,
  },
} as const satisfies Prisma.NumberingRuleSelect

export type NumberingVersionReadRow = Prisma.NumberingRuleVersionGetPayload<{
  select: typeof NUMBERING_VERSION_READ_SELECT
}>

export type NumberingRuleReadRow = Prisma.NumberingRuleGetPayload<{
  select: typeof NUMBERING_RULE_READ_SELECT
}>

export interface NumberingRuleListPersistenceQuery {
  readonly keyword?: string
  readonly status?: NumberingRuleStatus
  readonly page: number
  readonly pageSize: number
  readonly skip: number
  readonly sortOrder: NumberingRuleSortOrder
}

export interface NumberingPagePersistenceQuery {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
}

export interface NumberingIssuancePersistenceQuery
  extends NumberingPagePersistenceQuery {
  readonly periodKey?: string
  readonly consumerCode?: string
  readonly generatedNumber?: string
  readonly generatedNumberMatch?: NumberingGeneratedNumberMatch
}

export interface NumberingPeriodUsageRequest {
  readonly ruleId: string
  /** draft-only 规则传 null，只统计 lifetime，不读取或创建理论周期状态。 */
  readonly periodKey: string | null
}

export interface NumberingPeriodUsage {
  readonly usedCount: string
  readonly lifetimeUsedCount: string
}

export interface NumberingIssuanceReadRow {
  readonly id: string
  readonly ruleRevision: number
  readonly periodKey: string
  readonly generatedNumber: string
  readonly sequenceValue: string | null
  readonly consumerCode: string
  readonly issuedAt: Date
}

interface DatabaseAsOfRow {
  readonly asOf: Date
}

interface NumberingPeriodUsageRawRow {
  readonly ruleId: string
  readonly periodKey: string | null
  readonly usedCount: unknown
  readonly lifetimeUsedCount: unknown
}

interface NumberingIssuanceRawRow {
  readonly id: string
  readonly ruleRevision: number
  readonly periodKey: string
  readonly generatedNumber: string
  readonly sequenceValue: unknown
  readonly consumerCode: string
  readonly issuedAt: Date
}

interface CountRow {
  readonly total: number
}

export async function readDatabaseAsOfInTransaction(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<DatabaseAsOfRow[]>(Prisma.sql`
    SELECT transaction_timestamp() AS "asOf"
  `)
  const asOf = rows[0]?.asOf

  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new TypeError('数据库事务时间无效')
  }

  return asOf
}

function buildRuleWhere(
  query: NumberingRuleListPersistenceQuery,
): Prisma.NumberingRuleWhereInput {
  const where: Prisma.NumberingRuleWhereInput = {}

  if (query.status !== undefined) {
    where.status = query.status
  }

  if (query.keyword !== undefined) {
    const contains = {
      contains: query.keyword,
      mode: 'insensitive' as const,
    }
    where.OR = [
      { ruleCode: contains },
      { name: contains },
      { description: contains },
    ]
  }

  return where
}

/**
 * 列表的 rule/version/segment 读取始终是一次 page query；统计再由一个批量聚合
 * 查询完成，绝不按 rule 循环访问 period state。
 */
export async function readNumberingRuleListPageInTransaction(
  transaction: Prisma.TransactionClient,
  query: NumberingRuleListPersistenceQuery,
): Promise<{ readonly total: number; readonly rows: NumberingRuleReadRow[] }> {
  const where = buildRuleWhere(query)
  const total = await transaction.numberingRule.count({ where })
  const rows = await transaction.numberingRule.findMany({
    where,
    orderBy: [
      { updatedAt: query.sortOrder },
      { id: query.sortOrder },
    ],
    skip: query.skip,
    take: query.pageSize,
    select: NUMBERING_RULE_READ_SELECT,
  })

  return { total, rows }
}

/**
 * 后续 command 在自己的写事务内可直接复用该 helper；它不打开嵌套事务、
 * 不设置 timeout，也不读取进程时钟。
 */
export async function readNumberingRuleDetailInTransaction(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<NumberingRuleReadRow | null> {
  return transaction.numberingRule.findUnique({
    where: { id: ruleId },
    select: NUMBERING_RULE_READ_SELECT,
  })
}

export async function readNumberingRuleVersionsPageInTransaction(
  transaction: Prisma.TransactionClient,
  ruleId: string,
  query: NumberingPagePersistenceQuery,
): Promise<{
  readonly ruleExists: boolean
  readonly total: number
  readonly rows: NumberingVersionReadRow[]
}> {
  const rule = await transaction.numberingRule.findUnique({
    where: { id: ruleId },
    select: { id: true },
  })

  if (rule === null) {
    return { ruleExists: false, total: 0, rows: [] }
  }

  const where: Prisma.NumberingRuleVersionWhereInput = { ruleId }
  const total = await transaction.numberingRuleVersion.count({ where })
  const rows = await transaction.numberingRuleVersion.findMany({
    where,
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    skip: query.skip,
    take: query.pageSize,
    select: NUMBERING_VERSION_READ_SELECT,
  })

  return { ruleExists: true, total, rows }
}

/** PostgreSQL LIKE 的三个元字符都转义，避免未来放宽编号字母表时查询语义漂移。 */
export function escapeNumberingLikeLiteral(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

function buildIssuanceWhereSql(
  ruleId: string,
  query: NumberingIssuancePersistenceQuery,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`i."rule_id" = ${ruleId}::uuid`]

  if (query.periodKey !== undefined) {
    conditions.push(Prisma.sql`i."period_key" = ${query.periodKey}`)
  }

  if (query.consumerCode !== undefined) {
    conditions.push(Prisma.sql`i."consumer_code" = ${query.consumerCode}`)
  }

  if (query.generatedNumber !== undefined) {
    const literal = escapeNumberingLikeLiteral(query.generatedNumber)
    const pattern = query.generatedNumberMatch === 'PREFIX'
      ? `${literal}%`
      : literal
    // ESCAPE 也使用参数，查询中没有任何用户输入进入 Prisma.raw/字符串拼接。
    conditions.push(Prisma.sql`
      i."generated_number" LIKE ${pattern} ESCAPE ${'\\'}
    `)
  }

  return Prisma.join(conditions, ' AND ')
}

/**
 * issuance 使用显式列清单；两个 Hash 从未进入 SELECT，后续 mapper 即使误改也
 * 无法把幂等凭证带出数据库边界。
 */
export async function readNumberingIssuancesPageInTransaction(
  transaction: Prisma.TransactionClient,
  ruleId: string,
  query: NumberingIssuancePersistenceQuery,
): Promise<{
  readonly ruleExists: boolean
  readonly total: number
  readonly rows: NumberingIssuanceReadRow[]
}> {
  const rule = await transaction.numberingRule.findUnique({
    where: { id: ruleId },
    select: { id: true },
  })

  if (rule === null) {
    return { ruleExists: false, total: 0, rows: [] }
  }

  const where = buildIssuanceWhereSql(ruleId, query)
  const countRows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM "numbering_issuances" i
    WHERE ${where}
  `)
  const rawRows = await transaction.$queryRaw<NumberingIssuanceRawRow[]>(
    Prisma.sql`
      SELECT
        i.id,
        v.revision AS "ruleRevision",
        i."period_key" AS "periodKey",
        i."generated_number" AS "generatedNumber",
        i."sequence_value" AS "sequenceValue",
        i."consumer_code" AS "consumerCode",
        i."issued_at" AS "issuedAt"
      FROM "numbering_issuances" i
      INNER JOIN "numbering_rule_versions" v
        ON v.id = i."rule_version_id"
       AND v."rule_id" = i."rule_id"
      WHERE ${where}
      ORDER BY i."issued_at" DESC, i.id DESC
      LIMIT ${query.pageSize}
      OFFSET ${query.skip}
    `,
  )

  const total = countRows[0]?.total
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new TypeError('发号记录总数无效')
  }

  return {
    ruleExists: true,
    total,
    rows: rawRows.map((row) => ({
      id: row.id,
      ruleRevision: row.ruleRevision,
      periodKey: row.periodKey,
      generatedNumber: row.generatedNumber,
      sequenceValue: toNullableDecimalString(row.sequenceValue),
      consumerCode: row.consumerCode,
      issuedAt: row.issuedAt,
    })),
  }
}

export async function readNumberingRuleHasIssuancesInTransaction(
  transaction: Prisma.TransactionClient,
  ruleId: string,
): Promise<boolean> {
  const issuance = await transaction.numberingIssuance.findFirst({
    where: { ruleId },
    select: { id: true },
  })
  return issuance !== null
}

/**
 * `SUM(bigint)` 在 PostgreSQL 中提升为 numeric，再直接 `::text` 返回；应用层
 * 从不经过 JS number。requested CTE 同时带入当前 period，单次 SQL 覆盖整个页。
 */
export async function readNumberingPeriodUsageInTransaction(
  transaction: Prisma.TransactionClient,
  requests: readonly NumberingPeriodUsageRequest[],
): Promise<ReadonlyMap<string, NumberingPeriodUsage>> {
  if (requests.length === 0) {
    return new Map()
  }

  const values = requests.map((request) => Prisma.sql`
    (${request.ruleId}::uuid, ${request.periodKey}::text)
  `)
  const rows = await transaction.$queryRaw<NumberingPeriodUsageRawRow[]>(
    Prisma.sql`
      WITH requested("ruleId", "periodKey") AS (
        VALUES ${Prisma.join(values)}
      )
      SELECT
        requested."ruleId"::text AS "ruleId",
        requested."periodKey" AS "periodKey",
        COALESCE(
          MAX(state."used_count") FILTER (
            WHERE requested."periodKey" IS NOT NULL
              AND state."period_key" = requested."periodKey"
          ),
          0
        )::text AS "usedCount",
        COALESCE(SUM(state."used_count"), 0)::text AS "lifetimeUsedCount"
      FROM requested
      LEFT JOIN "numbering_period_states" state
        ON state."rule_id" = requested."ruleId"
      GROUP BY requested."ruleId", requested."periodKey"
    `,
  )

  return new Map(rows.map((row) => [
    row.ruleId,
    {
      usedCount: toDecimalString(row.usedCount),
      lifetimeUsedCount: toDecimalString(row.lifetimeUsedCount),
    },
  ]))
}
