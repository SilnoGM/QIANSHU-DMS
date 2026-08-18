import {
  FUND_ADJUSTMENT_MODES,
  FundCalculationError,
  normalizeFundAmount,
  normalizeFundShareRate,
  normalizePositiveFundAmount,
  type FundAdjustmentMode,
} from '../domain'
import {
  calculateFundBusinessFingerprintHash,
  calculateFundIdempotencyKeyHash,
  calculateFundManualAdjustmentFingerprintHash,
  calculateFundReversalFingerprintHash,
} from './fund-idempotency'
import { normalizeFundMetadata } from './fund-metadata'
import type {
  FundManualAdjustmentInput,
  FundMetadata,
  FundPostingContext,
  FundReversalInput,
  PostBusinessEventInput,
} from './fund-posting.contract'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
  type FundPostingErrorField,
} from './fund-posting.errors'

const CANONICAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const CONSUMER_CODE_PATTERN = /^[A-Z][A-Z0-9._-]{0,63}$/u
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ISO_8601_WITH_TIMEZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u

const CONTEXT_KEYS = new Set([
  'consumerCode',
  'sourceCode',
  'requestId',
  'correlationId',
])
const BUSINESS_INPUT_KEYS = new Set([
  'postingTypeCode',
  'userId',
  'amount',
  'businessId',
  'businessNo',
  'summary',
  'metadata',
  'businessOccurredAt',
  'idempotencyKey',
])
const MANUAL_ADJUSTMENT_KEYS = new Set([
  'userAccountId',
  'amount',
  'adjustmentMode',
  'reason',
  'metadata',
  'idempotencyKey',
])
const REVERSAL_KEYS = new Set([
  'originalBatchId',
  'amount',
  'reason',
  'idempotencyKey',
])

interface SafeRecord {
  readonly values: Readonly<Record<string, unknown>>
}

export type NormalizedFundPostingContext = FundPostingContext

export interface NormalizedPostBusinessEventInput
  extends Omit<
    PostBusinessEventInput,
    'userId' | 'businessNo' | 'businessOccurredAt' | 'idempotencyKey' | 'metadata'
  > {
  readonly userId: string | null
  readonly businessNo: string | null
  readonly metadata: FundMetadata
  readonly businessOccurredAt: string | null
}

export interface NormalizedPostBusinessEventRequest {
  readonly context: NormalizedFundPostingContext
  readonly input: NormalizedPostBusinessEventInput
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
}

export interface NormalizedFundManualAdjustmentInput
  extends Omit<FundManualAdjustmentInput, 'idempotencyKey' | 'metadata'> {
  readonly metadata: FundMetadata
}

export interface NormalizedFundManualAdjustmentRequest {
  readonly input: NormalizedFundManualAdjustmentInput
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
}

export type NormalizedFundReversalInput = Omit<FundReversalInput, 'idempotencyKey'>

export interface NormalizedFundReversalRequest {
  readonly input: NormalizedFundReversalInput
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
}

function validationFailed(field: FundPostingErrorField): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.VALIDATION_FAILED, field)
}

/**
 * 请求对象本身也按 descriptor 白名单读取，拒绝 accessor、symbol、数组和未知字段。
 * 这样 sourceCode 等可信上下文不能被 payload 影子字段覆盖，也不会执行 getter。
 */
function readSafeRecord(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
  field: FundPostingErrorField,
): SafeRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailed(field)
  }

  try {
    const prototype = Reflect.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      return validationFailed(field)
    }

    const keys = Reflect.ownKeys(input)
    if (keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
      return validationFailed(field)
    }

    const descriptors = Object.getOwnPropertyDescriptors(input)
    const values: Record<string, unknown> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)
      ) {
        return validationFailed(field)
      }
      values[key] = descriptor.value
    }

    return { values }
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    return validationFailed(field)
  }
}

function codePointLength(value: string): number {
  return [...value].length
}

function normalizeDisplayText(
  value: unknown,
  field: FundPostingErrorField,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return validationFailed(field)
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (
    normalized.length === 0
    || codePointLength(normalized) > maximumCodePoints
  ) {
    return validationFailed(field)
  }
  return normalized
}

function normalizeTechnicalText(
  value: unknown,
  field: FundPostingErrorField,
  maximumCodePoints = 128,
): string {
  if (typeof value !== 'string') return validationFailed(field)
  const normalized = value.normalize('NFC').trim()
  if (
    normalized.length === 0
    || codePointLength(normalized) > maximumCodePoints
  ) {
    return validationFailed(field)
  }
  return normalized
}

