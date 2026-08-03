import { Injectable } from '@nestjs/common'
import { isUUID } from 'class-validator'

import { Prisma } from '../../generated/prisma/client'
import type { DictionaryTone } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  createDictionaryApiException,
  DICTIONARY_ERROR_CODES,
} from './dictionary.errors'
import { normalizeDictionaryQuery } from './dictionary.normalizer'
import { mapDictionaryPersistenceError } from './dictionary.persistence-error.mapper'
import {
  DictionaryItemSortBy,
  type DictionaryItemListQueryDto,
  type DictionaryItemSortBy as DictionaryItemSortByValue,
  DictionarySortOrder,
  type DictionarySortOrder as DictionarySortOrderValue,
  DictionaryStatusFilter,
  type DictionaryStatusFilter as DictionaryStatusFilterValue,
  type DictionaryTypeListQueryDto,
  DictionaryTypeSortBy,
  type DictionaryTypeSortBy as DictionaryTypeSortByValue,
} from './dto/dictionary-management.dto'
import type {
  DictionaryItemDto,
  DictionaryItemPageDto,
  DictionaryTypeDto,
  DictionaryTypePageDto,
} from './dto/dictionary-response.dto'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAXIMUM_PAGE_SIZE = 100

const DICTIONARY_TYPE_PUBLIC_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  enabled: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DictionaryTypeSelect

const DICTIONARY_ITEM_DETAIL_SELECT = {
  id: true,
  dictionaryTypeId: true,
  value: true,
  label: true,
  description: true,
  tone: true,
  enabled: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  dictionaryType: {
    select: { enabled: true },
  },
} satisfies Prisma.DictionaryItemSelect

type DictionaryTypeRow = Prisma.DictionaryTypeGetPayload<{
  select: typeof DICTIONARY_TYPE_PUBLIC_SELECT
}>

type DictionaryItemDetailRow = Prisma.DictionaryItemGetPayload<{
  select: typeof DICTIONARY_ITEM_DETAIL_SELECT
}>

