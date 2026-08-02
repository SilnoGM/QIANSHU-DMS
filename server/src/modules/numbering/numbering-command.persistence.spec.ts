import type { Prisma } from '../../generated/prisma/client'
import {
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
} from '../../generated/prisma/enums'
import type { NumberingRuleConfig } from './rule-engine'
import {
  createNumberingDraftVersion,
  createNumberingRuleRecord,
  hasNumberingIssuance,
  readNumberingRuleForClone,
  readNumberingRuleForUpdate,
  readNumberingRuleVersionSnapshots,
  readNumberingTransactionTimestamp,
  replaceNumberingDraftVersion,
  updateNumberingRuleRecord,
} from './numbering-command.persistence'

const RULE_ID = '20000000-0000-4000-8000-000000000001'
const VERSION_ID = '30000000-0000-4000-8000-000000000001'
const AS_OF = new Date('2026-08-02T04:00:00.000Z')
const FINGERPRINT = 'a'.repeat(64)

const CONFIG: NumberingRuleConfig = {
  resetPolicy: 'DAILY',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 6, startValue: '1', step: '2' },
    {
      type: 'RANDOM',
      letterLength: 2,
      digitLength: 3,
      mode: 'SHUFFLED',
    },
  ],
}

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
  const numberingRuleCreate = jest.fn().mockResolvedValue({ id: RULE_ID })
  const numberingRuleUpdate = jest.fn().mockResolvedValue({ id: RULE_ID })
  const numberingRuleVersionCreate = jest.fn()
    .mockResolvedValue({ id: VERSION_ID })
  const numberingRuleVersionUpdate = jest.fn()
    .mockResolvedValue({ id: VERSION_ID })
  const numberingRuleVersionFindMany = jest.fn().mockResolvedValue([])
  const numberingRuleSegmentCreateMany = jest.fn()
    .mockResolvedValue({ count: CONFIG.segments.length })
  const numberingRuleSegmentDeleteMany = jest.fn()
    .mockResolvedValue({ count: CONFIG.segments.length })
  const numberingIssuanceFindFirst = jest.fn().mockResolvedValue(null)

  return {
    mocks: {
      numberingIssuanceFindFirst,
      numberingRuleCreate,
      numberingRuleSegmentCreateMany,
      numberingRuleSegmentDeleteMany,
      numberingRuleUpdate,
      numberingRuleVersionCreate,
      numberingRuleVersionFindMany,
      numberingRuleVersionUpdate,
      queryRaw,
    },
    transaction: {
      $queryRaw: queryRaw,
      numberingIssuance: { findFirst: numberingIssuanceFindFirst },
      numberingRule: {
        create: numberingRuleCreate,
        update: numberingRuleUpdate,
      },
      numberingRuleSegment: {
        createMany: numberingRuleSegmentCreateMany,
        deleteMany: numberingRuleSegmentDeleteMany,
      },
      numberingRuleVersion: {
        create: numberingRuleVersionCreate,
        findMany: numberingRuleVersionFindMany,
        update: numberingRuleVersionUpdate,
      },
    } as unknown as Prisma.TransactionClient,
  }
}

