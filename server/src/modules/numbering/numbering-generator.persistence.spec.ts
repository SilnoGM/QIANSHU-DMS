import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Prisma } from '../../generated/prisma/client'
import { NumberingRuleConfigError } from './rule-engine'
import {
  advancePeriodState,
  insertSequenceIssuance,
  lockOrCreatePeriodState,
  readActiveGenerationSnapshot,
  readIdempotentIssuance,
  readRuleForGeneration,
  tryInsertRandomIssuance,
} from './numbering-generator.persistence'

const RULE_ID = '10000000-0000-4000-8000-000000000001'
const VERSION_ID = '20000000-0000-4000-8000-000000000001'
const PERIOD_STATE_ID = '30000000-0000-4000-8000-000000000001'
const ISSUANCE_ID = '40000000-0000-4000-8000-000000000001'
const RULE_CODE = 'SALES_ORDER'
const CONSUMER_CODE = 'ORDER.CREATE'
const PERIOD_KEY = '20260802'
const ISSUED_AT = new Date('2026-08-02T04:05:06.789Z')
const IDEMPOTENCY_KEY_HASH = Buffer.alloc(32, 0x11)
const REQUEST_FINGERPRINT_HASH = Buffer.alloc(32, 0x22)

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function requireSql(value: unknown): SqlShape {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return value as unknown as SqlShape
}

function createTransactionFixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue([])
  const executeRaw = jest.fn<Promise<number>, [unknown]>()
    .mockResolvedValue(1)
  const versionFindFirst = jest.fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue(null)
  const issuanceCreate = jest.fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ id: ISSUANCE_ID })
  const periodStateUpdate = jest.fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ id: PERIOD_STATE_ID })

  return {
    mocks: {
      executeRaw,
      issuanceCreate,
      periodStateUpdate,
      queryRaw,
      versionFindFirst,
    },
    transaction: {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      numberingIssuance: { create: issuanceCreate },
      numberingPeriodState: { update: periodStateUpdate },
      numberingRuleVersion: { findFirst: versionFindFirst },
    } as unknown as Prisma.TransactionClient,
  }
}

function createValidActiveSnapshot() {
  return {
    id: VERSION_ID,
    revision: 7,
    resetPolicy: 'DAILY',
    timezone: 'Asia/Shanghai',
    segments: [
      {
        position: 0,
        type: 'FIXED',
        fixedValue: 'SO',
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        position: 1,
        type: 'DATE',
        fixedValue: null,
        dateFormat: 'YYYYMMDD',
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        position: 2,
        type: 'SEPARATOR',
        fixedValue: null,
        dateFormat: null,
        separatorValue: '-',
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        position: 3,
        type: 'SEQUENCE',
        fixedValue: null,
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: 18,
        sequenceStartValue: 9_007_199_254_740_993n,
        sequenceStep: 2n,
        randomLetterLength: null,
        randomDigitLength: null,
        randomMode: null,
      },
      {
        position: 4,
        type: 'RANDOM',
        fixedValue: null,
        dateFormat: null,
        separatorValue: null,
        sequenceWidth: null,
        sequenceStartValue: null,
        sequenceStep: null,
        randomLetterLength: 2,
        randomDigitLength: 3,
        randomMode: 'SHUFFLED',
      },
    ],
  }
}

const SEQUENCE_ISSUANCE_INPUT = {
  ruleId: RULE_ID,
  ruleVersionId: VERSION_ID,
  periodKey: PERIOD_KEY,
  generatedNumber: 'SO20260802-009007199254740993AB123',
  sequenceValue: 9_007_199_254_740_993n,
  consumerCode: CONSUMER_CODE,
  idempotencyKeyHash: IDEMPOTENCY_KEY_HASH,
  requestFingerprintHash: REQUEST_FINGERPRINT_HASH,
  issuedAt: ISSUED_AT,
} as const

const RANDOM_ISSUANCE_INPUT = {
  ...SEQUENCE_ISSUANCE_INPUT,
  generatedNumber: 'SO20260802-AB123',
  sequenceValue: null,
} as const