interface DictionaryItemRow {
  readonly id: string
  readonly dictionaryTypeId: string
  readonly value: string
  readonly label: string
  readonly description: string | null
  readonly tone: DictionaryTone
  readonly enabled: boolean
  readonly sortOrder: number
  readonly version: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface CountRow {
  readonly count: number
}

interface DictionaryTypeStatsRow {
  readonly dictionaryTypeId: string
  readonly itemCount: number
  readonly enabledItemCount: number
}

interface NormalizedPagination {
  readonly query?: string
  readonly status?: DictionaryStatusFilterValue
  readonly page: number
  readonly pageSize: number
  readonly skip: number
}

interface NormalizedTypeListQuery extends NormalizedPagination {
  readonly sortBy: DictionaryTypeSortByValue
  readonly sortOrder: DictionarySortOrderValue
}

interface NormalizedItemListQuery extends NormalizedPagination {
  readonly sortBy: DictionaryItemSortByValue
  readonly sortOrder: DictionarySortOrderValue
}

/**
 * 管理端字典读取边界。每次公开读取都建立自己的 RepeatableRead snapshot；timeout
 * 必须是事务中的第一条 SQL，避免分页总数、行和统计来自不同数据库时点。
 */
@Injectable()
export class DictionaryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listTypes(
    input: Readonly<Partial<DictionaryTypeListQueryDto>>,
  ): Promise<DictionaryTypePageDto> {
    try {
      const query = normalizeTypeListQuery(input)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        const where = buildTypeWhere(query)
        const countRows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT count(*)::integer AS "count"
          FROM "dictionary_types" AS target
          ${where}
        `)
        const rows = await transaction.$queryRaw<DictionaryTypeRow[]>(Prisma.sql`
          SELECT
            target."id" AS "id",
            target."code" AS "code",
            target."name" AS "name",
            target."description" AS "description",
            target."enabled" AS "enabled",
            target."sort_order" AS "sortOrder",
            target."version" AS "version",
            target."created_at" AS "createdAt",
            target."updated_at" AS "updatedAt"
          FROM "dictionary_types" AS target
          ${where}
          ORDER BY ${buildTypeOrderBy(query)}
          LIMIT ${query.pageSize}
          OFFSET ${query.skip}
        `)
        const stats = rows.length === 0
          ? []
          : await readTypeStats(transaction, rows.map(row => row.id))
        const statsByTypeId = new Map(
          stats.map(row => [row.dictionaryTypeId, row] as const),
        )

        return {
          items: rows.map(row => mapDictionaryType(
            row,
            statsByTypeId.get(row.id),
          )),
          page: query.page,
          pageSize: query.pageSize,
          total: readCount(countRows),
        }
      })
    } catch (error) {
      throw mapDictionaryPersistenceError(error, 'TYPE')
    }
  }

  async getTypeById(typeId: string): Promise<DictionaryTypeDto> {
    try {
      assertUuid(typeId)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        const row = await transaction.dictionaryType.findUnique({
          where: { id: typeId },
          select: DICTIONARY_TYPE_PUBLIC_SELECT,
        })
        if (row === null) {
          throw createDictionaryApiException(
            DICTIONARY_ERROR_CODES.TYPE_NOT_FOUND,
          )
        }

        const stats = await readTypeStats(transaction, [typeId])
        return mapDictionaryType(row, stats[0])
      })
    } catch (error) {
      throw mapDictionaryPersistenceError(error, 'TYPE')
    }
  }

  async listItems(
    typeId: string,
    input: Readonly<Partial<DictionaryItemListQueryDto>>,
  ): Promise<DictionaryItemPageDto> {
    try {
      assertUuid(typeId)
      const query = normalizeItemListQuery(input)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        const dictionaryType = await transaction.dictionaryType.findUnique({
          where: { id: typeId },
          select: { id: true, enabled: true },
        })
        if (dictionaryType === null) {
          throw createDictionaryApiException(
            DICTIONARY_ERROR_CODES.TYPE_NOT_FOUND,
          )
        }

        const where = buildItemWhere(typeId, query)
        const countRows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT count(*)::integer AS "count"
          FROM "dictionary_items" AS target
          ${where}
        `)
        const rows = await transaction.$queryRaw<DictionaryItemRow[]>(Prisma.sql`
          SELECT
            target."id" AS "id",
            target."dictionary_type_id" AS "dictionaryTypeId",
            target."value" AS "value",
            target."label" AS "label",
            target."description" AS "description",
            target."tone" AS "tone",
            target."enabled" AS "enabled",
            target."sort_order" AS "sortOrder",
            target."version" AS "version",
            target."created_at" AS "createdAt",
            target."updated_at" AS "updatedAt"
          FROM "dictionary_items" AS target
          ${where}
          ORDER BY ${buildItemOrderBy(query)}
          LIMIT ${query.pageSize}
          OFFSET ${query.skip}
        `)

        return {
          items: rows.map(row => mapDictionaryItem(
            row,
            dictionaryType.enabled,
          )),
          page: query.page,
          pageSize: query.pageSize,
          total: readCount(countRows),
        }
      })
    } catch (error) {
      throw mapDictionaryPersistenceError(error, 'ITEM')
    }
  }

  async getItemById(
    typeId: string,
    itemId: string,
  ): Promise<DictionaryItemDto> {
    try {
      assertUuid(typeId)
      assertUuid(itemId)

      return await this.inRepeatableReadSnapshot(async (transaction) => {
        // 必须把两个 path ID 放入同一 where；禁止先按 itemId 查询后泄露其真实父级。
        const row = await transaction.dictionaryItem.findFirst({
          where: { id: itemId, dictionaryTypeId: typeId },
          select: DICTIONARY_ITEM_DETAIL_SELECT,
        })
        if (row === null) {
          throw createDictionaryApiException(
            DICTIONARY_ERROR_CODES.ITEM_NOT_FOUND,
          )
        }

        return mapDictionaryItem(row, row.dictionaryType.enabled)
      })
    } catch (error) {
      throw mapDictionaryPersistenceError(error, 'ITEM')
    }
  }

  private async inRepeatableReadSnapshot<T>(
    reader: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      return reader(transaction)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  }
}

function normalizeTypeListQuery(
  input: Readonly<Partial<DictionaryTypeListQueryDto>>,
): NormalizedTypeListQuery {
  const pagination = normalizePagination(input)
  const sortBy = input.sortBy ?? DictionaryTypeSortBy.SORT_ORDER
  const sortOrder = input.sortOrder ?? DictionarySortOrder.ASC
  if (
    !Object.values(DictionaryTypeSortBy).includes(sortBy)
    || !Object.values(DictionarySortOrder).includes(sortOrder)
  ) {
    return validationFailure()
  }

  return { ...pagination, sortBy, sortOrder }
}

function normalizeItemListQuery(
  input: Readonly<Partial<DictionaryItemListQueryDto>>,
): NormalizedItemListQuery {
  const pagination = normalizePagination(input)
  const sortBy = input.sortBy ?? DictionaryItemSortBy.SORT_ORDER
  const sortOrder = input.sortOrder ?? DictionarySortOrder.ASC
  if (
    !Object.values(DictionaryItemSortBy).includes(sortBy)
    || !Object.values(DictionarySortOrder).includes(sortOrder)
  ) {
    return validationFailure()
  }

  return { ...pagination, sortBy, sortOrder }
}

function normalizePagination(
  input: Readonly<Partial<DictionaryTypeListQueryDto>>
    | Readonly<Partial<DictionaryItemListQueryDto>>,
): NormalizedPagination {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailure()
  }

  const page = input.page ?? DEFAULT_PAGE
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
  const status = input.status
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > MAXIMUM_PAGE_SIZE
    || (
      status !== undefined
      && !Object.values(DictionaryStatusFilter).includes(status)
    )
  ) {
    return validationFailure()
  }

  const skip = (page - 1) * pageSize
  if (!Number.isSafeInteger(skip)) {
    return validationFailure()
  }

  return {
    query: normalizeDictionaryQuery(input.query),
    status,
    page,
    pageSize,
    skip,
  }
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isUUID(value)) {
    validationFailure()
  }
}