function normalizeCanonicalCode(
  value: unknown,
  field: FundPostingErrorField,
  pattern = CANONICAL_CODE_PATTERN,
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return validationFailed(field)
  }
  return value
}

function normalizeOptional<T>(
  value: unknown,
  normalizer: (input: unknown) => T,
): T | null {
  return value === undefined ? null : normalizer(value)
}

function normalizePostingAmount(value: unknown, positiveOnly: boolean): string {
  try {
    const normalized = positiveOnly
      ? normalizePositiveFundAmount(value)
      : normalizeFundAmount(value)
    if (normalized === '0.0000') {
      throw new FundPostingError(
        FUND_POSTING_ERROR_CODES.POSTING_AMOUNT_INVALID,
        'amount',
      )
    }
    return normalized
  }
  catch (error) {
    if (error instanceof FundPostingError) throw error
    if (error instanceof FundCalculationError) {
      throw new FundPostingError(error.code, 'amount')
    }
    throw error
  }
}

function normalizeBusinessOccurredAt(value: unknown): string {
  if (typeof value !== 'string') return validationFailed('businessOccurredAt')
  const match = ISO_8601_WITH_TIMEZONE_PATTERN.exec(value)
  if (match === null) return validationFailed('businessOccurredAt')

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const calendarProbe = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  if (
    calendarProbe.getUTCFullYear() !== year
    || calendarProbe.getUTCMonth() !== month - 1
    || calendarProbe.getUTCDate() !== day
    || calendarProbe.getUTCHours() !== hour
    || calendarProbe.getUTCMinutes() !== minute
    || calendarProbe.getUTCSeconds() !== second
  ) {
    return validationFailed('businessOccurredAt')
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return validationFailed('businessOccurredAt')
  return parsed.toISOString()
}

export function normalizeFundUuid(
  value: unknown,
  field: FundPostingErrorField,
): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    return validationFailed(field)
  }
  return value
}

export function normalizeFundShareRateInput(value: unknown): string {
  try {
    return normalizeFundShareRate(value)
  }
  catch (error) {
    if (error instanceof FundCalculationError) {
      throw new FundPostingError(error.code, 'shareRate')
    }
    throw error
  }
}

export function normalizePostBusinessEventRequest(
  rawContext: unknown,
  rawInput: unknown,
): NormalizedPostBusinessEventRequest {
  const contextRecord = readSafeRecord(rawContext, CONTEXT_KEYS, 'context').values
  const inputRecord = readSafeRecord(rawInput, BUSINESS_INPUT_KEYS, 'body').values

  const context: NormalizedFundPostingContext = Object.freeze({
    consumerCode: normalizeCanonicalCode(
      contextRecord.consumerCode,
      'consumerCode',
      CONSUMER_CODE_PATTERN,
    ),
    sourceCode: normalizeCanonicalCode(contextRecord.sourceCode, 'sourceCode'),
    requestId: normalizeTechnicalText(contextRecord.requestId, 'requestId'),
    ...(contextRecord.correlationId === undefined
      ? {}
      : {
          correlationId: normalizeTechnicalText(
            contextRecord.correlationId,
            'correlationId',
          ),
        }),
  })

  const input: NormalizedPostBusinessEventInput = Object.freeze({
    postingTypeCode: normalizeCanonicalCode(
      inputRecord.postingTypeCode,
      'postingTypeCode',
    ),
    userId: normalizeOptional(
      inputRecord.userId,
      value => normalizeFundUuid(value, 'userId'),
    ),
    amount: normalizePostingAmount(inputRecord.amount, false),
    businessId: normalizeDisplayText(inputRecord.businessId, 'businessId', 128),
    businessNo: normalizeOptional(
      inputRecord.businessNo,
      value => normalizeDisplayText(value, 'businessNo', 128),
    ),
    summary: normalizeDisplayText(inputRecord.summary, 'summary', 500),
    metadata: normalizeFundMetadata(inputRecord.metadata),
    businessOccurredAt: normalizeOptional(
      inputRecord.businessOccurredAt,
      normalizeBusinessOccurredAt,
    ),
  })

  const idempotencyKeyHash = calculateFundIdempotencyKeyHash(
    inputRecord.idempotencyKey,
  )
  const requestFingerprintHash = calculateFundBusinessFingerprintHash({
    consumerCode: context.consumerCode,
    sourceCode: context.sourceCode,
    ...input,
  })

  return Object.freeze({
    context,
    input,
    idempotencyKeyHash,
    requestFingerprintHash,
  })
}

