import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import type {
  DictionaryTone as DictionaryToneValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  isNormalizableDictionaryItemValue,
  isNormalizableDictionaryTypeCode,
  normalizeDictionaryItemValue,
  normalizeDictionaryTypeCode,
} from './dictionary.normalizer'

export type DictionaryValueUnavailableReason =
  | 'DICTIONARY_TYPE_NOT_FOUND'
  | 'DICTIONARY_TYPE_DISABLED'
  | 'DICTIONARY_ITEM_NOT_FOUND'
  | 'DICTIONARY_ITEM_DISABLED'

export type DictionaryLookupValidationField =
  | 'dictionaryCode'
  | 'value'

export interface DictionaryLookupInput {
  readonly dictionaryCode: string
  readonly value: string
}

export interface EffectiveDictionaryValue {
  readonly dictionaryCode: string
  readonly value: string
  readonly label: string
  readonly tone: DictionaryToneValue
}

export interface KnownStoredDictionaryValue {
  readonly known: true
  readonly dictionaryCode: string
  readonly value: string
  readonly label: string
  readonly tone: DictionaryToneValue
  readonly typeEnabled: boolean
  readonly itemEnabled: boolean
  readonly effectiveEnabled: boolean
}

export interface UnknownStoredDictionaryValue {
  readonly known: false
  readonly dictionaryCode: string
  readonly value: string
}

export type StoredDictionaryValueResolution =
  | KnownStoredDictionaryValue
  | UnknownStoredDictionaryValue

export class DictionaryValueUnavailableError extends Error {
  readonly code = 'DICTIONARY_VALUE_NOT_EFFECTIVE'

  constructor(readonly reason: DictionaryValueUnavailableReason) {
    super('Dictionary value is not effective')
    this.name = 'DictionaryValueUnavailableError'
  }
}

export class DictionaryLookupValidationError extends Error {
  readonly code = 'DICTIONARY_LOOKUP_INPUT_INVALID'

  constructor(readonly field: DictionaryLookupValidationField) {
    super('Dictionary lookup input is invalid')
    this.name = 'DictionaryLookupValidationError'
  }
}

interface LockedDictionaryTypeRow {
  readonly id: string
  readonly enabled: boolean
}

interface LockedDictionaryItemRow {
  readonly value: string
  readonly label: string
  readonly tone: DictionaryToneValue
  readonly enabled: boolean
}

interface NormalizedEffectiveLookupInput {
  readonly dictionaryCode: string
  readonly value: string
}

/**
 * Server 业务模块的字典消费边界。有效性校验复用调用方事务并显式锁行；
 * 历史解析则保持普通只读，二者不能互换，也不能通过自身 HTTP Catalog 绕行。
 */
@Injectable()
export class DictionaryLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async requireEffectiveValue(
    transaction: Prisma.TransactionClient,
    input: DictionaryLookupInput,
  ): Promise<EffectiveDictionaryValue> {
    const normalized = normalizeEffectiveLookupInput(input)

    /*
     * 调用方拥有事务且已设置 timeout；Lookup 不创建嵌套事务。分成两条 SQL
     * 才能把全系统锁序固定为 Type FOR SHARE -> Item FOR SHARE。
     */
    const typeRows = await transaction.$queryRaw<LockedDictionaryTypeRow[]>(
      Prisma.sql`
        SELECT "id", "enabled"
        FROM "dictionary_types"
        WHERE "code" = ${normalized.dictionaryCode}
        FOR SHARE
      `,
    )
    const dictionaryType = typeRows[0]
    if (dictionaryType === undefined) {
      throw new DictionaryValueUnavailableError(
        'DICTIONARY_TYPE_NOT_FOUND',
      )
    }
    if (!dictionaryType.enabled) {
      throw new DictionaryValueUnavailableError(
        'DICTIONARY_TYPE_DISABLED',
      )
    }

    const itemRows = await transaction.$queryRaw<LockedDictionaryItemRow[]>(
      Prisma.sql`
        SELECT "value", "label", "tone"::text AS "tone", "enabled"
        FROM "dictionary_items"
        WHERE "dictionary_type_id" = CAST(${dictionaryType.id} AS uuid)
          AND "value" = ${normalized.value}
        FOR SHARE
      `,
    )
    const dictionaryItem = itemRows[0]
    if (dictionaryItem === undefined) {
      throw new DictionaryValueUnavailableError(
        'DICTIONARY_ITEM_NOT_FOUND',
      )
    }
    if (!dictionaryItem.enabled) {
      throw new DictionaryValueUnavailableError(
        'DICTIONARY_ITEM_DISABLED',
      )
    }

    return {
      dictionaryCode: normalized.dictionaryCode,
      value: dictionaryItem.value,
      label: dictionaryItem.label,
      tone: dictionaryItem.tone,
    }
  }

  async resolveStoredValue(
    input: DictionaryLookupInput,
  ): Promise<StoredDictionaryValueResolution> {
    const normalizedCode = normalizeLookupCode(input)
    const rawValue = readRawStoredValue(input)
    const item = await this.prisma.dictionaryItem.findFirst({
      where: {
        value: rawValue,
        dictionaryType: { code: normalizedCode },
      },
      select: {
        value: true,
        label: true,
        tone: true,
        enabled: true,
        dictionaryType: { select: { enabled: true } },
      },
    })

    if (item === null) {
      return {
        known: false,
        dictionaryCode: normalizedCode,
        value: rawValue,
      }
    }

    return {
      known: true,
      dictionaryCode: normalizedCode,
      value: item.value,
      label: item.label,
      tone: item.tone,
      typeEnabled: item.dictionaryType.enabled,
      itemEnabled: item.enabled,
      effectiveEnabled: item.dictionaryType.enabled && item.enabled,
    }
  }
}

function requireLookupInputRecord(
  input: unknown,
): asserts input is Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DictionaryLookupValidationError('dictionaryCode')
  }
}

function normalizeLookupCode(input: unknown): string {
  requireLookupInputRecord(input)
  if (!isNormalizableDictionaryTypeCode(input.dictionaryCode)) {
    throw new DictionaryLookupValidationError('dictionaryCode')
  }

  return normalizeDictionaryTypeCode(input.dictionaryCode)
}

function normalizeEffectiveLookupInput(
  input: unknown,
): NormalizedEffectiveLookupInput {
  const dictionaryCode = normalizeLookupCode(input)
  requireLookupInputRecord(input)
  if (!isNormalizableDictionaryItemValue(input.value)) {
    throw new DictionaryLookupValidationError('value')
  }

  return {
    dictionaryCode,
    value: normalizeDictionaryItemValue(input.value),
  }
}

/** 历史 value 只校验运行时 string 类型；任何 trim/case/长度处理都会篡改身份。 */
function readRawStoredValue(input: unknown): string {
  requireLookupInputRecord(input)
  if (typeof input.value !== 'string') {
    throw new DictionaryLookupValidationError('value')
  }

  return input.value
}
