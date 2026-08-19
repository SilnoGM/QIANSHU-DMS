import type { FundMetadata, FundMetadataValue } from './fund-posting.contract'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

const FUND_METADATA_MAXIMUM_ENTRIES = 32
const FUND_METADATA_KEY_MAXIMUM_CODE_POINTS = 128
const FUND_METADATA_STRING_MAXIMUM_CODE_POINTS = 512
const FUND_METADATA_MAXIMUM_UTF8_BYTES = 8_192
const FUND_METADATA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function metadataInvalid(): never {
  throw new FundPostingError(
    FUND_POSTING_ERROR_CODES.METADATA_INVALID,
    'metadata',
  )
}

function codePointLength(value: string): number {
  return [...value].length
}

function normalizeMetadataValue(value: unknown): FundMetadataValue {
  if (value === null || typeof value === 'boolean') return value

  if (typeof value === 'string') {
    if (codePointLength(value) > FUND_METADATA_STRING_MAXIMUM_CODE_POINTS) {
      return metadataInvalid()
    }
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value
  }

  return metadataInvalid()
}

/**
 * metadata 是受限的标量扩展区，不是任意 JSON。通过 property descriptors 读取值，
 * 明确拒绝 accessor 与 symbol，因而不会为了校验而执行调用方 getter。
 */
export function normalizeFundMetadata(value: unknown): FundMetadata {
  if (value === undefined) return Object.freeze({})
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return metadataInvalid()
  }

  try {
    const prototype = Reflect.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return metadataInvalid()
    }

    const keys = Reflect.ownKeys(value)
    if (
      keys.length > FUND_METADATA_MAXIMUM_ENTRIES
      || keys.some(key => typeof key !== 'string')
    ) {
      return metadataInvalid()
    }

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const normalizedEntries: Array<readonly [string, FundMetadataValue]> = []

    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)
        || DANGEROUS_METADATA_KEYS.has(key)
        || codePointLength(key) > FUND_METADATA_KEY_MAXIMUM_CODE_POINTS
        || !FUND_METADATA_KEY_PATTERN.test(key)
      ) {
        return metadataInvalid()
      }

      normalizedEntries.push([key, normalizeMetadataValue(descriptor.value)])
    }

    normalizedEntries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    const normalized = Object.fromEntries(normalizedEntries) as Record<
      string,
      FundMetadataValue
    >
    const serialized = JSON.stringify(normalized)

    if (Buffer.byteLength(serialized, 'utf8') > FUND_METADATA_MAXIMUM_UTF8_BYTES) {
      return metadataInvalid()
    }

    return Object.freeze(normalized)
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    return metadataInvalid()
  }
}
