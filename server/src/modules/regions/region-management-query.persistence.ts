import { HttpStatus } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  RegionAvailability,
  type RegionListQueryDto,
  type RegionNavigationNodeDto,
  RegionOwnStatus,
  RegionSortBy,
  RegionSortOrder,
} from './dto/region-management.dto'
import type { RegionDto, RegionPageDto } from './dto/region.dto'
import {
  normalizeRegionCode,
  normalizeRegionSearchText,
} from './region.normalizer'

interface RegionNavigationRow {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  level: RegionLevelValue
  enabled: boolean
  effectiveEnabled: boolean
}

interface ManagementRegionRow extends RegionNavigationRow {
  sourceName: string | null
  sourceCode: string | null
  administrativeType: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

interface RegionCountRow {
  count: number
}

interface ManagementListScope {
  parentId?: string
  level: RegionLevelValue
}

interface NormalizedManagementListQuery {
  parentId?: string
  query?: string
  queryCode?: string
  code?: string
  ownStatus?: RegionOwnStatus
  availability?: RegionAvailability
  page: number
  pageSize: number
  skip: number
  sortBy?: RegionSortBy
  sortOrder?: RegionSortOrder
}

const MANAGEMENT_PARENT_SELECT = {
  id: true,
  parentId: true,
  level: true,
  enabled: true,
  parent: {
    select: {
      id: true,
      parentId: true,
      level: true,
      enabled: true,
    },
  },
} as const

const MANAGEMENT_REGION_FROM = Prisma.sql`
  FROM "regions" AS target
  LEFT JOIN "regions" AS parent
    ON parent."id" = target."parent_id"
  LEFT JOIN "regions" AS grandparent
    ON grandparent."id" = parent."parent_id"
`

const MANAGEMENT_EFFECTIVE_EXPRESSION = Prisma.sql`
  (
    target."enabled"
    AND COALESCE(parent."enabled", true)
    AND COALESCE(grandparent."enabled", true)
  )
`

function managementException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function rethrowManagementQueryError(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }

  // Prisma/驱动异常可能携带 SQL、连接信息和参数；管理读取只暴露固定公共错误。
  throw managementException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function normalizeManagementListQuery(
  query: Readonly<Partial<RegionListQueryDto>>,
): NormalizedManagementListQuery {
  if (!query || typeof query !== 'object') {
    throw managementException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
    )
  }

  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 20
  const skip = (page - 1) * pageSize
  const ownStatuses = new Set(Object.values(RegionOwnStatus))
  const availabilities = new Set(Object.values(RegionAvailability))
  const sortFields = new Set(Object.values(RegionSortBy))
  const sortOrders = new Set(Object.values(RegionSortOrder))

  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 100
    || !Number.isSafeInteger(skip)
    || (
      query.ownStatus !== undefined
      && !ownStatuses.has(query.ownStatus)
    )
    || (
      query.availability !== undefined
      && !availabilities.has(query.availability)
    )
    || (
      query.sortBy !== undefined
      && !sortFields.has(query.sortBy)
    )
    || (
      query.sortOrder !== undefined
      && !sortOrders.has(query.sortOrder)
    )
    || (
      query.ownStatus === RegionOwnStatus.DISABLED
      && query.availability !== undefined
    )
  ) {
    throw managementException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      '请求参数校验失败',
    )
  }

  const normalizedQuery = query.query === undefined
    ? undefined
    : normalizeRegionSearchText(query.query)

  return {
    parentId: query.parentId,
    query: normalizedQuery,
    queryCode: normalizedQuery?.toLocaleUpperCase('en-US'),
    code: query.code === undefined
      ? undefined
      : normalizeRegionCode(query.code),
    ownStatus: query.ownStatus,
    availability: query.availability,
    page,
    pageSize,
    skip,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }
}

