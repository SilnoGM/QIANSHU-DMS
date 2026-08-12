import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u

export type CurrencyLookupFailureReason =
  | 'INPUT_INVALID'
  | 'CURRENCY_NOT_FOUND'
  | 'CURRENCY_DISABLED'
  | 'CURRENCY_MINOR_UNIT_INVALID'
  | 'PERSISTENCE_ERROR'

export type CurrencyMinorUnit = 0 | 1 | 2 | 3 | 4

export interface EffectiveCurrency {
  readonly code: string
  readonly minorUnit: CurrencyMinorUnit
}

interface LockedCurrencyRow {
  readonly code: unknown
  readonly enabled: unknown
  readonly minorUnit: unknown
}

/**
 * 货币 Lookup 的错误仅保留稳定分类。不得附加输入 code、SQL、驱动异常或连接
 * 信息，调用业务域只依据 reason 映射自己的公共错误。
 */
export class CurrencyLookupError extends Error {
  readonly code = 'CURRENCY_LOOKUP_FAILED'

  constructor(readonly reason: CurrencyLookupFailureReason) {
    super('Currency lookup failed')
    this.name = 'CurrencyLookupError'
  }
}

function lookupFailure(reason: CurrencyLookupFailureReason): never {
  throw new CurrencyLookupError(reason)
}

function normalizeCodes(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    return lookupFailure('INPUT_INVALID')
  }

  const uniqueCodes = new Set<string>()
  for (const code of input as readonly unknown[]) {
    if (typeof code !== 'string' || !CURRENCY_CODE_PATTERN.test(code)) {
      return lookupFailure('INPUT_INVALID')
    }
    uniqueCodes.add(code)
  }

  // code 已限制为 ASCII 大写三字母，默认 code-unit 排序等价于数据库 byte order。
  return Object.freeze([...uniqueCodes].sort())
}

function isCurrencyMinorUnit(value: unknown): value is CurrencyMinorUnit {
  return Number.isInteger(value) && typeof value === 'number'
    && value >= 0 && value <= 4
}

/**
 * 业务写入使用的事务内货币有效性边界。调用方负责开启事务并先设置 timeout；
 * Lookup 自身只执行一条稳定排序的共享锁查询，绝不创建嵌套事务。
 */
@Injectable()
export class CurrencyLookupService {
  async requireEnabledCodes(
    transaction: Prisma.TransactionClient,
    input: readonly string[],
  ): Promise<readonly EffectiveCurrency[]> {
    const codes = normalizeCodes(input)
    if (codes.length === 0) return Object.freeze([])

    let rows: readonly LockedCurrencyRow[]
    try {
      rows = await transaction.$queryRaw<LockedCurrencyRow[]>(Prisma.sql`
        SELECT "code", "enabled", "minor_unit" AS "minorUnit"
        FROM "currencies"
        WHERE "code" IN (${Prisma.join([...codes])})
        ORDER BY "code" COLLATE "C" ASC
        FOR SHARE
      `)
    }
    catch {
      return lookupFailure('PERSISTENCE_ERROR')
    }

    if (rows.length !== codes.length) {
      return lookupFailure('CURRENCY_NOT_FOUND')
    }

    const currencies: EffectiveCurrency[] = []
    for (let index = 0; index < codes.length; index += 1) {
      const expectedCode = codes[index]
      const row = rows[index]
      if (row === undefined || row.code !== expectedCode) {
        return lookupFailure('CURRENCY_NOT_FOUND')
      }
      if (row.enabled !== true) {
        return row.enabled === false
          ? lookupFailure('CURRENCY_DISABLED')
          : lookupFailure('PERSISTENCE_ERROR')
      }
      if (!isCurrencyMinorUnit(row.minorUnit)) {
        return lookupFailure('CURRENCY_MINOR_UNIT_INVALID')
      }

      currencies.push(Object.freeze({
        code: expectedCode,
        minorUnit: row.minorUnit,
      }))
    }

    return Object.freeze(currencies)
  }
}
