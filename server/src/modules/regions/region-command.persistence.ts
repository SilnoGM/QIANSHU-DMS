import { HttpStatus } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { RegionDto } from './dto/region.dto'

export interface RegionCreateParentRecord {
  readonly id: string
  readonly parentId: string | null
  readonly level: RegionLevelValue
  readonly enabled: boolean
}

export interface RegionUpdateLockRecord {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly normalizedName: string
  readonly englishName: string | null
  readonly level: RegionLevelValue
  readonly enabled: boolean
  readonly sortOrder: number
}

export interface RegionStatusGraphRecord {
  readonly id: string
  readonly parentId: string | null
  readonly level: RegionLevelValue
  readonly enabled: boolean
}

export interface CreateRegionRecordInput {
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly normalizedName: string
  readonly englishName: string | null
  readonly sourceName: null
  readonly sourceCode: null
  readonly administrativeType: string
  readonly level: RegionLevelValue
  readonly enabled: boolean
  readonly sortOrder: number
}

export interface UpdateRegionRecordInput {
  name?: string
  normalizedName?: string
  englishName?: string | null
  enabled?: boolean
  sortOrder?: number
}

interface RegionIdentityAvailabilityRow {
  readonly codeExists: boolean
  readonly nameExists: boolean
}

interface RegionDtoRow {
  readonly id: string
  readonly parentId: string | null
  readonly code: string
  readonly name: string
  readonly englishName: string | null
  readonly sourceName: string | null
  readonly sourceCode: string | null
  readonly administrativeType: string
  readonly level: RegionLevelValue
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
  readonly sortOrder: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface RegionIdRow {
  readonly id: string
}

function regionException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function mapRegionDto(row: RegionDtoRow): RegionDto {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 创建时锁住 parent，阻止并发启停在层级推导后、写入前改变其状态或可见关系。
 * 根节点创建没有 parent，因此不会执行这条查询。
 */
export async function readRegionForCreate(
  transaction: Prisma.TransactionClient,
  parentId: string,
): Promise<RegionCreateParentRecord | null> {
  const rows = await transaction.$queryRaw<RegionCreateParentRecord[]>(
    Prisma.sql`
      SELECT
        "id",
        "parent_id" AS "parentId",
        "level"::text AS "level",
        "enabled"
      FROM "regions"
      WHERE "id" = CAST(${parentId} AS uuid)
      FOR SHARE
    `,
  )
  return rows[0] ?? null
}

/**
 * 友好的预冲突检查不能替代数据库唯一约束；它只让非并发冲突稳定返回业务错误，
 * 并发竞态仍由 unique constraint 和统一 persistence mapper 收口。
 */
export async function assertRegionIdentityAvailable(
  transaction: Prisma.TransactionClient,
  input: {
    readonly code: string
    readonly normalizedName: string
    readonly parentId: string | null
    readonly excludeId?: string
  },
): Promise<void> {
  const exclude = input.excludeId === undefined
    ? Prisma.empty
    : Prisma.sql`AND "id" <> CAST(${input.excludeId} AS uuid)`
  const parentPredicate = input.parentId === null
    ? Prisma.sql`"parent_id" IS NULL`
    : Prisma.sql`"parent_id" = CAST(${input.parentId} AS uuid)`
  const rows = await transaction.$queryRaw<RegionIdentityAvailabilityRow[]>(
    Prisma.sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM "regions"
          WHERE "code" = ${input.code}
          ${exclude}
        ) AS "codeExists",
        EXISTS (
          SELECT 1
          FROM "regions"
          WHERE ${parentPredicate}
            AND "normalized_name" = ${input.normalizedName}
            ${exclude}
        ) AS "nameExists"
    `,
  )
  const result = rows[0]

  if (result?.codeExists) {
    throw regionException(
      HttpStatus.CONFLICT,
      'REGION_CODE_ALREADY_EXISTS',
      '地区编码已存在',
    )
  }
  if (result?.nameExists) {
    throw regionException(
      HttpStatus.CONFLICT,
      'REGION_NAME_ALREADY_EXISTS',
      '同一上级下地区名称已存在',
    )
  }
}

export async function createRegionRecord(
  transaction: Prisma.TransactionClient,
  input: CreateRegionRecordInput,
): Promise<{ id: string }> {
  return transaction.region.create({
    data: input,
    select: { id: true },
  })
}

/** 编辑先锁目标行；身份字段不会通过此方法暴露给 update data。 */
export async function readRegionForUpdate(
  transaction: Prisma.TransactionClient,
  regionId: string,
): Promise<RegionUpdateLockRecord | null> {
  const rows = await transaction.$queryRaw<RegionUpdateLockRecord[]>(
    Prisma.sql`
      SELECT
        "id",
        "parent_id" AS "parentId",
        "code",
        "name",
        "normalized_name" AS "normalizedName",
        "english_name" AS "englishName",
        "level"::text AS "level",
        "enabled",
        "sort_order" AS "sortOrder"
      FROM "regions"
      WHERE "id" = CAST(${regionId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] ?? null
}

export async function updateRegionRecord(
  transaction: Prisma.TransactionClient,
  regionId: string,
  input: UpdateRegionRecordInput,
): Promise<void> {
  await transaction.region.update({
    where: { id: regionId },
    data: input,
    select: { id: true },
  })
}

/**
 * 状态变更的第一次读取刻画“祖先链 ∪ subtree”。锁后会再次执行同一读取并比较
 * ID 集合，避免在快照和加锁之间新增后代时遗漏 effective 状态变化。
 */
export async function readRegionStatusGraph(
  transaction: Prisma.TransactionClient,
  regionId: string,
): Promise<RegionStatusGraphRecord[]> {
  return transaction.$queryRaw<RegionStatusGraphRecord[]>(
    Prisma.sql`
      WITH RECURSIVE
      "ancestry" AS (
        SELECT
          "id",
          "parent_id" AS "parentId",
          "level",
          "enabled"
        FROM "regions"
        WHERE "id" = CAST(${regionId} AS uuid)

        UNION ALL

        SELECT
          parent."id",
          parent."parent_id" AS "parentId",
          parent."level",
          parent."enabled"
        FROM "regions" AS parent
        INNER JOIN "ancestry" AS child
          ON parent."id" = child."parentId"
      ),
      "subtree" AS (
        SELECT
          "id",
          "parent_id" AS "parentId",
          "level",
          "enabled"
        FROM "regions"
        WHERE "id" = CAST(${regionId} AS uuid)

        UNION ALL

        SELECT
          child."id",
          child."parent_id" AS "parentId",
          child."level",
          child."enabled"
        FROM "regions" AS child
        INNER JOIN "subtree" AS parent
          ON child."parent_id" = parent."id"
      )
      SELECT
        graph."id",
        graph."parentId",
        graph."level"::text AS "level",
        graph."enabled"
      FROM (
        SELECT * FROM "ancestry"
        UNION
        SELECT * FROM "subtree"
      ) AS graph
      ORDER BY graph."id" ASC
    `,
  )
}

/**
 * PostgreSQL 的行锁获取顺序必须由 SQL ORDER BY 固定，不能只依赖 JavaScript
 * 参数顺序。锁结果也要完整匹配，缺行统一视为并发状态漂移。
 */
export async function lockRegionIdsInStableOrder(
  transaction: Prisma.TransactionClient,
  regionIds: readonly string[],
): Promise<void> {
  const stableIds = [...new Set(regionIds.map(id => id.toLowerCase()))].sort()
  if (stableIds.length === 0) {
    return
  }

  const rows = await transaction.$queryRaw<RegionIdRow[]>(
    Prisma.sql`
      SELECT "id"
      FROM "regions"
      WHERE "id" IN (
        ${Prisma.join(
          stableIds.map(id => Prisma.sql`CAST(${id} AS uuid)`),
        )}
      )
      ORDER BY "id" ASC
      FOR UPDATE
    `,
  )
  const lockedIds = rows.map(row => row.id.toLowerCase())
  if (
    lockedIds.length !== stableIds.length
    || lockedIds.some((id, index) => id !== stableIds[index])
  ) {
    throw regionException(
      HttpStatus.CONFLICT,
      'REGION_STATE_CHANGED',
      '地区状态已变化，请刷新后重试',
    )
  }
}

/** 在 mutation 事务内读取最终响应，保证 Region、Audit 与响应来自同一提交视图。 */
export async function readRegionCommandDto(
  transaction: Prisma.TransactionClient,
  regionId: string,
): Promise<RegionDto | null> {
  const rows = await transaction.$queryRaw<RegionDtoRow[]>(
    Prisma.sql`
      SELECT
        target."id",
        target."parent_id" AS "parentId",
        target."code",
        target."name",
        target."english_name" AS "englishName",
        target."source_name" AS "sourceName",
        target."source_code" AS "sourceCode",
        target."administrative_type" AS "administrativeType",
        target."level"::text AS "level",
        target."enabled",
        (
          target."enabled"
          AND COALESCE(parent."enabled", true)
          AND COALESCE(grandparent."enabled", true)
        ) AS "effectiveEnabled",
        target."sort_order" AS "sortOrder",
        target."created_at" AS "createdAt",
        target."updated_at" AS "updatedAt"
      FROM "regions" AS target
      LEFT JOIN "regions" AS parent
        ON parent."id" = target."parent_id"
      LEFT JOIN "regions" AS grandparent
        ON grandparent."id" = parent."parent_id"
      WHERE target."id" = CAST(${regionId} AS uuid)
      LIMIT 1
    `,
  )
  return rows[0] ? mapRegionDto(rows[0]) : null
}