describe('numbering generator persistence', () => {
  it('reads an internal idempotency record by hashes without selecting the idempotency hash', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.queryRaw.mockResolvedValueOnce([{
      issuanceId: ISSUANCE_ID,
      ruleCode: RULE_CODE,
      revision: 7,
      generatedNumber: SEQUENCE_ISSUANCE_INPUT.generatedNumber,
      issuedAt: ISSUED_AT,
      requestFingerprintHash: REQUEST_FINGERPRINT_HASH,
    }])

    const result = await readIdempotentIssuance(
      fixture.transaction,
      CONSUMER_CODE,
      IDEMPOTENCY_KEY_HASH,
    )

    expect(result).toEqual({
      issuanceId: ISSUANCE_ID,
      ruleCode: RULE_CODE,
      revision: 7,
      generatedNumber: SEQUENCE_ISSUANCE_INPUT.generatedNumber,
      issuedAt: ISSUED_AT,
      requestFingerprintHash: REQUEST_FINGERPRINT_HASH,
    })
    expect(result).not.toHaveProperty('idempotencyKeyHash')

    const sql = requireSql(fixture.mocks.queryRaw.mock.calls[0]?.[0])
    const text = sql.strings.join('?')
    expect(text).toContain('FROM "numbering_issuances"')
    expect(text).toContain('i."id" AS "issuanceId"')
    expect(text).toContain('"numbering_rules"')
    expect(text).toContain('"numbering_rule_versions"')
    expect(text).not.toMatch(/SELECT[\s\S]*idempotency_key_hash[\s\S]*FROM/iu)
    expect(text).not.toContain('raw-idempotency-secret')
    expect(sql.values).toEqual([CONSUMER_CODE, IDEMPOTENCY_KEY_HASH])
  })

  it('locks only the rule row for generation using a parameterized FOR SHARE query', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.queryRaw.mockResolvedValueOnce([{
      id: RULE_ID,
      status: 'ENABLED',
      version: 4,
    }])

    await expect(readRuleForGeneration(
      fixture.transaction,
      RULE_CODE,
    )).resolves.toEqual({ id: RULE_ID, status: 'ENABLED', version: 4 })

    const sql = requireSql(fixture.mocks.queryRaw.mock.calls[0]?.[0])
    const text = sql.strings.join('?')
    expect(text).toContain('FROM "numbering_rules"')
    expect(text).toContain('FOR SHARE')
    expect(text).not.toContain('JOIN')
    expect(text).not.toContain('FOR UPDATE')
    expect(text).not.toContain(RULE_CODE)
    expect(sql.values).toEqual([RULE_CODE])
  })

  it('rebuilds the unique ACTIVE snapshot in position order with exact bigint strings', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.versionFindFirst.mockResolvedValueOnce(
      createValidActiveSnapshot(),
    )

    await expect(readActiveGenerationSnapshot(
      fixture.transaction,
      RULE_ID,
    )).resolves.toEqual({
      versionId: VERSION_ID,
      revision: 7,
      config: {
        resetPolicy: 'DAILY',
        segments: [
          { type: 'FIXED', value: 'SO' },
          { type: 'DATE', format: 'YYYYMMDD' },
          { type: 'SEPARATOR', value: '-' },
          {
            type: 'SEQUENCE',
            width: 18,
            startValue: '9007199254740993',
            step: '2',
          },
          {
            type: 'RANDOM',
            letterLength: 2,
            digitLength: 3,
            mode: 'SHUFFLED',
          },
        ],
      },
    })

    expect(fixture.mocks.versionFindFirst).toHaveBeenCalledWith({
      where: { ruleId: RULE_ID, status: 'ACTIVE' },
      select: {
        id: true,
        revision: true,
        resetPolicy: true,
        timezone: true,
        segments: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            position: true,
            type: true,
            fixedValue: true,
            dateFormat: true,
            separatorValue: true,
            sequenceWidth: true,
            sequenceStartValue: true,
            sequenceStep: true,
            randomLetterLength: true,
            randomDigitLength: true,
            randomMode: true,
          },
        },
      },
    })
  })

  it.each([
    [
      'non-Asia/Shanghai timezone',
      { ...createValidActiveSnapshot(), timezone: 'UTC' },
    ],
    [
      'non-contiguous positions',
      {
        ...createValidActiveSnapshot(),
        segments: createValidActiveSnapshot().segments.map((segment, index) =>
          index === 1 ? { ...segment, position: 9 } : segment),
      },
    ],
    [
      'cross-type columns',
      {
        ...createValidActiveSnapshot(),
        segments: createValidActiveSnapshot().segments.map((segment, index) =>
          index === 0 ? { ...segment, sequenceWidth: 6 } : segment),
      },
    ],
    [
      'invalid canonical values',
      {
        ...createValidActiveSnapshot(),
        segments: createValidActiveSnapshot().segments.map((segment, index) =>
          index === 3 ? { ...segment, sequenceStep: 0n } : segment),
      },
    ],
  ])('fails closed for a damaged ACTIVE snapshot: %s', async (_, snapshot) => {
    const fixture = createTransactionFixture()
    fixture.mocks.versionFindFirst.mockResolvedValueOnce(snapshot)

    await expect(readActiveGenerationSnapshot(
      fixture.transaction,
      RULE_ID,
    )).rejects.toBeInstanceOf(NumberingRuleConfigError)
  })

  it('returns null when no ACTIVE snapshot exists', async () => {
    const fixture = createTransactionFixture()

    await expect(readActiveGenerationSnapshot(
      fixture.transaction,
      RULE_ID,
    )).resolves.toBeNull()
  })

  it('creates a missing period state without mutating an existing row, then locks it', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.queryRaw.mockResolvedValueOnce([{
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: PERIOD_KEY,
      nextSequenceValue: '9007199254740993',
      usedCount: '9007199254740995',
    }])

    await expect(lockOrCreatePeriodState(fixture.transaction, {
      ruleId: RULE_ID,
      periodKey: PERIOD_KEY,
      initialNextSequenceValue: 9_007_199_254_740_993n,
    })).resolves.toEqual({
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: PERIOD_KEY,
      nextSequenceValue: 9_007_199_254_740_993n,
      usedCount: 9_007_199_254_740_995n,
    })

    expect(
      fixture.mocks.executeRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.mocks.queryRaw.mock.invocationCallOrder[0])

    const insertSql = requireSql(fixture.mocks.executeRaw.mock.calls[0]?.[0])
    const insertText = insertSql.strings.join('?')
    expect(insertText).toContain('INSERT INTO "numbering_period_states"')
    expect(insertText).toMatch(
      /ON CONFLICT\s*\(\s*"rule_id"\s*,\s*"period_key"\s*\)\s*DO NOTHING/iu,
    )
    expect(insertText).not.toContain('DO UPDATE')
    expect(insertSql.values).toEqual([
      RULE_ID,
      PERIOD_KEY,
      9_007_199_254_740_993n,
    ])

    const lockSql = requireSql(fixture.mocks.queryRaw.mock.calls[0]?.[0])
    expect(lockSql.strings.join('?')).toContain('FOR UPDATE')
    expect(lockSql.values).toEqual([RULE_ID, PERIOD_KEY])
    expect(fixture.mocks.periodStateUpdate).not.toHaveBeenCalled()
  })

  it('fails closed when a locked period state contains a non-decimal bigint', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.queryRaw.mockResolvedValueOnce([{
      id: PERIOD_STATE_ID,
      ruleId: RULE_ID,
      periodKey: PERIOD_KEY,
      nextSequenceValue: '1.5',
      usedCount: '0',
    }])

    await expect(lockOrCreatePeriodState(fixture.transaction, {
      ruleId: RULE_ID,
      periodKey: PERIOD_KEY,
      initialNextSequenceValue: 1n,
    })).rejects.toThrow('Numbering period state invariant violated')
  })

  it('normally inserts sequence or mixed issuance with the supplied database time', async () => {
    const fixture = createTransactionFixture()

    await expect(insertSequenceIssuance(
      fixture.transaction,
      SEQUENCE_ISSUANCE_INPUT,
    )).resolves.toBe(ISSUANCE_ID)

    expect(fixture.mocks.issuanceCreate).toHaveBeenCalledWith({
      data: {
        ...SEQUENCE_ISSUANCE_INPUT,
        idempotencyKeyHash: Uint8Array.from(IDEMPOTENCY_KEY_HASH),
        requestFingerprintHash: Uint8Array.from(REQUEST_FINGERPRINT_HASH),
      },
      select: { id: true },
    })
    expect(fixture.mocks.periodStateUpdate).not.toHaveBeenCalled()
  })

  it('claims a pure-random output with only the generated-number conflict target', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.queryRaw.mockResolvedValueOnce([{ id: ISSUANCE_ID }])

    await expect(tryInsertRandomIssuance(
      fixture.transaction,
      RANDOM_ISSUANCE_INPUT,
    )).resolves.toBe(ISSUANCE_ID)

    const sql = requireSql(fixture.mocks.queryRaw.mock.calls[0]?.[0])
    const text = sql.strings.join('?')
    expect(text).toContain('INSERT INTO "numbering_issuances"')
    expect(text).toMatch(
      /ON CONFLICT\s*\(\s*"rule_id"\s*,\s*"generated_number"\s*\)\s*DO NOTHING/iu,
    )
    expect(text).not.toMatch(
      /ON CONFLICT\s*\(\s*"consumer_code"/iu,
    )
    expect(text).not.toMatch(/ON CONFLICT\s+DO NOTHING/iu)
    expect(text).toContain('RETURNING "id"')
    expect(text).not.toContain(RANDOM_ISSUANCE_INPUT.generatedNumber)
    expect(sql.values).toEqual([
      RULE_ID,
      VERSION_ID,
      PERIOD_KEY,
      RANDOM_ISSUANCE_INPUT.generatedNumber,
      null,
      CONSUMER_CODE,
      IDEMPOTENCY_KEY_HASH,
      REQUEST_FINGERPRINT_HASH,
      ISSUED_AT,
    ])
    expect(fixture.mocks.periodStateUpdate).not.toHaveBeenCalled()
  })

  it('returns false only for a pure-random generated-number collision', async () => {
    const fixture = createTransactionFixture()

    await expect(tryInsertRandomIssuance(
      fixture.transaction,
      RANDOM_ISSUANCE_INPUT,
    )).resolves.toBeNull()
  })

  it('does not swallow database errors from other pure-random unique constraints', async () => {
    const fixture = createTransactionFixture()
    const databaseError = new Error('unique constraint')
    fixture.mocks.queryRaw.mockRejectedValueOnce(databaseError)

    await expect(tryInsertRandomIssuance(
      fixture.transaction,
      RANDOM_ISSUANCE_INPUT,
    )).rejects.toBe(databaseError)
  })

  it.each([
    9_007_199_254_740_995n,
    null,
  ])('advances usage once and explicitly stores nextSequenceValue=%s', async (
    nextSequenceValue,
  ) => {
    const fixture = createTransactionFixture()

    await expect(advancePeriodState(fixture.transaction, {
      periodStateId: PERIOD_STATE_ID,
      nextSequenceValue,
    })).resolves.toBeUndefined()

    expect(fixture.mocks.periodStateUpdate).toHaveBeenCalledWith({
      where: { id: PERIOD_STATE_ID },
      data: {
        usedCount: { increment: 1n },
        nextSequenceValue,
      },
      select: { id: true },
    })
  })

  it('contains no unsafe SQL, raw idempotency key boundary, or Audit dependency', () => {
    const source = readFileSync(join(
      __dirname,
      'numbering-generator.persistence.ts',
    ), 'utf8')

    expect(source).not.toContain('$queryRawUnsafe')
    expect(source).not.toContain('$executeRawUnsafe')
    expect(source).not.toMatch(/\bidempotencyKey\b/u)
    expect(source).not.toMatch(/\bAudit(?:Service)?\b/u)
  })
})
