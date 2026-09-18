import type { Prisma } from '../../generated/prisma/client'
import { calculateRuleCapacity, calculateSequenceState } from './capacity'
import { readNumberingTransactionTimestamp } from './numbering-command.persistence'
import {
  advanceBatchPeriodState,
  insertSequenceIssuanceBatch,
  readBatchIdempotentIssuances,
  tryInsertRandomIssuanceBatch,
  type InsertedBatchIssuance,
} from './numbering-generator-batch.persistence'
import {
  lockOrCreatePeriodState,
  readActiveGenerationSnapshot,
  readRuleForGeneration,
} from './numbering-generator.persistence'
import {
  findSequenceSegment,
  generationFailure,
  resolveIdempotentRecord,
  type GenerateNumberInTransactionResult,
} from './numbering-generator.shared'
import {
  validateGenerateScopedNumberRequest,
  type GenerateScopedNumberRequest,
  type ValidatedGenerateNumberRequest,
} from './numbering-internal-input'
import { NUMBERING_BOUNDARY_ERROR_CODES, NUMBERING_ERROR_CODES } from './numbering.errors'
import { getNumberingPeriodKey } from './period'
import type { NumberingRandomSource } from './random-source'
import { MAX_RANDOM_ATTEMPTS } from './random-retry'
import { renderNumberingCandidate } from './renderer'

function key(request: ValidatedGenerateNumberRequest): string {
  return request.idempotencyKeyHash.toString('hex')
}

function validateBatch(inputs: readonly GenerateScopedNumberRequest[]): ValidatedGenerateNumberRequest[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 1000) {
    return generationFailure(NUMBERING_BOUNDARY_ERROR_CODES.VALIDATION_FAILED)
  }
  const requests = Array.from(inputs, validateGenerateScopedNumberRequest)
  const first = requests[0]
  if (requests.some(request => request.ruleCode !== first.ruleCode || request.consumerCode !== first.consumerCode)
    || new Set(requests.map(key)).size !== requests.length) {
    return generationFailure(NUMBERING_BOUNDARY_ERROR_CODES.VALIDATION_FAILED)
  }
  return requests
}

/**
 * 规则锁和周期锁只获取一次。三个幂等检查点与单号状态机相同，兼容同键重试、
 * 部分已派发补齐与规则禁用后的完整重放；混合重放只消耗缺失项的容量。
 */
export async function generateScopedBatch(
  transaction: Prisma.TransactionClient,
  inputs: readonly GenerateScopedNumberRequest[],
  randomSource: NumberingRandomSource,
): Promise<GenerateNumberInTransactionResult[]> {
  const requests = validateBatch(inputs)
  const asOf = await readNumberingTransactionTimestamp(transaction)
  const results = new Map<string, GenerateNumberInTransactionResult>()
  async function readReplays(): Promise<void> {
    const records = await readBatchIdempotentIssuances(transaction, requests)
    for (const request of requests) {
      const replay = resolveIdempotentRecord(records.get(key(request)) ?? null, request)
      if (replay !== null) {
        results.set(key(request), replay)
      }
    }
  }
  const orderedResults = () => requests.map(request => {
    const result = results.get(key(request))
    return result ?? generationFailure(NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR)
  })
  await readReplays()
  if (results.size === requests.length) {
    return orderedResults()
  }

  const rule = await readRuleForGeneration(transaction, requests[0].ruleCode)
  await readReplays()
  if (results.size === requests.length) {
    return orderedResults()
  }
  if (rule === null) {
    return generationFailure(NUMBERING_ERROR_CODES.RULE_NOT_FOUND)
  }
  if (rule.status !== 'ENABLED') {
    return generationFailure(NUMBERING_ERROR_CODES.RULE_UNAVAILABLE)
  }
  const snapshot = await readActiveGenerationSnapshot(transaction, rule.id)
  if (snapshot === null) {
    return generationFailure(NUMBERING_ERROR_CODES.RULE_UNAVAILABLE)
  }
  const sequence = findSequenceSegment(snapshot)
  const initialNextSequenceValue = sequence === undefined ? null : calculateSequenceState(sequence, 0n).nextSequenceValue
  if (sequence !== undefined && initialNextSequenceValue === null) {
    return generationFailure(NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID)
  }
  const periodKey = getNumberingPeriodKey(snapshot.config.resetPolicy, asOf)
  const state = await lockOrCreatePeriodState(transaction, { ruleId: rule.id, periodKey, initialNextSequenceValue })
  await readReplays()
  const pending = requests.filter(request => !results.has(key(request)))
  if (pending.length === 0) {
    return orderedResults()
  }

  const expectedNext = sequence === undefined ? null : calculateSequenceState(sequence, state.usedCount).nextSequenceValue
  if (state.nextSequenceValue !== expectedNext) {
    return generationFailure(NUMBERING_ERROR_CODES.OUTPUT_CONFLICT)
  }
  if (state.usedCount + BigInt(pending.length) > calculateRuleCapacity(snapshot.config)) {
    return generationFailure(NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED)
  }
  const base = {
    ruleId: rule.id,
    ruleVersionId: snapshot.versionId,
    periodKey,
    consumerCode: requests[0].consumerCode,
    issuedAt: asOf,
  }
  const ruleRevision = snapshot.revision
  function accept(rows: InsertedBatchIssuance[]): void {
    for (const row of rows) {
      results.set(Buffer.from(row.idempotencyKeyHash).toString('hex'), {
        issuanceId: row.id,
        number: row.generatedNumber,
        ruleCode: requests[0].ruleCode,
        ruleRevision,
        issuedAt: asOf.toISOString(),
        idempotentReplay: false,
      })
    }
  }

  if (sequence !== undefined) {
    const candidates = pending.map((request, index) => {
      const sequenceValue = calculateSequenceState(sequence, state.usedCount + BigInt(index)).nextSequenceValue
      if (sequenceValue === null) {
        return generationFailure(NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED)
      }
      return {
        ...base,
        idempotencyKeyHash: request.idempotencyKeyHash,
        requestFingerprintHash: request.requestFingerprintHash,
        generatedNumber: renderNumberingCandidate(snapshot.config, asOf, sequenceValue, randomSource),
        sequenceValue,
      }
    })
    accept(await insertSequenceIssuanceBatch(transaction, candidates))
  } else {
    // 每轮仅重试未占位项，每个请求最多 32 个候选；已成功项不重新取号。
    for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS && results.size < requests.length; attempt += 1) {
      const candidates = pending.filter(request => !results.has(key(request))).map(request => ({
        ...base,
        idempotencyKeyHash: request.idempotencyKeyHash,
        requestFingerprintHash: request.requestFingerprintHash,
        generatedNumber: renderNumberingCandidate(snapshot.config, asOf, null, randomSource),
        sequenceValue: null,
      }))
      accept(await tryInsertRandomIssuanceBatch(transaction, candidates))
    }
    if (results.size !== requests.length) {
      return generationFailure(NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED)
    }
  }

  const ordered = orderedResults()
  await advanceBatchPeriodState(transaction, state.id, pending.length,
    sequence === undefined ? null : calculateSequenceState(sequence, state.usedCount + BigInt(pending.length)).nextSequenceValue)
  return ordered
}
