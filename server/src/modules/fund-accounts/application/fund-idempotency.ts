import { createHash } from 'node:crypto'

import type { FundAdjustmentMode } from '../domain'
import type { FundMetadata } from './fund-posting.contract'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

const IDEMPOTENCY_KEY_MINIMUM_BYTES = 1
const IDEMPOTENCY_KEY_MAXIMUM_BYTES = 200

export const FUND_REQUEST_FINGERPRINT_VERSIONS = {
  BUSINESS_POSTING: 'fund.business-posting.v1',
  MANUAL_ADJUSTMENT: 'fund.manual-adjustment.v1',
  REVERSAL: 'fund.reversal.v1',
} as const

export interface FundBusinessFingerprintInput {
  readonly consumerCode: string
  readonly sourceCode: string
  readonly postingTypeCode: string
  readonly userId: string | null
  readonly amount: string
  readonly businessId: string
  readonly businessNo: string | null
  readonly summary: string
  readonly metadata: FundMetadata
  readonly businessOccurredAt: string | null
}

export interface FundManualAdjustmentFingerprintInput {
  readonly userAccountId: string
  readonly amount: string
  readonly adjustmentMode: FundAdjustmentMode
  readonly reason: string
  readonly metadata: FundMetadata
}

export interface FundReversalFingerprintInput {
  readonly originalBatchId: string
  readonly amount: string
  readonly reason: string
}

function sha256Utf8(value: string): Buffer {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest()
}

/**
 * 指纹 v1 在两位精度发布前使用固定四位金额。数据库、API 与计算已统一为两位，
 * 但 Hash 仍需扩展回四位，确保部署前成功请求可以用同一 key 安全重放。
 */
function toLegacyV1FingerprintAmount(value: string): string {
  const separatorIndex = value.indexOf('.')
  if (separatorIndex < 0) return `${value}.0000`

  const fractionalLength = value.length - separatorIndex - 1
  return fractionalLength >= 4
    ? value
    : value.padEnd(value.length + 4 - fractionalLength, '0')
}

/** 原始 key 的 UTF-8 bytes 既用于长度校验也用于 Hash，中间不做任何规范化。 */
export function calculateFundIdempotencyKeyHash(value: unknown): Buffer {
  if (typeof value !== 'string') {
    throw new FundPostingError(
      FUND_POSTING_ERROR_CODES.VALIDATION_FAILED,
      'idempotencyKey',
    )
  }

  const bytes = Buffer.from(value, 'utf8')
  if (
    bytes.byteLength < IDEMPOTENCY_KEY_MINIMUM_BYTES
    || bytes.byteLength > IDEMPOTENCY_KEY_MAXIMUM_BYTES
  ) {
    throw new FundPostingError(
      FUND_POSTING_ERROR_CODES.VALIDATION_FAILED,
      'idempotencyKey',
    )
  }

  return createHash('sha256').update(bytes).digest()
}

/**
 * 显式排列全部业务语义字段，避免依赖对象插入顺序。requestId/correlationId 只用于
 * 观测，不参与业务幂等语义；metadata 已由边界按 key 排序。
 */
export function calculateFundBusinessFingerprintHash(
  input: FundBusinessFingerprintInput,
): Buffer {
  return sha256Utf8(JSON.stringify({
    version: FUND_REQUEST_FINGERPRINT_VERSIONS.BUSINESS_POSTING,
    consumerCode: input.consumerCode,
    sourceCode: input.sourceCode,
    postingTypeCode: input.postingTypeCode,
    userId: input.userId,
    amount: toLegacyV1FingerprintAmount(input.amount),
    businessId: input.businessId,
    businessNo: input.businessNo,
    summary: input.summary,
    metadata: input.metadata,
    businessOccurredAt: input.businessOccurredAt,
  }))
}

export function calculateFundManualAdjustmentFingerprintHash(
  input: FundManualAdjustmentFingerprintInput,
): Buffer {
  return sha256Utf8(JSON.stringify({
    version: FUND_REQUEST_FINGERPRINT_VERSIONS.MANUAL_ADJUSTMENT,
    userAccountId: input.userAccountId,
    amount: toLegacyV1FingerprintAmount(input.amount),
    adjustmentMode: input.adjustmentMode,
    reason: input.reason,
    metadata: input.metadata,
  }))
}

export function calculateFundReversalFingerprintHash(
  input: FundReversalFingerprintInput,
): Buffer {
  return sha256Utf8(JSON.stringify({
    version: FUND_REQUEST_FINGERPRINT_VERSIONS.REVERSAL,
    originalBatchId: input.originalBatchId,
    amount: toLegacyV1FingerprintAmount(input.amount),
    reason: input.reason,
  }))
}
