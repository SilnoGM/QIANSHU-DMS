import { Prisma } from '../../generated/prisma/client'
import type { CurrencyDto } from './dto/currency.dto'

export interface CurrencyMutationRecord {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly englishName: string | null
  readonly symbol: string | null
  readonly minorUnit: number
  readonly enabled: boolean
  readonly sortOrder: number
  readonly version: number
}

export interface CreateCurrencyRecordInput {
  readonly code: string
  readonly name: string
  readonly englishName: string | null
  readonly symbol: string | null
  readonly minorUnit: number
  readonly enabled: false
  readonly sortOrder: number
}

export interface UpdateCurrencyRecordInput {
  name?: string
  englishName?: string | null
  symbol?: string | null
  enabled?: boolean
  sortOrder?: number
}

interface CurrencyDtoRecord extends CurrencyMutationRecord {
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly exchangeRate: { readonly id: string } | null
}

interface IdRecord {
  readonly id: string
}

function mapCurrencyDto(record: CurrencyDtoRecord): CurrencyDto {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    englishName: record.englishName,
    symbol: record.symbol,
    minorUnit: record.minorUnit,
    enabled: record.enabled,
    isBase: record.code === 'CNY',
    sortOrder: record.sortOrder,
    exchangeRateConfigured: record.exchangeRate !== null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createCurrencyRecord(
  transaction: Prisma.TransactionClient,
  input: CreateCurrencyRecordInput,
): Promise<{ id: string }> {
  return transaction.currency.create({
    data: input,
    select: { id: true },
  })
}

/**
 * 所有 Currency 更新先锁目标行。ExchangeRate 若参与后续启用校验，只能在该
 * Currency 锁之后读取并加锁，从而维持全系统唯一的锁顺序。
 */
export async function readCurrencyForMutation(
  transaction: Prisma.TransactionClient,
  currencyId: string,
): Promise<CurrencyMutationRecord | null> {
  const rows = await transaction.$queryRaw<CurrencyMutationRecord[]>(
    Prisma.sql`
      SELECT
        "id",
        "code",
        "name",
        "english_name" AS "englishName",
        "symbol",
        "minor_unit" AS "minorUnit",
        "enabled",
        "sort_order" AS "sortOrder",
        "version"
      FROM "currencies"
      WHERE "id" = CAST(${currencyId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] ?? null
}

/** 该读取只能在 Currency 已加锁后调用，避免与汇率写事务形成反向锁序。 */
export async function readExchangeRateForCurrency(
  transaction: Prisma.TransactionClient,
  currencyId: string,
): Promise<{ id: string } | null> {
  const rows = await transaction.$queryRaw<IdRecord[]>(
    Prisma.sql`
      SELECT "id"
      FROM "exchange_rates"
      WHERE "currency_id" = CAST(${currencyId} AS uuid)
      FOR SHARE
    `,
  )
  return rows[0] ?? null
}

export async function updateCurrencyRecord(
  transaction: Prisma.TransactionClient,
  currencyId: string,
  input: UpdateCurrencyRecordInput,
): Promise<void> {
  await transaction.currency.update({
    where: { id: currencyId },
    data: {
      ...input,
      version: { increment: 1 },
    },
    select: { id: true },
  })
}

/** mutation 最终响应与 Audit 从同一事务快照读取，避免提交后再读产生漂移。 */
export async function readCurrencyCommandDto(
  transaction: Prisma.TransactionClient,
  currencyId: string,
): Promise<CurrencyDto | null> {
  const record = await transaction.currency.findUnique({
    where: { id: currencyId },
    select: {
      id: true,
      code: true,
      name: true,
      englishName: true,
      symbol: true,
      minorUnit: true,
      enabled: true,
      sortOrder: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      exchangeRate: {
        select: { id: true },
      },
    },
  })

  return record === null
    ? null
    : mapCurrencyDto(record)
}
