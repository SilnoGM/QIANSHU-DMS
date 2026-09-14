import { timingSafeEqual } from 'node:crypto'

import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
  type PersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import type { ActiveGenerationSnapshot, IdempotentIssuanceRecord } from './numbering-generator.persistence'
import type { ValidatedGenerateNumberRequest } from './numbering-internal-input'
import {
  NUMBERING_BOUNDARY_ERROR_CODES,
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
  type NumberingGenerationErrorCode,
} from './numbering.errors'
import { NumberingRuleConfigError, type NumberingSequenceSegment } from './rule-engine'

export interface GenerateNumberResult {
  readonly number: string
  readonly ruleCode: string
  readonly ruleRevision: number
  readonly issuedAt: string
  readonly idempotentReplay: boolean
}

export interface GenerateNumberInTransactionResult extends GenerateNumberResult {
  readonly issuanceId: string
}

/** 独立派发入口保留原返回契约；ledger 身份只提供给共同提交业务事实的新入口。 */
export function toIndependentResult(
  result: GenerateNumberInTransactionResult,
): GenerateNumberResult {
  return {
    number: result.number,
    ruleCode: result.ruleCode,
    ruleRevision: result.ruleRevision,
    issuedAt: result.issuedAt,
    idempotentReplay: result.idempotentReplay,
  }
}

const IDEMPOTENCY_UNIQUE_CONSTRAINT =
  'numbering_issuances_consumer_code_idempotency_key_hash_key'
const OUTPUT_UNIQUE_CONSTRAINT =
  'numbering_issuances_rule_id_generated_number_key'

export function generationFailure(code: NumberingGenerationErrorCode): never {
  throw new NumberingGenerationError(code)
}

function hasUniqueViolation(facts: PersistenceErrorFacts): boolean {
  return hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
}

export function isIdempotencyUniqueViolation(error: unknown): boolean {
  const facts = readPersistenceErrorFacts(error)
  return hasUniqueViolation(facts)
    && (
      hasPersistenceConstraint(facts, IDEMPOTENCY_UNIQUE_CONSTRAINT)
      || (
        hasPersistenceTarget(facts, 'consumerCode')
        && hasPersistenceTarget(facts, 'idempotencyKeyHash')
      )
    )
}

function isOutputUniqueViolation(facts: PersistenceErrorFacts): boolean {
  return hasUniqueViolation(facts)
    && (
      hasPersistenceConstraint(facts, OUTPUT_UNIQUE_CONSTRAINT)
      || (
        hasPersistenceTarget(facts, 'ruleId')
        && hasPersistenceTarget(facts, 'generatedNumber')
      )
    )
}

export function toGenerationError(error: unknown): NumberingGenerationError {
  if (error instanceof NumberingGenerationError) {
    return error
  }
  if (error instanceof NumberingRuleConfigError) {
    return new NumberingGenerationError(
      NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
    )
  }

  const facts = readPersistenceErrorFacts(error)
  if (
    hasPersistenceCode(facts, 'P2034')
    || hasPersistenceCode(facts, '40001')
    || hasPersistenceCode(facts, '40P01')
    || hasPersistenceCode(facts, '55P03')
    || hasPersistenceCode(facts, '57014')
  ) {
    return new NumberingGenerationError(
      NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
    )
  }
  if (isOutputUniqueViolation(facts)) {
    return new NumberingGenerationError(
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
    )
  }
  return new NumberingGenerationError(
    NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR,
  )
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength
    && timingSafeEqual(left, right)
}

export function resolveIdempotentRecord(
  record: IdempotentIssuanceRecord | null,
  request: ValidatedGenerateNumberRequest,
): GenerateNumberInTransactionResult | null {
  if (record === null) {
    return null
  }
  if (
    record.ruleCode !== request.ruleCode
    || !sameHash(record.requestFingerprintHash, request.requestFingerprintHash)
  ) {
    return generationFailure(NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT)
  }

  return {
    issuanceId: record.id,
    number: record.generatedNumber,
    ruleCode: record.ruleCode,
    ruleRevision: record.revision,
    issuedAt: record.issuedAt.toISOString(),
    idempotentReplay: true,
  }
}

export function findSequenceSegment(
  snapshot: ActiveGenerationSnapshot | null,
): NumberingSequenceSegment | undefined {
  return snapshot?.config.segments.find(
    (segment): segment is NumberingSequenceSegment =>
      segment.type === 'SEQUENCE',
  )
}
