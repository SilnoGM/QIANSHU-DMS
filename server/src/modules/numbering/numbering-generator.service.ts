import { timingSafeEqual } from 'node:crypto'

import { Inject, Injectable, Optional } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { NumberingRuleStatus } from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  hasPersistenceTarget,
  readPersistenceErrorFacts,
  type PersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import {
  calculateRuleCapacity,
  calculateSequenceState,
} from './capacity'
import { readNumberingTransactionTimestamp } from './numbering-command.persistence'
import {
  advancePeriodState,
  insertSequenceIssuance,
  lockOrCreatePeriodState,
  readActiveGenerationSnapshot,
  readIdempotentIssuance,
  readRuleForGeneration,
  tryInsertRandomIssuance,
  type IdempotentIssuanceRecord,
} from './numbering-generator.persistence'
import type {
  GenerateNumberRequest,
  GenerateScopedNumberRequest,
  ValidatedGenerateNumberRequest,
} from './numbering-internal-input'
import {
  validateGenerateNumberRequest,
  validateGenerateScopedNumberRequest,
} from './numbering-internal-input'
import { getNumberingPeriodKey } from './period'
import { NUMBERING_RANDOM_SOURCE } from './numbering-query.service'
import {
  cryptoNumberingRandomSource,
  type NumberingRandomSource,
} from './random-source'
import {
  NUMBERING_BOUNDARY_ERROR_CODES,
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
  type NumberingGenerationErrorCode,
} from './numbering.errors'
import { renderNumberingCandidate } from './renderer'
import { retryRandomCandidate } from './random-retry'
import {
  NumberingRuleConfigError,
  type NumberingSequenceSegment,
} from './rule-engine'

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
function toIndependentResult(
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

function generationFailure(code: NumberingGenerationErrorCode): never {
  throw new NumberingGenerationError(code)
}

function hasUniqueViolation(facts: PersistenceErrorFacts): boolean {
  return hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
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

function toGenerationError(error: unknown): NumberingGenerationError {
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

function resolveIdempotentRecord(
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

function findSequenceSegment(
  snapshot: Awaited<ReturnType<typeof readActiveGenerationSnapshot>>,
): NumberingSequenceSegment | undefined {
  return snapshot?.config.segments.find(
    (segment): segment is NumberingSequenceSegment =>
      segment.type === 'SEQUENCE',
  )
}

@Injectable()
export class NumberingGeneratorService {
  private readonly randomSource: NumberingRandomSource

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NUMBERING_RANDOM_SOURCE)
    randomSource?: NumberingRandomSource,
  ) {
    this.randomSource = randomSource ?? cryptoNumberingRandomSource
  }

  async generate(
    input: Readonly<GenerateNumberRequest>,
  ): Promise<GenerateNumberResult> {
    return this.generateValidated(validateGenerateNumberRequest(input))
  }

  async generateScoped(
    input: Readonly<GenerateScopedNumberRequest>,
  ): Promise<GenerateNumberResult> {
    return this.generateValidated(validateGenerateScopedNumberRequest(input))
  }

  /**
   * 调用方必须在事务第一条 SQL 设置固定超时，并负责提交或回滚全部业务事实。
   * 本入口不嵌套事务，也不在失败事务内查询 ledger；竞态恢复须由调用方回滚后执行。
   */
  async generateScopedInTransaction(
    transaction: Prisma.TransactionClient,
    input: Readonly<GenerateScopedNumberRequest>,
  ): Promise<GenerateNumberInTransactionResult> {
    const request = validateGenerateScopedNumberRequest(input)
    try {
      return await this.generateInTransaction(transaction, request)
    } catch (error) {
      if (isIdempotencyUniqueViolation(error)) {
        throw new NumberingGenerationError(NUMBERING_ERROR_CODES.RULE_STATE_CHANGED)
      }
      throw toGenerationError(error)
    }
  }

  /** 独立派发入口负责自己的事务生命周期，之后与调用方事务入口共用状态机。 */
  private async generateValidated(
    request: ValidatedGenerateNumberRequest,
  ): Promise<GenerateNumberResult> {
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return this.generateInTransaction(transaction, request)
      })
      return toIndependentResult(result)
    } catch (error) {
      if (isIdempotencyUniqueViolation(error)) {
        return this.recoverIdempotencyRace(request, error)
      }
      throw toGenerationError(error)
    }
  }

  private async generateInTransaction(
    transaction: Prisma.TransactionClient,
    request: ValidatedGenerateNumberRequest,
  ): Promise<GenerateNumberInTransactionResult> {
    // 超时由事务所有者设置；状态机只使用一次读取到的数据库时间。
    const asOf = await readNumberingTransactionTimestamp(transaction)

    const firstReplay = resolveIdempotentRecord(
      await readIdempotentIssuance(
        transaction,
        request.consumerCode,
        request.idempotencyKeyHash,
      ),
      request,
    )
    if (firstReplay !== null) {
      return firstReplay
    }

    const rule = await readRuleForGeneration(transaction, request.ruleCode)
    const secondReplay = resolveIdempotentRecord(
      await readIdempotentIssuance(
        transaction,
        request.consumerCode,
        request.idempotencyKeyHash,
      ),
      request,
    )
    if (secondReplay !== null) {
      return secondReplay
    }
    if (rule === null) {
      return generationFailure(NUMBERING_ERROR_CODES.RULE_NOT_FOUND)
    }
    if (rule.status !== NumberingRuleStatus.ENABLED) {
      return generationFailure(NUMBERING_ERROR_CODES.RULE_UNAVAILABLE)
    }

    const snapshot = await readActiveGenerationSnapshot(transaction, rule.id)
    if (snapshot === null) {
      return generationFailure(NUMBERING_ERROR_CODES.RULE_UNAVAILABLE)
    }
    const sequence = findSequenceSegment(snapshot)
    const initialNextSequenceValue = sequence === undefined
      ? null
      : calculateSequenceState(sequence, 0n).nextSequenceValue
    if (sequence !== undefined && initialNextSequenceValue === null) {
      return generationFailure(NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID)
    }

    const periodKey = getNumberingPeriodKey(
      snapshot.config.resetPolicy,
      asOf,
    )
    const state = await lockOrCreatePeriodState(transaction, {
      ruleId: rule.id,
      periodKey,
      initialNextSequenceValue,
    })
    const thirdReplay = resolveIdempotentRecord(
      await readIdempotentIssuance(
        transaction,
        request.consumerCode,
        request.idempotencyKeyHash,
      ),
      request,
    )
    if (thirdReplay !== null) {
      return thirdReplay
    }

    const issuanceBase = {
      ruleId: rule.id,
      ruleVersionId: snapshot.versionId,
      periodKey,
      consumerCode: request.consumerCode,
      idempotencyKeyHash: request.idempotencyKeyHash,
      requestFingerprintHash: request.requestFingerprintHash,
      issuedAt: asOf,
    }

    if (sequence !== undefined) {
      const sequenceState = calculateSequenceState(sequence, state.usedCount)
      if (state.nextSequenceValue !== sequenceState.nextSequenceValue) {
        return generationFailure(NUMBERING_ERROR_CODES.OUTPUT_CONFLICT)
      }
      if (sequenceState.exhausted || sequenceState.nextSequenceValue === null) {
        return generationFailure(NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED)
      }

      const number = renderNumberingCandidate(
        snapshot.config,
        asOf,
        sequenceState.nextSequenceValue,
        this.randomSource,
      )
      const issuanceId = await insertSequenceIssuance(transaction, {
        ...issuanceBase,
        generatedNumber: number,
        sequenceValue: sequenceState.nextSequenceValue,
      })
      const nextState = calculateSequenceState(
        sequence,
        state.usedCount + 1n,
      )
      await advancePeriodState(transaction, {
        periodStateId: state.id,
        nextSequenceValue: nextState.nextSequenceValue,
      })

      return {
        issuanceId,
        number,
        ruleCode: request.ruleCode,
        ruleRevision: snapshot.revision,
        issuedAt: asOf.toISOString(),
        idempotentReplay: false,
      }
    }

    if (state.nextSequenceValue !== null) {
      return generationFailure(NUMBERING_ERROR_CODES.OUTPUT_CONFLICT)
    }
    const randomCapacity = calculateRuleCapacity(snapshot.config)
    if (state.usedCount >= randomCapacity) {
      return generationFailure(NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED)
    }

    let issuanceId: string | null = null
    const number = await retryRandomCandidate(
      () => renderNumberingCandidate(
        snapshot.config,
        asOf,
        null,
        this.randomSource,
      ),
      async (candidate) => {
        issuanceId = await tryInsertRandomIssuance(transaction, {
          ...issuanceBase,
          generatedNumber: candidate,
          sequenceValue: null,
        })
        return issuanceId !== null
      },
    )
    if (issuanceId === null) {
      return generationFailure(NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR)
    }
    await advancePeriodState(transaction, {
      periodStateId: state.id,
      nextSequenceValue: null,
    })

    return {
      issuanceId,
      number,
      ruleCode: request.ruleCode,
      ruleRevision: snapshot.revision,
      issuedAt: asOf.toISOString(),
      idempotentReplay: false,
    }
  }

  /**
   * 幂等唯一竞态已经使主事务回滚；这里只在新事务中重读 ledger，不自动再次
   * 运行生成状态机，避免一次调用在未知提交状态下消费第二个编号。
   */
  private async recoverIdempotencyRace(
    request: ValidatedGenerateNumberRequest,
    originalError: unknown,
  ): Promise<GenerateNumberResult> {
    let record: IdempotentIssuanceRecord | null
    try {
      record = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return readIdempotentIssuance(
          transaction,
          request.consumerCode,
          request.idempotencyKeyHash,
        )
      })
    } catch (error) {
      throw toGenerationError(error)
    }

    const replay = resolveIdempotentRecord(record, request)
    if (replay !== null) {
      return toIndependentResult(replay)
    }
    throw toGenerationError(originalError)
  }
}
