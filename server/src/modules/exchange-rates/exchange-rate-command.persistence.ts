import { Prisma } from '../../generated/prisma/client'
import type { ExchangeRateDto } from './dto/exchange-rate.dto'
import { normalizeForeignUnitsPerCny } from './exchange-rate.normalizer'

export interface CurrencyExchangeRateLockRecord {
  readonly id: string
  readonly code: string
}

export interface ExchangeRateIdentityRecord {
  readonly id: string
  readonly currencyId: string
}

export interface ExchangeRateMutationRecord
  extends ExchangeRateIdentityRecord {
  readonly foreignUnitsPerCny: string
  readonly version: number
}

interface RawExchangeRateMutationRecord
  extends ExchangeRateIdentityRecord {
  readonly foreignUnitsPerCny: unknown
  readonly version: number
}

interface ExchangeRateDtoRecord extends RawExchangeRateMutationRecord {
  readonly createdAt: Date
  readonly updatedAt: Date
}

function decimalString(value: unknown): string {
  if (
    typeof value !== 'string'
    && (
      typeof value !== 'object'
      || value === null
      || !('toString' in value)
      || typeof value.toString !== 'function'
    )
  ) {
    throw new Error('ExchangeRate decimal invariant violated')
  }

  const text = typeof value === 'string'
    ? value
    : (value as { toString: () => string }).toString()
  return normalizeForeignUnitsPerCny(text)
}

function mapMutationRecord(
  record: RawExchangeRateMutationRecord,
): ExchangeRateMutationRecord {
  return {
    ...record,
    foreignUnitsPerCny: decimalString(record.foreignUnitsPerCny),
  }
}

function mapExchangeRateDto(
  record: ExchangeRateDtoRecord,
): ExchangeRateDto {
  return {
    id: record.id,
    currencyId: record.currencyId,
    foreignUnitsPerCny: decimalString(record.foreignUnitsPerCny),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/** ExchangeRate 创建和更新都先锁 Currency，固定跨表事务的全局锁序。 */
export async function readCurrencyForExchangeRate(
  transaction: Prisma.TransactionClient,
  currencyId: string,
): Promise<CurrencyExchangeRateLockRecord | null> {
  const rows = await transaction.$queryRaw<
    CurrencyExchangeRateLockRecord[]
  >(
    Prisma.sql`
      SELECT "id", "code"
      FROM "currencies"
      WHERE "id" = CAST(${currencyId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] ?? null
}

/**
 * 更新前只读取归属用于定位 Currency；这不是显式行锁。真正的锁顺序仍是随后
 * Currency FOR UPDATE，再 ExchangeRate FOR UPDATE。
 */
export async function readExchangeRateIdentity(
  transaction: Prisma.TransactionClient,
  exchangeRateId: string,
): Promise<ExchangeRateIdentityRecord | null> {
  return transaction.exchangeRate.findUnique({
    where: { id: exchangeRateId },
    select: {
      id: true,
      currencyId: true,
    },
  })
}

/** 只能在对应 Currency 已锁定后调用。 */
export async function readExchangeRateForCurrency(
  transaction: Prisma.TransactionClient,
  currencyId: string,
): Promise<{ id: string } | null> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id"
      FROM "exchange_rates"
      WHERE "currency_id" = CAST(${currencyId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] ?? null
}

/** 只能在对应 Currency 已锁定后调用，避免跨表写形成反向锁序。 */
export async function readExchangeRateForMutation(
  transaction: Prisma.TransactionClient,
  exchangeRateId: string,
): Promise<ExchangeRateMutationRecord | null> {
  const rows = await transaction.$queryRaw<
    RawExchangeRateMutationRecord[]
  >(
    Prisma.sql`
      SELECT
        "id",
        "currency_id" AS "currencyId",
        "foreign_units_per_cny" AS "foreignUnitsPerCny",
        "version"
      FROM "exchange_rates"
      WHERE "id" = CAST(${exchangeRateId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] === undefined ? null : mapMutationRecord(rows[0])
}

export async function createExchangeRateRecord(
  transaction: Prisma.TransactionClient,
  input: {
    readonly currencyId: string
    readonly foreignUnitsPerCny: string
  },
): Promise<{ id: string }> {
  return transaction.exchangeRate.create({
    data: input,
    select: { id: true },
  })
}

export async function updateExchangeRateRecord(
  transaction: Prisma.TransactionClient,
  exchangeRateId: string,
  input: {
    readonly foreignUnitsPerCny: string
  },
): Promise<void> {
  await transaction.exchangeRate.update({
    where: { id: exchangeRateId },
    data: {
      ...input,
      version: { increment: 1 },
    },
    select: { id: true },
  })
}

/** mutation 最终响应在同一事务内读取，并在公共边界恢复为规范 decimal string。 */
export async function readExchangeRateCommandDto(
  transaction: Prisma.TransactionClient,
  exchangeRateId: string,
): Promise<ExchangeRateDto | null> {
  const record = await transaction.exchangeRate.findUnique({
    where: { id: exchangeRateId },
    select: {
      id: true,
      currencyId: true,
      foreignUnitsPerCny: true,
      version: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return record === null ? null : mapExchangeRateDto(record)
}
