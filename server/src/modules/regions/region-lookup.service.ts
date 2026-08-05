import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'

interface LockedRegionRow {
  readonly id: string
  readonly parentId: string | null
  readonly level: RegionLevelValue
  readonly enabled: boolean
}

export interface LockedRegionReference extends LockedRegionRow {
  readonly effectiveEnabled: boolean
}

const REGION_LEVELS = new Set<RegionLevelValue>([
  RegionLevel.COUNTRY_REGION,
  RegionLevel.PROVINCE_STATE,
  RegionLevel.CITY,
])

function regionLookupInvariant(): never {
  throw new Error('Region lookup invariant violated')
}

function isLockedRegionRow(value: unknown): value is LockedRegionRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const row = value as Partial<LockedRegionRow>
  return typeof row.id === 'string'
    && (row.parentId === null || typeof row.parentId === 'string')
    && typeof row.level === 'string'
    && REGION_LEVELS.has(row.level)
    && typeof row.enabled === 'boolean'
}

/**
 * 为 Server 业务模块提供事务内 Region 引用快照。
 *
 * 调用方负责事务、timeout 和领域错误映射；本服务不创建嵌套事务，也不调用
 * Region HTTP API。递归 CTE 先收集请求节点及其祖先，再通过同一 SQL 按 UUID
 * 升序取得 `FOR KEY SHARE`，从而让多个业务模块共享稳定锁序。
 */
@Injectable()
export class RegionLookupService {
  async lockReferences(
    transaction: Prisma.TransactionClient,
    regionIds: readonly string[],
  ): Promise<ReadonlyMap<string, LockedRegionReference>> {
    const requestedIds = [...new Set(regionIds)].sort()
    if (requestedIds.length === 0) {
      return new Map()
    }

    const requestedValues = Prisma.join(
      requestedIds.map(regionId => Prisma.sql`(CAST(${regionId} AS uuid))`),
    )
    const rows = await transaction.$queryRaw<LockedRegionRow[]>(Prisma.sql`
      WITH RECURSIVE "requested"("id") AS (
        VALUES ${requestedValues}
      ),
      "ancestry"("id") AS (
        SELECT requested."id"
        FROM "requested" AS requested
        UNION
        SELECT region."parent_id"
        FROM "regions" AS region
        INNER JOIN "ancestry" AS child
          ON child."id" = region."id"
        WHERE region."parent_id" IS NOT NULL
      )
      SELECT
        region."id",
        region."parent_id" AS "parentId",
        region."level"::text AS "level",
        region."enabled"
      FROM "regions" AS region
      INNER JOIN "ancestry" AS ancestry
        ON ancestry."id" = region."id"
      ORDER BY region."id"
      FOR KEY SHARE OF region
    `)

    const graph = new Map<string, LockedRegionRow>()
    for (const row of rows) {
      if (!isLockedRegionRow(row) || graph.has(row.id)) {
        regionLookupInvariant()
      }
      graph.set(row.id, row)
    }

    const effectiveCache = new Map<string, boolean>()
    const readEffective = (regionId: string, visiting: Set<string>): boolean => {
      const cached = effectiveCache.get(regionId)
      if (cached !== undefined) {
        return cached
      }
      const row = graph.get(regionId)
      if (row === undefined || visiting.has(regionId)) {
        return false
      }
      visiting.add(regionId)
      const effective = row.enabled && (
        row.parentId === null
        || readEffective(row.parentId, visiting)
      )
      visiting.delete(regionId)
      effectiveCache.set(regionId, effective)
      return effective
    }

    const result = new Map<string, LockedRegionReference>()
    for (const regionId of requestedIds) {
      const row = graph.get(regionId)
      if (row === undefined) {
        continue
      }
      result.set(regionId, Object.freeze({
        id: row.id,
        parentId: row.parentId,
        level: row.level,
        enabled: row.enabled,
        effectiveEnabled: readEffective(regionId, new Set()),
      }))
    }
    return result
  }
}
