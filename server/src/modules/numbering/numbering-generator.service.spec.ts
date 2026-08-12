import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Test } from '@nestjs/testing'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { readNumberingTransactionTimestamp } from './numbering-command.persistence'
import {
  advancePeriodState,
  insertSequenceIssuance,
  lockOrCreatePeriodState,
  readActiveGenerationSnapshot,
  readIdempotentIssuance,
  readRuleForGeneration,
  tryInsertRandomIssuance,
} from './numbering-generator.persistence'
import {
  type GenerateNumberResult,
  NumberingGeneratorService,
} from './numbering-generator.service'
import {
  type GenerateNumberRequest,
  type GenerateScopedNumberRequest,
  validateGenerateNumberRequest,
  validateGenerateScopedNumberRequest,
} from './numbering-internal-input'
import {
  NUMBERING_BOUNDARY_ERROR_CODES,
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
  type NumberingGenerationErrorCode,
} from './numbering.errors'
import { NumberingRuleConfigError } from './rule-engine'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn(),
}))

jest.mock('./numbering-command.persistence', () => ({
  readNumberingTransactionTimestamp: jest.fn(),
}))

jest.mock('./numbering-generator.persistence', () => ({
  advancePeriodState: jest.fn(),
  insertSequenceIssuance: jest.fn(),
  lockOrCreatePeriodState: jest.fn(),
  readActiveGenerationSnapshot: jest.fn(),
  readIdempotentIssuance: jest.fn(),
  readRuleForGeneration: jest.fn(),
  tryInsertRandomIssuance: jest.fn(),
}))

const RULE_ID = '10000000-0000-4000-8000-000000000001'
const VERSION_ID = '20000000-0000-4000-8000-000000000001'
const PERIOD_STATE_ID = '30000000-0000-4000-8000-000000000001'
const AS_OF = new Date('2026-08-02T15:59:59.123Z')
const REPLAY_ISSUED_AT = new Date('2026-07-31T02:03:04.567Z')
const MAIN_TRANSACTION = { name: 'main' } as unknown as Prisma.TransactionClient
const RECOVERY_TRANSACTION = {
  name: 'recovery',
} as unknown as Prisma.TransactionClient
const REQUEST = {
  ruleCode: 'SALES_ORDER',
  consumerCode: 'ORDER.CREATE',
  idempotencyKey: 'raw-key-never-persisted',
} as const
const VALIDATED_REQUEST = validateGenerateNumberRequest(REQUEST)
const SCOPED_REQUEST = {
  ...REQUEST,
  ruleCode: 'PRODUCT',
  consumerCode: 'PRODUCT.CREATE',
  requestFingerprint: 'ab'.repeat(32),
} as const
const VALIDATED_SCOPED_REQUEST = validateGenerateScopedNumberRequest(
  SCOPED_REQUEST,
)
const REPLAY_RECORD = {
  ruleCode: REQUEST.ruleCode,
  revision: 2,
  generatedNumber: 'SO00',
  issuedAt: REPLAY_ISSUED_AT,
  requestFingerprintHash: VALIDATED_REQUEST.requestFingerprintHash,
} as const

const mockedTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedTimestamp = jest.mocked(readNumberingTransactionTimestamp)
const mockedReadIdempotent = jest.mocked(readIdempotentIssuance)
const mockedReadRule = jest.mocked(readRuleForGeneration)
const mockedReadActive = jest.mocked(readActiveGenerationSnapshot)
const mockedLockState = jest.mocked(lockOrCreatePeriodState)
const mockedInsertSequence = jest.mocked(insertSequenceIssuance)
const mockedAdvanceState = jest.mocked(advancePeriodState)
const mockedTryRandom = jest.mocked(tryInsertRandomIssuance)

