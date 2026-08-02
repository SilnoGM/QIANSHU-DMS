import { createHash } from 'node:crypto'

import {
  NUMBERING_BOUNDARY_ERROR_CODES,
  NumberingGenerationError,
} from './numbering.errors'

const CANONICAL_RULE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const CONSUMER_CODE_PATTERN = /^[A-Z][A-Z0-9._-]{0,63}$/u
const IDEMPOTENCY_KEY_MINIMUM_BYTES = 1
const IDEMPOTENCY_KEY_MAXIMUM_BYTES = 200

export const NUMBERING_REQUEST_FINGERPRINT_VERSION =
  'numbering.generate.v1' as const

export interface GenerateNumberRequest {
  readonly ruleCode: string
  readonly consumerCode: string
  readonly idempotencyKey: string
}

export interface ValidatedGenerateNumberRequest {
  readonly ruleCode: string
  readonly consumerCode: string
  readonly idempotencyKeyHash: Buffer
  readonly requestFingerprintHash: Buffer
}

function validationFailure(): never {
  throw new NumberingGenerationError(
    NUMBERING_BOUNDARY_ERROR_CODES.VALIDATION_FAILED,
  )
}

function assertCanonicalRuleCode(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || !CANONICAL_RULE_CODE_PATTERN.test(value)
  ) {
    validationFailure()
  }
}

function assertConsumerCode(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !CONSUMER_CODE_PATTERN.test(value)) {
    validationFailure()
  }
}

/**
 * 幂等键只在此函数的局部变量中转换为 bytes；异常和返回对象都不保留原文。
 * byteLength 与 Hash 使用同一份原始 UTF-8 bytes，绝不 trim、改大小写或 NFC。
 */
export function calculateIdempotencyKeyHash(value: unknown): Buffer {
  if (typeof value !== 'string') {
    return validationFailure()
  }

  const bytes = Buffer.from(value, 'utf8')
  if (
    bytes.byteLength < IDEMPOTENCY_KEY_MINIMUM_BYTES
    || bytes.byteLength > IDEMPOTENCY_KEY_MAXIMUM_BYTES
  ) {
    return validationFailure()
  }

  return createHash('sha256').update(bytes).digest()
}

export function calculateNumberingRequestFingerprintHash(
  ruleCode: unknown,
): Buffer {
  assertCanonicalRuleCode(ruleCode)
  const bytes = Buffer.from(
    `${NUMBERING_REQUEST_FINGERPRINT_VERSION}\0${ruleCode}`,
    'utf8',
  )

  return createHash('sha256').update(bytes).digest()
}

/** 校验后主动丢弃原始幂等键，后续 persistence 只消费两个 32-byte Hash。 */
export function validateGenerateNumberRequest(
  input: GenerateNumberRequest,
): ValidatedGenerateNumberRequest {
  if (typeof input !== 'object' || input === null) {
    return validationFailure()
  }

  assertCanonicalRuleCode(input.ruleCode)
  assertConsumerCode(input.consumerCode)

  return {
    ruleCode: input.ruleCode,
    consumerCode: input.consumerCode,
    idempotencyKeyHash: calculateIdempotencyKeyHash(input.idempotencyKey),
    requestFingerprintHash:
      calculateNumberingRequestFingerprintHash(input.ruleCode),
  }
}
