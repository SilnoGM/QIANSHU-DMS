import { Prisma } from '../../generated/prisma/client'
import type {
  DictionaryTone as DictionaryToneValue,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import type {
  DictionaryItemDto,
  DictionaryTypeDto,
} from './dto/dictionary-response.dto'
import {
  type DictionaryPersistenceErrorContext,
  mapDictionaryPersistenceError,
} from './dictionary.persistence-error.mapper'

export interface DictionaryTypeMutationRecord {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly enabled: boolean
  readonly sortOrder: number
  readonly version: number
}

export interface DictionaryItemMutationRecord {
  readonly id: string
  readonly dictionaryTypeId: string
  readonly value: string
  readonly label: string
  readonly description: string | null
  readonly tone: DictionaryToneValue
  readonly enabled: boolean
  readonly sortOrder: number
  readonly version: number
}

export interface CreateDictionaryTypeRecordInput {
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly sortOrder: number
}

export interface UpdateDictionaryTypeRecordInput {
  name?: string
  description?: string | null
  enabled?: boolean
  sortOrder?: number
}

export interface CreateDictionaryItemRecordInput {
  readonly value: string
  readonly label: string
  readonly description: string | null
  readonly tone: DictionaryToneValue
  readonly sortOrder: number
}

export interface UpdateDictionaryItemRecordInput {
  label?: string
  description?: string | null
  tone?: DictionaryToneValue
  enabled?: boolean
  sortOrder?: number
}

export interface CreatedDictionaryItemRecord {
  readonly dictionaryType: DictionaryTypeMutationRecord
  readonly itemId: string
}

export interface DictionaryItemMutationContext {
  readonly dictionaryType: DictionaryTypeMutationRecord | null
  readonly dictionaryItem: DictionaryItemMutationRecord | null
}

interface DictionaryTypeDtoRow extends DictionaryTypeMutationRecord {
  readonly itemCount: number
  readonly enabledItemCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

interface DictionaryItemDtoRow extends DictionaryItemMutationRecord {
  readonly dictionaryTypeEnabled: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * 所有字典写入口必须复用本 runner。timeout 是交互式事务中的第一条 SQL，
 * context 则让底层并发冲突稳定映射到 Type 或 Item，且不会公开数据库详情。
 */
export async function runDictionaryCommandTransaction<T>(
  prisma: PrismaService,
  context: DictionaryPersistenceErrorContext,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  transactionConflictContext: DictionaryPersistenceErrorContext = context,
): Promise<T> {
  try {
    return await prisma.$transaction(async (transaction) => {
      // 此调用必须先于 operation；operation 内可能立即执行锁或写 SQL。
      await applyTransactionTimeouts(transaction)
      return operation(transaction)
    })
  } catch (error) {
    /*
     * Create Item 的唯一键属于 Item，但它首先等待父 Type 行锁。仅允许该入口
     * 覆盖事务冲突的资源归属；唯一键与 CHECK 映射仍严格使用原始 context。
     */
    throw mapDictionaryPersistenceError(
      error,
      context,
      transactionConflictContext,
    )
  }
}

export async function createDictionaryTypeRecord(
  transaction: Prisma.TransactionClient,
  input: CreateDictionaryTypeRecordInput,
): Promise<{ id: string }> {
  return transaction.dictionaryType.create({
    // Persistence 再做一次逐字段复制，不能依赖 TypeScript 结构类型剥离运行时额外字段。
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
    },
    select: { id: true },
  })
}

/** Type 的所有更新都先读取并锁行，后续版本和领域判断只能基于这份记录。 */
export async function readDictionaryTypeForMutation(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
): Promise<DictionaryTypeMutationRecord | null> {
  const rows = await transaction.$queryRaw<DictionaryTypeMutationRecord[]>(
    Prisma.sql`
      SELECT
        "id",
        "code",
        "name",
        "description",
        "enabled",
        "sort_order" AS "sortOrder",
        "version"
      FROM "dictionary_types"
      WHERE "id" = CAST(${dictionaryTypeId} AS uuid)
      FOR UPDATE
    `,
  )

  return rows[0] ?? null
}

export async function updateDictionaryTypeRecord(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
  input: UpdateDictionaryTypeRecordInput,
): Promise<void> {
  await transaction.dictionaryType.update({
    where: { id: dictionaryTypeId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      version: { increment: 1 },
    },
    select: { id: true },
  })
}

/**
 * Create Item 在应用层先锁父 Type，再执行 INSERT。若父记录不存在则不尝试写入，
 * 由上层按 endpoint 语义选择稳定 not-found 错误；这里不作任何状态业务判断。
 */
export async function createDictionaryItemRecord(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
  input: CreateDictionaryItemRecordInput,
): Promise<CreatedDictionaryItemRecord | null> {
  const dictionaryType = await readDictionaryTypeForMutation(
    transaction,
    dictionaryTypeId,
  )
  if (dictionaryType === null) {
    return null
  }

  const item = await transaction.dictionaryItem.create({
    data: {
      dictionaryTypeId,
      value: input.value,
      label: input.label,
      description: input.description,
      tone: input.tone,
      sortOrder: input.sortOrder,
    },
    select: { id: true },
  })

  return {
    dictionaryType,
    itemId: item.id,
  }
}

/**
 * 该函数不导出，避免调用方绕过父锁直接锁 Item。Item update/status 只能通过
 * readDictionaryItemMutationContext 固定执行 Type -> Item 的全局锁序。
 */
async function readDictionaryItemForMutation(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
  dictionaryItemId: string,
): Promise<DictionaryItemMutationRecord | null> {
  const rows = await transaction.$queryRaw<DictionaryItemMutationRecord[]>(
    Prisma.sql`
      SELECT
        "id",
        "dictionary_type_id" AS "dictionaryTypeId",
        "value",
        "label",
        "description",
        "tone"::text AS "tone",
        "enabled",
        "sort_order" AS "sortOrder",
        "version"
      FROM "dictionary_items"
      WHERE "dictionary_type_id" = CAST(${dictionaryTypeId} AS uuid)
        AND "id" = CAST(${dictionaryItemId} AS uuid)
      FOR UPDATE
    `,
  )

  return rows[0] ?? null
}

/**
 * Item 的编辑与启停共享这一组合读取。Item SQL 同时限定 typeId + itemId，
 * 因此跨 Type 路径只能得到 null，既维持锁序也不会泄露其他 Type 的资源。
 */
export async function readDictionaryItemMutationContext(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
  dictionaryItemId: string,
): Promise<DictionaryItemMutationContext> {
  const dictionaryType = await readDictionaryTypeForMutation(
    transaction,
    dictionaryTypeId,
  )
  if (dictionaryType === null) {
    return {
      dictionaryType: null,
      dictionaryItem: null,
    }
  }

  const dictionaryItem = await readDictionaryItemForMutation(
    transaction,
    dictionaryTypeId,
    dictionaryItemId,
  )

  return {
    dictionaryType,
    dictionaryItem,
  }
}

export async function updateDictionaryItemRecord(
  transaction: Prisma.TransactionClient,
  dictionaryItemId: string,
  input: UpdateDictionaryItemRecordInput,
): Promise<void> {
  await transaction.dictionaryItem.update({
    where: { id: dictionaryItemId },
    data: {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.tone === undefined ? {} : { tone: input.tone }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      version: { increment: 1 },
    },
    select: { id: true },
  })
}

function mapDictionaryTypeDto(row: DictionaryTypeDtoRow): DictionaryTypeDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    itemCount: row.itemCount,
    enabledItemCount: row.enabledItemCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 最终 Type 响应与业务写、后续 Audit 共用同一事务视图。 */
export async function readDictionaryTypeCommandDto(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
): Promise<DictionaryTypeDto | null> {
  const rows = await transaction.$queryRaw<DictionaryTypeDtoRow[]>(
    Prisma.sql`
      SELECT
        target."id",
        target."code",
        target."name",
        target."description",
        target."enabled",
        target."sort_order" AS "sortOrder",
        COUNT(item."id")::integer AS "itemCount",
        (
          COUNT(item."id") FILTER (WHERE item."enabled")
        )::integer AS "enabledItemCount",
        target."version",
        target."created_at" AS "createdAt",
        target."updated_at" AS "updatedAt"
      FROM "dictionary_types" AS target
      LEFT JOIN "dictionary_items" AS item
        ON item."dictionary_type_id" = target."id"
      WHERE target."id" = CAST(${dictionaryTypeId} AS uuid)
      GROUP BY target."id"
      LIMIT 1
    `,
  )

  return rows[0] === undefined ? null : mapDictionaryTypeDto(rows[0])
}

function mapDictionaryItemDto(row: DictionaryItemDtoRow): DictionaryItemDto {
  return {
    id: row.id,
    dictionaryTypeId: row.dictionaryTypeId,
    value: row.value,
    label: row.label,
    description: row.description,
    tone: row.tone,
    enabled: row.enabled,
    effectiveEnabled: row.enabled && row.dictionaryTypeEnabled,
    sortOrder: row.sortOrder,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 最终 Item 响应仍以 typeId + itemId 定位，并在事务内派生 effectiveEnabled。 */
export async function readDictionaryItemCommandDto(
  transaction: Prisma.TransactionClient,
  dictionaryTypeId: string,
  dictionaryItemId: string,
): Promise<DictionaryItemDto | null> {
  const rows = await transaction.$queryRaw<DictionaryItemDtoRow[]>(
    Prisma.sql`
      SELECT
        item."id",
        item."dictionary_type_id" AS "dictionaryTypeId",
        item."value",
        item."label",
        item."description",
        item."tone"::text AS "tone",
        item."enabled",
        parent."enabled" AS "dictionaryTypeEnabled",
        item."sort_order" AS "sortOrder",
        item."version",
        item."created_at" AS "createdAt",
        item."updated_at" AS "updatedAt"
      FROM "dictionary_items" AS item
      INNER JOIN "dictionary_types" AS parent
        ON parent."id" = item."dictionary_type_id"
      WHERE item."dictionary_type_id" = CAST(${dictionaryTypeId} AS uuid)
        AND item."id" = CAST(${dictionaryItemId} AS uuid)
      LIMIT 1
    `,
  )

  return rows[0] === undefined ? null : mapDictionaryItemDto(rows[0])
}