function createService(
  transactions: readonly Prisma.TransactionClient[] = [MAIN_TRANSACTION],
) {
  let transactionIndex = 0
  const transaction = jest.fn<Promise<unknown>, [
    callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
  ]>(async (callback) => {
    const selected = transactions[transactionIndex]
      ?? transactions[transactions.length - 1]
      ?? MAIN_TRANSACTION
    transactionIndex += 1
    return callback(selected)
  })
  const prisma = { $transaction: transaction } as unknown as PrismaService
  const randomSource = {
    nextInt: jest.fn<number, [number]>().mockReturnValue(0),
  }

  return {
    prisma,
    randomSource,
    service: new NumberingGeneratorService(prisma, randomSource),
    transaction,
  }
}

async function expectGenerationError(
  promise: Promise<unknown>,
  code: NumberingGenerationErrorCode,
): Promise<NumberingGenerationError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(NumberingGenerationError)
  if (!(thrown instanceof NumberingGenerationError)) {
    throw new Error('Expected NumberingGenerationError')
  }
  expect(thrown.code).toBe(code)
  expect(thrown).not.toBeInstanceOf(ApiException)
  return thrown
}

describe('NumberingGeneratorService', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTimeouts.mockResolvedValue(undefined)
    mockedTimestamp.mockResolvedValue(AS_OF)
    mockedReadIdempotent.mockResolvedValue(null)
    mockedReadRule.mockResolvedValue({
      id: RULE_ID,
      status: 'ENABLED',
      version: 1,
    })
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 3,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
        ],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: 1n,
      usedCount: 0n,
    })
    mockedInsertSequence.mockResolvedValue(undefined)
    mockedAdvanceState.mockResolvedValue(undefined)
    mockedTryRandom.mockResolvedValue(true)
  })

  it('keeps both internal service methods as one-input contracts', () => {
    const fixture = createService()
    const generate: (
      input: Readonly<GenerateNumberRequest>,
    ) => Promise<GenerateNumberResult> =
      fixture.service.generate.bind(fixture.service)

    expect(generate).toHaveLength(1)

    const generateScoped: (
      input: Readonly<GenerateScopedNumberRequest>,
    ) => Promise<GenerateNumberResult> =
      fixture.service.generateScoped.bind(fixture.service)

    expect(generateScoped).toHaveLength(1)
  })

  it('runs scoped requests through the same state machine with the supplied hash', async () => {
    const fixture = createService()

    await expect(fixture.service.generateScoped(SCOPED_REQUEST)).resolves
      .toMatchObject({
        number: 'SO01',
        ruleCode: 'PRODUCT',
        idempotentReplay: false,
      })

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(mockedReadIdempotent).toHaveBeenCalledTimes(3)
    expect(mockedInsertSequence).toHaveBeenCalledWith(
      MAIN_TRANSACTION,
      expect.objectContaining({
        idempotencyKeyHash: VALIDATED_SCOPED_REQUEST.idempotencyKeyHash,
        requestFingerprintHash:
          VALIDATED_SCOPED_REQUEST.requestFingerprintHash,
      }),
    )
  })

  it('replays the same scoped request and rejects a different scope', async () => {
    const fixture = createService()
    mockedReadIdempotent.mockResolvedValueOnce({
      ...REPLAY_RECORD,
      ruleCode: SCOPED_REQUEST.ruleCode,
      requestFingerprintHash:
        VALIDATED_SCOPED_REQUEST.requestFingerprintHash,
    })

    await expect(fixture.service.generateScoped(SCOPED_REQUEST)).resolves
      .toMatchObject({ number: REPLAY_RECORD.generatedNumber, idempotentReplay: true })

    jest.clearAllMocks()
    mockedTimeouts.mockResolvedValue(undefined)
    mockedTimestamp.mockResolvedValue(AS_OF)
    mockedReadIdempotent.mockResolvedValueOnce({
      ...REPLAY_RECORD,
      ruleCode: SCOPED_REQUEST.ruleCode,
      requestFingerprintHash: Buffer.alloc(32, 0xff),
    })
    const conflictFixture = createService()

    await expectGenerationError(
      conflictFixture.service.generateScoped(SCOPED_REQUEST),
      NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )
    expect(mockedReadRule).not.toHaveBeenCalled()
  })

  it('runs the frozen three-lookup lock order and advances only after issuance', async () => {
    const fixture = createService()

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: 'SO01',
      ruleCode: 'SALES_ORDER',
      ruleRevision: 3,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })

    expect(mockedReadIdempotent).toHaveBeenCalledTimes(3)
    const orderedCalls = [
      mockedTimeouts.mock.invocationCallOrder[0],
      mockedTimestamp.mock.invocationCallOrder[0],
      mockedReadIdempotent.mock.invocationCallOrder[0],
      mockedReadRule.mock.invocationCallOrder[0],
      mockedReadIdempotent.mock.invocationCallOrder[1],
      mockedReadActive.mock.invocationCallOrder[0],
      mockedLockState.mock.invocationCallOrder[0],
      mockedReadIdempotent.mock.invocationCallOrder[2],
      mockedInsertSequence.mock.invocationCallOrder[0],
      mockedAdvanceState.mock.invocationCallOrder[0],
    ]
    expect(orderedCalls).toEqual([...orderedCalls].sort((a, b) => a - b))
    expect(mockedTimestamp).toHaveBeenCalledTimes(1)
    expect(mockedLockState).toHaveBeenCalledWith(MAIN_TRANSACTION, {
      ruleId: RULE_ID,
      periodKey: 'ALL',
      initialNextSequenceValue: 1n,
    })
    expect(mockedInsertSequence).toHaveBeenCalledWith(
      MAIN_TRANSACTION,
      expect.objectContaining({
        issuedAt: AS_OF,
        generatedNumber: 'SO01',
        sequenceValue: 1n,
        idempotencyKeyHash: VALIDATED_REQUEST.idempotencyKeyHash,
        requestFingerprintHash: VALIDATED_REQUEST.requestFingerprintHash,
      }),
    )
    expect(mockedAdvanceState).toHaveBeenCalledWith(MAIN_TRANSACTION, {
      periodStateId: PERIOD_STATE_ID,
      nextSequenceValue: 2n,
    })
    const insertedInput = mockedInsertSequence.mock.calls[0]?.[1]
    expect(insertedInput).not.toHaveProperty('idempotencyKey')
    expect(Object.values(insertedInput ?? {})).not.toContain(
      REQUEST.idempotencyKey,
    )
  })

  it('rejects invalid input before opening a transaction', async () => {
    const fixture = createService()

    await expectGenerationError(fixture.service.generate({
      ...REQUEST,
      idempotencyKey: '',
    }), NUMBERING_BOUNDARY_ERROR_CODES.VALIDATION_FAILED)

    expect(fixture.transaction).not.toHaveBeenCalled()
  })

  it('returns the first historical result before reading current rule state', async () => {
    const fixture = createService()
    mockedReadIdempotent.mockResolvedValueOnce(REPLAY_RECORD)

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: REPLAY_RECORD.generatedNumber,
      ruleCode: REPLAY_RECORD.ruleCode,
      ruleRevision: REPLAY_RECORD.revision,
      issuedAt: REPLAY_ISSUED_AT.toISOString(),
      idempotentReplay: true,
    })

    expect(mockedReadIdempotent).toHaveBeenCalledTimes(1)
    expect(mockedReadRule).not.toHaveBeenCalled()
    expect(mockedLockState).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()
    expect(fixture.randomSource.nextInt).not.toHaveBeenCalled()
  })

  it('returns replay after the rule lock even when the current rule is disabled', async () => {
    const fixture = createService()
    mockedReadIdempotent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(REPLAY_RECORD)
    mockedReadRule.mockResolvedValue({
      id: RULE_ID,
      status: 'DISABLED',
      version: 8,
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: REPLAY_RECORD.generatedNumber,
      ruleCode: REPLAY_RECORD.ruleCode,
      ruleRevision: REPLAY_RECORD.revision,
      issuedAt: REPLAY_ISSUED_AT.toISOString(),
      idempotentReplay: true,
    })

    expect(mockedReadIdempotent.mock.invocationCallOrder[1])
      .toBeLessThan(mockedReadActive.mock.invocationCallOrder[0] ?? Infinity)
    expect(mockedReadActive).not.toHaveBeenCalled()
    expect(mockedLockState).not.toHaveBeenCalled()
  })

  it('returns the historical revision before loading a newly published ACTIVE version', async () => {
    const fixture = createService()
    mockedReadIdempotent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(REPLAY_RECORD)
    mockedReadActive.mockResolvedValue({
      versionId: '20000000-0000-4000-8000-000000000099',
      revision: 99,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'SEQUENCE', width: 3, startValue: '100', step: '1' },
        ],
      },
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: REPLAY_RECORD.generatedNumber,
      ruleCode: REPLAY_RECORD.ruleCode,
      ruleRevision: REPLAY_RECORD.revision,
      issuedAt: REPLAY_ISSUED_AT.toISOString(),
      idempotentReplay: true,
    })
    expect(mockedReadActive).not.toHaveBeenCalled()
    expect(mockedLockState).not.toHaveBeenCalled()
  })

  it('returns same-rule replay after waiting on the period-state lock', async () => {
    const fixture = createService()
    mockedReadIdempotent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(REPLAY_RECORD)

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: REPLAY_RECORD.generatedNumber,
      ruleCode: REPLAY_RECORD.ruleCode,
      ruleRevision: REPLAY_RECORD.revision,
      issuedAt: REPLAY_ISSUED_AT.toISOString(),
      idempotentReplay: true,
    })

    expect(mockedLockState.mock.invocationCallOrder[0])
      .toBeLessThan(mockedReadIdempotent.mock.invocationCallOrder[2])
    expect(mockedInsertSequence).not.toHaveBeenCalled()
    expect(mockedTryRandom).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()
    expect(fixture.randomSource.nextInt).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'different rule',
      record: { ...REPLAY_RECORD, ruleCode: 'PURCHASE_ORDER' },
    },
    {
      label: 'different request fingerprint',
      record: {
        ...REPLAY_RECORD,
        requestFingerprintHash: Buffer.alloc(32, 0xff),
      },
    },
  ])('rejects an idempotency record with $label', async ({ record }) => {
    const fixture = createService()
    mockedReadIdempotent.mockResolvedValueOnce(record)

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )

    expect(mockedReadRule).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('distinguishes missing and currently unavailable rules after lookup #2', async () => {
    const missingFixture = createService()
    mockedReadRule.mockResolvedValueOnce(null)

    await expectGenerationError(
      missingFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.RULE_NOT_FOUND,
    )
    expect(mockedReadIdempotent).toHaveBeenCalledTimes(2)

    jest.clearAllMocks()
    mockedTimeouts.mockResolvedValue(undefined)
    mockedTimestamp.mockResolvedValue(AS_OF)
    mockedReadIdempotent.mockResolvedValue(null)
    mockedReadRule.mockResolvedValue({
      id: RULE_ID,
      status: 'ENABLED',
      version: 1,
    })
    mockedReadActive.mockResolvedValue(null)
    const unavailableFixture = createService()

    await expectGenerationError(
      unavailableFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.RULE_UNAVAILABLE,
    )
    expect(mockedReadActive).toHaveBeenCalledTimes(1)
    expect(mockedLockState).not.toHaveBeenCalled()
  })

  it('reuses one database time for Shanghai date, period key, issuedAt, and response', async () => {
    const fixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 5,
      config: {
        resetPolicy: 'DAILY',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'DATE', format: 'YYYYMMDD' },
          { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
        ],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: '20260802',
      nextSequenceValue: 1n,
      usedCount: 0n,
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: 'SO2026080201',
      ruleCode: REQUEST.ruleCode,
      ruleRevision: 5,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })

    expect(mockedTimestamp).toHaveBeenCalledTimes(1)
    expect(mockedLockState).toHaveBeenCalledWith(MAIN_TRANSACTION, {
      ruleId: RULE_ID,
      periodKey: '20260802',
      initialNextSequenceValue: 1n,
    })
    const inserted = mockedInsertSequence.mock.calls[0]?.[1]
    expect(inserted?.issuedAt).toBe(AS_OF)
    expect(inserted?.periodKey).toBe('20260802')
  })

  it('issues the last sequence value and explicitly stores a null next value', async () => {
    const fixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 9,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'SEQUENCE', width: 1, startValue: '9', step: '1' },
        ],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: 9n,
      usedCount: 0n,
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: 'SO9',
      ruleCode: REQUEST.ruleCode,
      ruleRevision: 9,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })
    expect(mockedAdvanceState).toHaveBeenCalledWith(MAIN_TRANSACTION, {
      periodStateId: PERIOD_STATE_ID,
      nextSequenceValue: null,
    })
  })

  it('keeps used and next sequence values as bigint above Number.MAX_SAFE_INTEGER', async () => {
    const fixture = createService()
    const usedCount = 9_007_199_254_740_993n
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 10,
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'SEQUENCE',
          width: 18,
          startValue: '0',
          step: '1',
        }],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: usedCount,
      usedCount,
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: '009007199254740993',
      ruleCode: REQUEST.ruleCode,
      ruleRevision: 10,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })
    expect(mockedInsertSequence.mock.calls[0]?.[1].sequenceValue)
      .toBe(usedCount)
    expect(mockedAdvanceState).toHaveBeenCalledWith(MAIN_TRANSACTION, {
      periodStateId: PERIOD_STATE_ID,
      nextSequenceValue: 9_007_199_254_740_994n,
    })
  })

  it('rejects exhausted capacity and a damaged sequence cursor before insert', async () => {
    const exhaustedFixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 9,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'SEQUENCE', width: 1, startValue: '9', step: '1' },
        ],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: null,
      usedCount: 1n,
    })

    await expectGenerationError(
      exhaustedFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED,
    )
    expect(mockedInsertSequence).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()

    jest.clearAllMocks()
    mockedTimeouts.mockResolvedValue(undefined)
    mockedTimestamp.mockResolvedValue(AS_OF)
    mockedReadIdempotent.mockResolvedValue(null)
    mockedReadRule.mockResolvedValue({
      id: RULE_ID,
      status: 'ENABLED',
      version: 1,
    })
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 3,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
        ],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: 2n,
      usedCount: 0n,
    })
    const damagedFixture = createService()

    await expectGenerationError(
      damagedFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
    )
    expect(mockedInsertSequence).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('uses the normal issuance path for a sequence plus random mixed rule', async () => {
    const fixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 4,
      config: {
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
          {
            type: 'RANDOM',
            letterLength: 1,
            digitLength: 1,
            mode: 'LETTERS_THEN_DIGITS',
          },
        ],
      },
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: 'SO01A0',
      ruleCode: REQUEST.ruleCode,
      ruleRevision: 4,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })
    expect(mockedInsertSequence).toHaveBeenCalledTimes(1)
    expect(mockedTryRandom).not.toHaveBeenCalled()
    expect(fixture.randomSource.nextInt).toHaveBeenCalledTimes(2)
  })

  it('accepts a pure-random candidate after 31 atomic collisions', async () => {
    const fixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 6,
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'RANDOM',
          letterLength: 0,
          digitLength: 1,
          mode: 'LETTERS_THEN_DIGITS',
        }],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: null,
      usedCount: 0n,
    })
    for (let attempt = 1; attempt <= 31; attempt += 1) {
      mockedTryRandom.mockResolvedValueOnce(false)
    }
    mockedTryRandom.mockResolvedValueOnce(true)

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: '0',
      ruleCode: REQUEST.ruleCode,
      ruleRevision: 6,
      issuedAt: AS_OF.toISOString(),
      idempotentReplay: false,
    })

    expect(mockedTryRandom).toHaveBeenCalledTimes(32)
    expect(mockedInsertSequence).not.toHaveBeenCalled()
    expect(mockedAdvanceState).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceState.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockedTryRandom.mock.invocationCallOrder[31])
  })

  it('rolls back pure-random exhaustion without advancing period state', async () => {
    const fixture = createService()
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 6,
      config: {
        resetPolicy: 'NEVER',
        segments: [{
          type: 'RANDOM',
          letterLength: 0,
          digitLength: 1,
          mode: 'LETTERS_THEN_DIGITS',
        }],
      },
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: null,
      usedCount: 0n,
    })
    mockedTryRandom.mockResolvedValue(false)

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED,
    )

    expect(mockedTryRandom).toHaveBeenCalledTimes(32)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('rejects pure-random capacity exhaustion and non-null sequence state', async () => {
    const randomConfig = {
      resetPolicy: 'NEVER' as const,
      segments: [{
        type: 'RANDOM' as const,
        letterLength: 0,
        digitLength: 1,
        mode: 'LETTERS_THEN_DIGITS' as const,
      }],
    }
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 6,
      config: randomConfig,
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: null,
      usedCount: 10n,
    })
    const exhaustedFixture = createService()

    await expectGenerationError(
      exhaustedFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED,
    )

    jest.clearAllMocks()
    mockedTimeouts.mockResolvedValue(undefined)
    mockedTimestamp.mockResolvedValue(AS_OF)
    mockedReadIdempotent.mockResolvedValue(null)
    mockedReadRule.mockResolvedValue({
      id: RULE_ID,
      status: 'ENABLED',
      version: 1,
    })
    mockedReadActive.mockResolvedValue({
      versionId: VERSION_ID,
      revision: 6,
      config: randomConfig,
    })
    mockedLockState.mockResolvedValue({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: 'ALL',
      nextSequenceValue: 1n,
      usedCount: 0n,
    })
    const damagedFixture = createService()

    await expectGenerationError(
      damagedFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
    )
    expect(mockedTryRandom).not.toHaveBeenCalled()
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('maps damaged config, transient database codes, and unknown errors safely', async () => {
    const configFixture = createService()
    mockedReadActive.mockRejectedValueOnce(new NumberingRuleConfigError([
      { path: 'timezone', message: 'secret damaged value' },
    ]))
    await expectGenerationError(
      configFixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID,
    )

    for (const code of ['P2034', '40001', '40P01', '55P03', '57014']) {
      jest.clearAllMocks()
      mockedTimeouts.mockRejectedValueOnce({ code })
      const transientFixture = createService()
      await expectGenerationError(
        transientFixture.service.generate(REQUEST),
        NUMBERING_ERROR_CODES.RULE_STATE_CHANGED,
      )
    }

    jest.clearAllMocks()
    mockedTimeouts.mockRejectedValueOnce(new Error(
      'secret SQL connection and raw key',
    ))
    const unknownFixture = createService()
    const unknown = await expectGenerationError(
      unknownFixture.service.generate(REQUEST),
      NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR,
    )
    expect(unknown.message).not.toMatch(/secret|SQL|raw key/iu)
  })

  it('maps sequence output uniqueness structurally and never advances after insert failure', async () => {
    const fixture = createService()
    mockedInsertSequence.mockRejectedValueOnce({
      code: '23505',
      constraint: 'numbering_issuances_rule_id_generated_number_key',
      message: 'secret generated value',
    })

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.OUTPUT_CONFLICT,
    )
    expect(mockedInsertSequence).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('recovers an idempotency unique race in one new read transaction', async () => {
    const fixture = createService([MAIN_TRANSACTION, RECOVERY_TRANSACTION])
    mockedReadIdempotent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(REPLAY_RECORD)
    mockedInsertSequence.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['consumerCode', 'idempotencyKeyHash'] },
      message: 'secret original key',
    })

    await expect(fixture.service.generate(REQUEST)).resolves.toEqual({
      number: REPLAY_RECORD.generatedNumber,
      ruleCode: REPLAY_RECORD.ruleCode,
      ruleRevision: REPLAY_RECORD.revision,
      issuedAt: REPLAY_ISSUED_AT.toISOString(),
      idempotentReplay: true,
    })

    expect(fixture.transaction).toHaveBeenCalledTimes(2)
    expect(mockedTimeouts).toHaveBeenCalledTimes(2)
    expect(mockedTimestamp).toHaveBeenCalledTimes(1)
    expect(mockedReadIdempotent).toHaveBeenCalledTimes(4)
    expect(mockedReadIdempotent.mock.calls[3]?.[0]).toBe(
      RECOVERY_TRANSACTION,
    )
    expect(mockedTimeouts.mock.invocationCallOrder[1])
      .toBeLessThan(mockedReadIdempotent.mock.invocationCallOrder[3])
    expect(mockedReadRule).toHaveBeenCalledTimes(1)
    expect(mockedInsertSequence).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('returns conflict when unique-race recovery finds the key under another rule', async () => {
    const fixture = createService([MAIN_TRANSACTION, RECOVERY_TRANSACTION])
    mockedReadIdempotent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...REPLAY_RECORD,
        ruleCode: 'PURCHASE_ORDER',
      })
    mockedInsertSequence.mockRejectedValueOnce({
      code: '23505',
      constraint:
        'numbering_issuances_consumer_code_idempotency_key_hash_key',
    })

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )

    expect(fixture.transaction).toHaveBeenCalledTimes(2)
    expect(mockedReadRule).toHaveBeenCalledTimes(1)
    expect(mockedInsertSequence).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('fails safely without regenerating when unique-race recovery finds no ledger row', async () => {
    const fixture = createService([MAIN_TRANSACTION, RECOVERY_TRANSACTION])
    mockedInsertSequence.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['consumer_code', 'idempotency_key_hash'] },
    })

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR,
    )

    expect(fixture.transaction).toHaveBeenCalledTimes(2)
    expect(mockedReadRule).toHaveBeenCalledTimes(1)
    expect(mockedInsertSequence).toHaveBeenCalledTimes(1)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('does not identify a race from exception message text', async () => {
    const fixture = createService([MAIN_TRANSACTION, RECOVERY_TRANSACTION])
    mockedInsertSequence.mockRejectedValueOnce(new Error(
      'P2002 numbering_issuances_consumer_code_idempotency_key_hash_key secret',
    ))

    await expectGenerationError(
      fixture.service.generate(REQUEST),
      NUMBERING_BOUNDARY_ERROR_CODES.INTERNAL_ERROR,
    )

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(mockedReadIdempotent).toHaveBeenCalledTimes(3)
    expect(mockedAdvanceState).not.toHaveBeenCalled()
  })

  it('boots in a real Nest container without an Object random-source provider', async () => {
    const fixture = createService()
    const module = await Test.createTestingModule({
      providers: [
        NumberingGeneratorService,
        { provide: PrismaService, useValue: fixture.prisma },
      ],
    }).compile()

    expect(module.get(NumberingGeneratorService))
      .toBeInstanceOf(NumberingGeneratorService)
    await module.close()
  })

  it('keeps logging, public exceptions, and the raw key outside source boundaries', () => {
    const source = readFileSync(join(
      __dirname,
      'numbering-generator.service.ts',
    ), 'utf8')

    expect(source).not.toMatch(/\bAudit(?:Service)?\b/u)
    expect(source).not.toMatch(/\bLogger\b|console\./u)
    expect(source).not.toContain('ApiException')
    expect(source).not.toMatch(/\.idempotencyKey\b/u)
    expect(source).toContain('@Inject(NUMBERING_RANDOM_SOURCE)')
  })
})