async function resolveManagementListScope(
  transaction: Prisma.TransactionClient,
  parentId: string | undefined,
): Promise<ManagementListScope> {
  if (parentId === undefined) {
    return { level: RegionLevel.COUNTRY_REGION }
  }

  const parent = await transaction.region.findUnique({
    where: { id: parentId },
    select: MANAGEMENT_PARENT_SELECT,
  })

  if (!parent) {
    throw managementException(
      HttpStatus.NOT_FOUND,
      'REGION_PARENT_NOT_FOUND',
      '上级地区不存在',
    )
  }

  if (parent.level === RegionLevel.CITY) {
    throw managementException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'REGION_HIERARCHY_INVALID',
      '地区层级关系不合法',
    )
  }

  return {
    parentId,
    level: parent.level === RegionLevel.COUNTRY_REGION
      ? RegionLevel.PROVINCE_STATE
      : RegionLevel.CITY,
  }
}

function buildManagementWhere(
  scope: ManagementListScope,
  query: NormalizedManagementListQuery,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`target."level" = CAST(${scope.level} AS "region_level")`,
    scope.parentId === undefined
      ? Prisma.sql`target."parent_id" IS NULL`
      : Prisma.sql`target."parent_id" = CAST(${scope.parentId} AS uuid)`,
  ]

  if (query.query !== undefined && query.queryCode !== undefined) {
    conditions.push(Prisma.sql`
      (
        strpos(target."normalized_name", ${query.query}) > 0
        OR strpos(
          lower(COALESCE(target."english_name", '')),
          ${query.query}
        ) > 0
        OR strpos(target."code", ${query.queryCode}) > 0
      )
    `)
  }

  if (query.code !== undefined) {
    conditions.push(Prisma.sql`target."code" = ${query.code}`)
  }

  if (query.ownStatus === RegionOwnStatus.ENABLED) {
    conditions.push(Prisma.sql`target."enabled" = true`)
  }
  else if (query.ownStatus === RegionOwnStatus.DISABLED) {
    conditions.push(Prisma.sql`target."enabled" = false`)
  }

  if (query.availability === RegionAvailability.EFFECTIVE) {
    conditions.push(Prisma.sql`${MANAGEMENT_EFFECTIVE_EXPRESSION} = true`)
  }
  else if (
    query.availability === RegionAvailability.ANCESTOR_DISABLED
  ) {
    conditions.push(Prisma.sql`
      target."enabled" = true
      AND (
        (parent."id" IS NOT NULL AND NOT parent."enabled")
        OR (
          grandparent."id" IS NOT NULL
          AND NOT grandparent."enabled"
        )
      )
    `)
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

function buildManagementOrderBy(
  query: NormalizedManagementListQuery,
): Prisma.Sql {
  if (query.sortBy === undefined && query.sortOrder === undefined) {
    return Prisma.sql`
      target."sort_order" ASC,
      target."normalized_name" ASC,
      target."id" ASC
    `
  }

  const sortBy = query.sortBy ?? RegionSortBy.SORT_ORDER
  const descending = query.sortOrder === RegionSortOrder.DESC

  switch (sortBy) {
    case RegionSortBy.CODE:
      return descending
        ? Prisma.sql`target."code" DESC, target."id" DESC`
        : Prisma.sql`target."code" ASC, target."id" ASC`
    case RegionSortBy.NAME:
      return descending
        ? Prisma.sql`target."normalized_name" DESC, target."id" DESC`
        : Prisma.sql`target."normalized_name" ASC, target."id" ASC`
    case RegionSortBy.UPDATED_AT:
      return descending
        ? Prisma.sql`target."updated_at" DESC, target."id" DESC`
        : Prisma.sql`target."updated_at" ASC, target."id" ASC`
    case RegionSortBy.SORT_ORDER:
      return descending
        ? Prisma.sql`target."sort_order" DESC, target."id" DESC`
        : Prisma.sql`target."sort_order" ASC, target."id" ASC`
  }
}

function mapManagementRegion(row: ManagementRegionRow): RegionDto {
  return {
    id: row.id,
    parentId: row.parentId,
    code: row.code,
    name: row.name,
    englishName: row.englishName,
    sourceName: row.sourceName,
    sourceCode: row.sourceCode,
    administrativeType: row.administrativeType,
    level: row.level,
    enabled: row.enabled,
    effectiveEnabled: row.effectiveEnabled,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function readRegionNavigation(
  prisma: PrismaService,
): Promise<RegionNavigationNodeDto[]> {
  try {
    const rows = await prisma.$queryRaw<RegionNavigationRow[]>(
      Prisma.sql`
        SELECT
          target."id",
          target."parent_id" AS "parentId",
          target."code",
          target."name",
          target."english_name" AS "englishName",
          target."level"::text AS "level",
          target."enabled",
          (
            target."enabled"
            AND COALESCE(parent."enabled", true)
          ) AS "effectiveEnabled"
        FROM "regions" AS target
        LEFT JOIN "regions" AS parent
          ON parent."id" = target."parent_id"
        WHERE target."level" IN (
          'COUNTRY_REGION'::"region_level",
          'PROVINCE_STATE'::"region_level"
        )
        ORDER BY
          target."sort_order" ASC,
          target."normalized_name" ASC,
          target."id" ASC
      `,
    )

    const roots: RegionNavigationNodeDto[] = []
    const rootsById = new Map<string, RegionNavigationNodeDto>()
    for (const row of rows) {
      if (row.level !== RegionLevel.COUNTRY_REGION) {
        continue
      }

      const root: RegionNavigationNodeDto = {
        ...row,
        children: [],
      }
      roots.push(root)
      rootsById.set(root.id, root)
    }

    for (const row of rows) {
      if (row.level !== RegionLevel.PROVINCE_STATE) {
        continue
      }

      const parent = row.parentId === null
        ? undefined
        : rootsById.get(row.parentId)
      if (!parent) {
        // 数据库层级约束应保证不可达；统一进入安全 500 边界。
        throw new Error('Region navigation hierarchy invariant violated')
      }

      parent.children.push({
        ...row,
        children: [],
      })
    }

    return roots
  }
  catch (error) {
    rethrowManagementQueryError(error)
  }
}

export async function readRegionPage(
  prisma: PrismaService,
  query: Readonly<Partial<RegionListQueryDto>>,
): Promise<RegionPageDto> {
  try {
    const normalized = normalizeManagementListQuery(query)
    const result = await prisma.$transaction(async (transaction) => {
      // 超时必须早于 parent、count 和 rows 的任一业务查询。
      await applyTransactionTimeouts(transaction)
      const scope = await resolveManagementListScope(
        transaction,
        normalized.parentId,
      )
      const where = buildManagementWhere(scope, normalized)
      const orderBy = buildManagementOrderBy(normalized)

      // 同一事务内串行 count 与 rows，避免连接并发调度及查询口径漂移。
      const countRows = await transaction.$queryRaw<RegionCountRow[]>(
        Prisma.sql`
          SELECT count(*)::integer AS "count"
          ${MANAGEMENT_REGION_FROM}
          ${where}
        `,
      )
      const rows = await transaction.$queryRaw<ManagementRegionRow[]>(
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
            ${MANAGEMENT_EFFECTIVE_EXPRESSION}
              AS "effectiveEnabled",
            target."sort_order" AS "sortOrder",
            target."created_at" AS "createdAt",
            target."updated_at" AS "updatedAt"
          ${MANAGEMENT_REGION_FROM}
          ${where}
          ORDER BY ${orderBy}
          LIMIT ${normalized.pageSize}
          OFFSET ${normalized.skip}
        `,
      )

      return {
        rows,
        total: countRows[0]?.count ?? 0,
      }
    })

    return {
      items: result.rows.map(mapManagementRegion),
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: result.total,
    }
  }
  catch (error) {
    rethrowManagementQueryError(error)
  }
}

export async function readRegionById(
  prisma: PrismaService,
  regionId: string,
): Promise<RegionDto> {
  try {
    const rows = await prisma.$queryRaw<ManagementRegionRow[]>(
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
          ${MANAGEMENT_EFFECTIVE_EXPRESSION}
            AS "effectiveEnabled",
          target."sort_order" AS "sortOrder",
          target."created_at" AS "createdAt",
          target."updated_at" AS "updatedAt"
        ${MANAGEMENT_REGION_FROM}
        WHERE target."id" = CAST(${regionId} AS uuid)
        LIMIT 1
      `,
    )
    const region = rows[0]

    if (!region) {
      throw managementException(
        HttpStatus.NOT_FOUND,
        'REGION_NOT_FOUND',
        '地区不存在',
      )
    }

    return mapManagementRegion(region)
  }
  catch (error) {
    rethrowManagementQueryError(error)
  }
}