describe('numbering command persistence', () => {
  it('reads the transaction timestamp and uses the required rule lock modes', async () => {
    const timestampFixture = createTransactionFixture()
    timestampFixture.mocks.queryRaw.mockResolvedValueOnce([{ asOf: AS_OF }])

    await expect(readNumberingTransactionTimestamp(
      timestampFixture.transaction,
    )).resolves.toBe(AS_OF)

    const timestampSql = requireSql(
      timestampFixture.mocks.queryRaw.mock.calls[0]?.[0],
    )
    expect(timestampSql.strings.join('')).toContain('transaction_timestamp()')

    for (const [reader, expectedLock] of [
      [readNumberingRuleForUpdate, 'FOR UPDATE'],
      [readNumberingRuleForClone, 'FOR SHARE'],
    ] as const) {
      const fixture = createTransactionFixture()

      await expect(reader(fixture.transaction, RULE_ID)).resolves.toBeNull()

      const sql = requireSql(fixture.mocks.queryRaw.mock.calls[0]?.[0])
      expect(sql.strings.join('')).toContain(expectedLock)
      expect(sql.strings.join('')).not.toContain(RULE_ID)
      expect(sql.values).toEqual([RULE_ID])
    }
  })

  it('creates an explicit DRAFT rule at optimistic version 1', async () => {
    const fixture = createTransactionFixture()

    await expect(createNumberingRuleRecord(fixture.transaction, {
      ruleCode: 'SALES_ORDER',
      name: '销售订单',
      description: null,
    })).resolves.toEqual({ id: RULE_ID })

    expect(fixture.mocks.numberingRuleCreate).toHaveBeenCalledWith({
      data: {
        ruleCode: 'SALES_ORDER',
        name: '销售订单',
        description: null,
        status: NumberingRuleStatus.DRAFT,
        version: 1,
      },
      select: { id: true },
    })
  })

  it('creates revision 1 and maps every discriminated segment column', async () => {
    const fixture = createTransactionFixture()

    await expect(createNumberingDraftVersion(fixture.transaction, {
      ruleId: RULE_ID,
      revision: 1,
      config: CONFIG,
      configFingerprint: FINGERPRINT,
    })).resolves.toEqual({ id: VERSION_ID })

    expect(fixture.mocks.numberingRuleVersionCreate).toHaveBeenCalledWith({
      data: {
        ruleId: RULE_ID,
        revision: 1,
        status: NumberingRuleVersionStatus.DRAFT,
        resetPolicy: 'DAILY',
        timezone: 'Asia/Shanghai',
        configFingerprint: FINGERPRINT,
      },
      select: { id: true },
    })
    expect(fixture.mocks.numberingRuleSegmentCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          versionId: VERSION_ID,
          position: 0,
          type: 'FIXED',
          fixedValue: 'SO',
        }),
        expect.objectContaining({
          versionId: VERSION_ID,
          position: 1,
          type: 'DATE',
          dateFormat: 'YYYYMMDD',
        }),
        expect.objectContaining({
          versionId: VERSION_ID,
          position: 2,
          type: 'SEPARATOR',
          separatorValue: '-',
        }),
        expect.objectContaining({
          versionId: VERSION_ID,
          position: 3,
          type: 'SEQUENCE',
          sequenceWidth: 6,
          sequenceStartValue: 1n,
          sequenceStep: 2n,
        }),
        expect.objectContaining({
          versionId: VERSION_ID,
          position: 4,
          type: 'RANDOM',
          randomLetterLength: 2,
          randomDigitLength: 3,
          randomMode: 'SHUFFLED',
        }),
      ],
    })
  })

  it('replaces only a DRAFT config in update-delete-insert order', async () => {
    const fixture = createTransactionFixture()

    await replaceNumberingDraftVersion(fixture.transaction, {
      versionId: VERSION_ID,
      config: CONFIG,
      configFingerprint: FINGERPRINT,
    })

    expect(fixture.mocks.numberingRuleVersionUpdate).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: {
        resetPolicy: 'DAILY',
        timezone: 'Asia/Shanghai',
        configFingerprint: FINGERPRINT,
      },
      select: { id: true },
    })
    expect(fixture.mocks.numberingRuleSegmentDeleteMany).toHaveBeenCalledWith({
      where: { versionId: VERSION_ID },
    })
    expect(
      fixture.mocks.numberingRuleVersionUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.mocks.numberingRuleSegmentDeleteMany.mock.invocationCallOrder[0],
    )
    expect(
      fixture.mocks.numberingRuleSegmentDeleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.mocks.numberingRuleSegmentCreateMany.mock.invocationCallOrder[0],
    )
  })

  it('maps active and draft snapshots back to canonical decimal strings', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.numberingRuleVersionFindMany.mockResolvedValue([
      {
        id: VERSION_ID,
        revision: 3,
        status: NumberingRuleVersionStatus.ACTIVE,
        resetPolicy: 'NEVER',
        timezone: 'Asia/Shanghai',
        configFingerprint: FINGERPRINT,
        segments: [
          {
            position: 0,
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
        ],
      },
    ])

    await expect(readNumberingRuleVersionSnapshots(
      fixture.transaction,
      RULE_ID,
    )).resolves.toEqual([
      {
        id: VERSION_ID,
        revision: 3,
        status: NumberingRuleVersionStatus.ACTIVE,
        configFingerprint: FINGERPRINT,
        config: {
          resetPolicy: 'NEVER',
          segments: [{
            type: 'SEQUENCE',
            width: 18,
            startValue: '9007199254740993',
            step: '2',
          }],
        },
      },
    ])
  })

  it('increments the rule version exactly once and checks issuance existence narrowly', async () => {
    const fixture = createTransactionFixture()
    fixture.mocks.numberingIssuanceFindFirst.mockResolvedValue({ id: 'issued' })

    await updateNumberingRuleRecord(fixture.transaction, RULE_ID, {
      name: '新名称',
      description: null,
    })
    await expect(hasNumberingIssuance(
      fixture.transaction,
      RULE_ID,
    )).resolves.toBe(true)

    expect(fixture.mocks.numberingRuleUpdate).toHaveBeenCalledWith({
      where: { id: RULE_ID },
      data: {
        name: '新名称',
        description: null,
        version: { increment: 1 },
      },
      select: { id: true },
    })
    expect(fixture.mocks.numberingIssuanceFindFirst).toHaveBeenCalledWith({
      where: { ruleId: RULE_ID },
      select: { id: true },
    })
  })
})