function validationFailure(): never {
  throw createDictionaryApiException(
    DICTIONARY_ERROR_CODES.VALIDATION_FAILED,
  )
}

function buildTypeWhere(query: NormalizedTypeListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = []
  if (query.query !== undefined) {
    conditions.push(Prisma.sql`(
      strpos(lower(target."code"), lower(${query.query})) > 0
      OR strpos(lower(target."name"), lower(${query.query})) > 0
      OR strpos(
        lower(coalesce(target."description", '')),
        lower(${query.query})
      ) > 0
    )`)
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`
      target."enabled" = ${query.status === DictionaryStatusFilter.ENABLED}
    `)
  }

  return buildWhereClause(conditions)
}

function buildItemWhere(
  typeId: string,
  query: NormalizedItemListQuery,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`target."dictionary_type_id" = CAST(${typeId} AS uuid)`,
  ]
  if (query.query !== undefined) {
    conditions.push(Prisma.sql`(
      strpos(lower(target."value"), lower(${query.query})) > 0
      OR strpos(lower(target."label"), lower(${query.query})) > 0
      OR strpos(
        lower(coalesce(target."description", '')),
        lower(${query.query})
      ) > 0
    )`)
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`
      target."enabled" = ${query.status === DictionaryStatusFilter.ENABLED}
    `)
  }

  return buildWhereClause(conditions)
}

function buildWhereClause(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  return conditions.length === 0
    ? Prisma.sql``
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

function buildTypeOrderBy(query: NormalizedTypeListQuery): Prisma.Sql {
  const direction = query.sortOrder === DictionarySortOrder.DESC
    ? Prisma.raw('DESC')
    : Prisma.raw('ASC')

  switch (query.sortBy) {
    case DictionaryTypeSortBy.CODE:
      return Prisma.sql`target."code" ${direction}, target."id" ASC`
    case DictionaryTypeSortBy.NAME:
      return Prisma.sql`
        target."name" ${direction}, target."code" ASC, target."id" ASC
      `
    case DictionaryTypeSortBy.UPDATED_AT:
      return Prisma.sql`
        target."updated_at" ${direction}, target."code" ASC, target."id" ASC
      `
    case DictionaryTypeSortBy.SORT_ORDER:
      return Prisma.sql`
        target."sort_order" ${direction}, target."code" ASC, target."id" ASC
      `
  }
}

function buildItemOrderBy(query: NormalizedItemListQuery): Prisma.Sql {
  const direction = query.sortOrder === DictionarySortOrder.DESC
    ? Prisma.raw('DESC')
    : Prisma.raw('ASC')

  switch (query.sortBy) {
    case DictionaryItemSortBy.VALUE:
      return Prisma.sql`target."value" ${direction}, target."id" ASC`
    case DictionaryItemSortBy.LABEL:
      return Prisma.sql`
        target."label" ${direction}, target."value" ASC, target."id" ASC
      `
    case DictionaryItemSortBy.UPDATED_AT:
      return Prisma.sql`
        target."updated_at" ${direction}, target."value" ASC, target."id" ASC
      `
    case DictionaryItemSortBy.SORT_ORDER:
      return Prisma.sql`
        target."sort_order" ${direction}, target."value" ASC, target."id" ASC
      `
  }
}

async function readTypeStats(
  transaction: Prisma.TransactionClient,
  typeIds: readonly string[],
): Promise<DictionaryTypeStatsRow[]> {
  const typedTypeIds = typeIds.map(typeId =>
    Prisma.sql`CAST(${typeId} AS uuid)`,
  )

  return transaction.$queryRaw<DictionaryTypeStatsRow[]>(Prisma.sql`
    SELECT
      item."dictionary_type_id" AS "dictionaryTypeId",
      count(*)::integer AS "itemCount",
      count(*) FILTER (WHERE item."enabled")::integer AS "enabledItemCount"
    FROM "dictionary_items" AS item
    WHERE item."dictionary_type_id" IN (${Prisma.join(typedTypeIds)})
    GROUP BY item."dictionary_type_id"
  `)
}

function readCount(rows: readonly CountRow[]): number {
  return rows[0]?.count ?? 0
}

function mapDictionaryType(
  row: DictionaryTypeRow,
  stats?: DictionaryTypeStatsRow,
): DictionaryTypeDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    itemCount: stats?.itemCount ?? 0,
    enabledItemCount: stats?.enabledItemCount ?? 0,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function mapDictionaryItem(
  row: DictionaryItemRow | DictionaryItemDetailRow,
  typeEnabled: boolean,
): DictionaryItemDto {
  return {
    id: row.id,
    dictionaryTypeId: row.dictionaryTypeId,
    value: row.value,
    label: row.label,
    description: row.description,
    tone: row.tone,
    enabled: row.enabled,
    effectiveEnabled: typeEnabled && row.enabled,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