export function normalizeFundManualAdjustmentRequest(
  rawInput: unknown,
): NormalizedFundManualAdjustmentRequest {
  const inputRecord = readSafeRecord(
    rawInput,
    MANUAL_ADJUSTMENT_KEYS,
    'body',
  ).values

  if (
    typeof inputRecord.adjustmentMode !== 'string'
    || !FUND_ADJUSTMENT_MODES.includes(
      inputRecord.adjustmentMode as FundAdjustmentMode,
    )
  ) {
    throw new FundPostingError(
      FUND_POSTING_ERROR_CODES.ADJUSTMENT_MODE_INVALID,
      'adjustmentMode',
    )
  }

  const input: NormalizedFundManualAdjustmentInput = Object.freeze({
    userAccountId: normalizeFundUuid(inputRecord.userAccountId, 'userAccountId'),
    amount: normalizePostingAmount(inputRecord.amount, false),
    adjustmentMode: inputRecord.adjustmentMode as FundAdjustmentMode,
    reason: normalizeDisplayText(inputRecord.reason, 'reason', 500),
    metadata: normalizeFundMetadata(inputRecord.metadata),
  })
  const idempotencyKeyHash = calculateFundIdempotencyKeyHash(
    inputRecord.idempotencyKey,
  )

  return Object.freeze({
    input,
    idempotencyKeyHash,
    requestFingerprintHash:
      calculateFundManualAdjustmentFingerprintHash(input),
  })
}

export function normalizeFundReversalRequest(
  rawInput: unknown,
): NormalizedFundReversalRequest {
  const inputRecord = readSafeRecord(rawInput, REVERSAL_KEYS, 'body').values
  const input: NormalizedFundReversalInput = Object.freeze({
    originalBatchId: normalizeFundUuid(
      inputRecord.originalBatchId,
      'originalBatchId',
    ),
    amount: normalizePostingAmount(inputRecord.amount, true),
    reason: normalizeDisplayText(inputRecord.reason, 'reason', 500),
  })
  const idempotencyKeyHash = calculateFundIdempotencyKeyHash(
    inputRecord.idempotencyKey,
  )

  return Object.freeze({
    input,
    idempotencyKeyHash,
    requestFingerprintHash: calculateFundReversalFingerprintHash(input),
  })
}

export interface FundPaginationInput {
  readonly page: unknown
  readonly pageSize: unknown
}

export interface NormalizedFundPagination {
  readonly page: number
  readonly pageSize: number
  readonly skip: number
}

export function normalizeFundPagination(
  input: FundPaginationInput,
): NormalizedFundPagination {
  if (!Number.isSafeInteger(input.page) || (input.page as number) < 1) {
    return validationFailed('page')
  }
  if (
    !Number.isSafeInteger(input.pageSize)
    || (input.pageSize as number) < 1
    || (input.pageSize as number) > 100
  ) {
    return validationFailed('pageSize')
  }

  const page = input.page as number
  const pageSize = input.pageSize as number
  const skip = (page - 1) * pageSize
  if (!Number.isSafeInteger(skip)) return validationFailed('page')
  return { page, pageSize, skip }
}

export type FundSortOrder = 'asc' | 'desc'

export function normalizeFundSort<T extends string>(
  sortBy: unknown,
  sortOrder: unknown,
  allowedSortFields: readonly T[],
  defaults: { readonly sortBy: T; readonly sortOrder: FundSortOrder },
): { readonly sortBy: T; readonly sortOrder: FundSortOrder } {
  const normalizedSortBy = sortBy === undefined ? defaults.sortBy : sortBy
  const normalizedSortOrder = sortOrder === undefined
    ? defaults.sortOrder
    : sortOrder

  if (
    typeof normalizedSortBy !== 'string'
    || !allowedSortFields.includes(normalizedSortBy as T)
  ) {
    return validationFailed('sortBy')
  }
  if (normalizedSortOrder !== 'asc' && normalizedSortOrder !== 'desc') {
    return validationFailed('sortOrder')
  }

  return {
    sortBy: normalizedSortBy as T,
    sortOrder: normalizedSortOrder,
  }
}
