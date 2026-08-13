import type { Prisma } from '../../generated/prisma/client'
import { DictionaryTone } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  DictionaryLookupService,
  DictionaryLookupValidationError,
  DictionaryValueUnavailableError,
  type DictionaryLookupValidationField,
  type DictionaryValueUnavailableReason,
} from './dictionary-lookup.service'

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

type QueryRawMock = jest.Mock<Promise<unknown[]>, [unknown]>
type FindFirstMock = jest.Mock<Promise<unknown>, [unknown]>
type FindManyMock = jest.Mock<Promise<unknown[]>, [unknown]>

interface LookupTransactionFixture {
  readonly $queryRaw: QueryRawMock
  readonly dictionaryItem: { readonly findFirst: FindFirstMock }
}

function getSqlShape(value: unknown): SqlShape {
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

function getSqlText(value: unknown): string {
  return getSqlShape(value).strings.join(' ')
}

function createFixture(): {
  readonly service: DictionaryLookupService
  readonly transaction: LookupTransactionFixture
  readonly findFirst: FindFirstMock
  readonly findMany: FindManyMock
} {
  const findFirst = jest.fn<Promise<unknown>, [unknown]>()
  const findMany = jest.fn<Promise<unknown[]>, [unknown]>()
  const prisma = {
    dictionaryItem: { findFirst, findMany },
  } as unknown as PrismaService
  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>(),
    dictionaryItem: { findFirst },
  }

  return {
    service: new DictionaryLookupService(prisma),
    transaction,
    findFirst,
    findMany,
  }
}

async function expectUnavailable(
  action: () => Promise<unknown>,
  reason: DictionaryValueUnavailableReason,
): Promise<void> {
  let thrown: unknown
  try {
    await action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(DictionaryValueUnavailableError)
  expect(thrown).toMatchObject({
    name: 'DictionaryValueUnavailableError',
    code: 'DICTIONARY_VALUE_NOT_EFFECTIVE',
    message: 'Dictionary value is not effective',
    reason,
  })
}

async function expectValidationError(
  action: () => Promise<unknown>,
  field: DictionaryLookupValidationField,
): Promise<void> {
  let thrown: unknown
  try {
    await action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(DictionaryLookupValidationError)
  expect(thrown).toMatchObject({
    name: 'DictionaryLookupValidationError',
    code: 'DICTIONARY_LOOKUP_INPUT_INVALID',
    message: 'Dictionary lookup input is invalid',
    field,
  })
}

describe('DictionaryLookupService requireEffectiveValue', () => {
  it('normalizes input and locks Type then Item in the caller transaction', async () => {
    const fixture = createFixture()
    fixture.transaction.$queryRaw
      .mockResolvedValueOnce([{
        id: '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        enabled: true,
      }])
      .mockResolvedValueOnce([{
        value: 'PENDING',
        label: '待处理',
        tone: DictionaryTone.WARNING,
        enabled: true,
      }])

    await expect(fixture.service.requireEffectiveValue(
      fixture.transaction as unknown as Prisma.TransactionClient,
      {
        dictionaryCode: ' Order.Status ',
        value: ' pending ',
      },
    )).resolves.toEqual({
      dictionaryCode: 'order.status',
      value: 'PENDING',
      label: '待处理',
      tone: DictionaryTone.WARNING,
    })

    expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(2)
    const typeSql = fixture.transaction.$queryRaw.mock.calls[0]?.[0]
    const itemSql = fixture.transaction.$queryRaw.mock.calls[1]?.[0]
    expect(getSqlText(typeSql)).toContain('FROM "dictionary_types"')
    expect(getSqlText(typeSql)).toContain('FOR SHARE')
    expect(getSqlShape(typeSql).values).toEqual(['order.status'])
    expect(getSqlText(itemSql)).toContain('FROM "dictionary_items"')
    expect(getSqlText(itemSql)).toContain('FOR SHARE')
    expect(getSqlShape(itemSql).values).toEqual([
      '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      'PENDING',
    ])
    expect(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.transaction.$queryRaw.mock.invocationCallOrder[1] ?? 0,
    )
    expect(fixture.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    ['DICTIONARY_TYPE_NOT_FOUND', [[]], 1],
    ['DICTIONARY_TYPE_DISABLED', [[{
      id: '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      enabled: false,
    }]], 1],
    ['DICTIONARY_ITEM_NOT_FOUND', [[{
      id: '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      enabled: true,
    }], []], 2],
    ['DICTIONARY_ITEM_DISABLED', [[{
      id: '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      enabled: true,
    }], [{
      value: 'PENDING',
      label: '待处理',
      tone: DictionaryTone.WARNING,
      enabled: false,
    }]], 2],
  ] as const)(
    'returns the stable %s reason in lock-order priority',
    async (reason, queryResults, expectedQueryCount) => {
      const fixture = createFixture()
      for (const result of queryResults) {
        fixture.transaction.$queryRaw.mockResolvedValueOnce([...result])
      }

      await expectUnavailable(
        () => fixture.service.requireEffectiveValue(
          fixture.transaction as unknown as Prisma.TransactionClient,
          {
            dictionaryCode: 'order.status',
            value: 'PENDING',
          },
        ),
        reason,
      )
      expect(fixture.transaction.$queryRaw).toHaveBeenCalledTimes(
        expectedQueryCount,
      )
    },
  )

  it.each([
    ['dictionaryCode', null],
    ['dictionaryCode', {
      dictionaryCode: 'not valid',
      value: 'PENDING',
    }],
    ['value', {
      dictionaryCode: 'order.status',
      value: '-INVALID',
    }],
  ] as const)(
    'rejects invalid %s with the internal validation error before SQL',
    async (field, input) => {
      const fixture = createFixture()

      await expectValidationError(
        () => fixture.service.requireEffectiveValue(
          fixture.transaction as unknown as Prisma.TransactionClient,
          input as never,
        ),
        field,
      )
      expect(fixture.transaction.$queryRaw).not.toHaveBeenCalled()
    },
  )
})

describe('DictionaryLookupService resolveStoredValue', () => {
  it('can resolve a raw historical value in the caller transaction', async () => {
    const fixture = createFixture()
    fixture.findFirst.mockResolvedValue(null)

    await expect(fixture.service.resolveStoredValueInTransaction(
      fixture.transaction as unknown as Prisma.TransactionClient,
      {
        dictionaryCode: ' Order.Status ',
        value: ' historical ',
      },
    )).resolves.toEqual({
      known: false,
      dictionaryCode: 'order.status',
      value: ' historical ',
    })
    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        value: ' historical ',
        dictionaryType: { code: 'order.status' },
      },
      select: {
        value: true,
        label: true,
        tone: true,
        enabled: true,
        dictionaryType: { select: { enabled: true } },
      },
    })
  })

  it.each([
    [false, true, false],
    [true, true, true],
    [true, false, false],
  ] as const)(
    'returns a known descriptor for Type=%s and Item=%s without locking',
    async (typeEnabled, itemEnabled, effectiveEnabled) => {
      const fixture = createFixture()
      fixture.findFirst.mockResolvedValue({
        value: 'ARCHIVED',
        label: '已归档',
        tone: DictionaryTone.DEFAULT,
        enabled: itemEnabled,
        dictionaryType: { enabled: typeEnabled },
      })

      await expect(fixture.service.resolveStoredValue({
        dictionaryCode: ' Order.Status ',
        value: 'ARCHIVED',
      })).resolves.toEqual({
        known: true,
        dictionaryCode: 'order.status',
        value: 'ARCHIVED',
        label: '已归档',
        tone: DictionaryTone.DEFAULT,
        typeEnabled,
        itemEnabled,
        effectiveEnabled,
      })

      expect(fixture.findFirst).toHaveBeenCalledWith({
        where: {
          value: 'ARCHIVED',
          dictionaryType: { code: 'order.status' },
        },
        select: {
          value: true,
          label: true,
          tone: true,
          enabled: true,
          dictionaryType: { select: { enabled: true } },
        },
      })
      expect(fixture.transaction.$queryRaw).not.toHaveBeenCalled()
    },
  )

  it.each([' pending ', 'pending', '']) (
    'preserves an unknown raw history value exactly: %j',
    async (rawValue) => {
      const fixture = createFixture()
      fixture.findFirst.mockResolvedValue(null)

      await expect(fixture.service.resolveStoredValue({
        dictionaryCode: ' ORDER.STATUS ',
        value: rawValue,
      })).resolves.toEqual({
        known: false,
        dictionaryCode: 'order.status',
        value: rawValue,
      })
      expect(fixture.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            value: rawValue,
            dictionaryType: { code: 'order.status' },
          },
        }),
      )
    },
  )

  it.each([
    ['dictionaryCode', { dictionaryCode: 'bad', value: 'RAW' }],
    ['value', { dictionaryCode: 'order.status', value: 123 }],
  ] as const)(
    'rejects an invalid history %s before querying',
    async (field, input) => {
      const fixture = createFixture()

      await expectValidationError(
        () => fixture.service.resolveStoredValue(input as never),
        field,
      )
      expect(fixture.findFirst).not.toHaveBeenCalled()
    },
  )
})

describe('DictionaryLookupService resolveStoredValues', () => {
  it('returns an empty result without querying for an empty values array', async () => {
    const fixture = createFixture()

    await expect(fixture.service.resolveStoredValues({
      dictionaryCode: ' Order.Status ',
      values: [],
    })).resolves.toEqual([])

    expect(fixture.findMany).not.toHaveBeenCalled()
  })

  it('deduplicates the query while preserving duplicate input order and raw unknown values', async () => {
    const fixture = createFixture()
    fixture.findMany.mockResolvedValue([
      {
        value: 'ACTIVE',
        label: '启用',
        tone: DictionaryTone.SUCCESS,
        enabled: true,
        dictionaryType: { enabled: true },
      },
      {
        value: 'DISABLED',
        label: '停用',
        tone: DictionaryTone.DEFAULT,
        enabled: false,
        dictionaryType: { enabled: true },
      },
    ])

    await expect(fixture.service.resolveStoredValues({
      dictionaryCode: ' Order.Status ',
      values: ['ACTIVE', ' missing ', 'DISABLED', 'ACTIVE'],
    })).resolves.toEqual([
      {
        known: true,
        dictionaryCode: 'order.status',
        value: 'ACTIVE',
        label: '启用',
        tone: DictionaryTone.SUCCESS,
        typeEnabled: true,
        itemEnabled: true,
        effectiveEnabled: true,
      },
      {
        known: false,
        dictionaryCode: 'order.status',
        value: ' missing ',
      },
      {
        known: true,
        dictionaryCode: 'order.status',
        value: 'DISABLED',
        label: '停用',
        tone: DictionaryTone.DEFAULT,
        typeEnabled: true,
        itemEnabled: false,
        effectiveEnabled: false,
      },
      {
        known: true,
        dictionaryCode: 'order.status',
        value: 'ACTIVE',
        label: '启用',
        tone: DictionaryTone.SUCCESS,
        typeEnabled: true,
        itemEnabled: true,
        effectiveEnabled: true,
      },
    ])

    expect(fixture.findMany).toHaveBeenCalledTimes(1)
    expect(fixture.findMany).toHaveBeenCalledWith({
      where: {
        value: { in: ['ACTIVE', ' missing ', 'DISABLED'] },
        dictionaryType: { code: 'order.status' },
      },
      select: {
        value: true,
        label: true,
        tone: true,
        enabled: true,
        dictionaryType: { select: { enabled: true } },
      },
    })
  })

  it('keeps a disabled Type known but ineffective', async () => {
    const fixture = createFixture()
    fixture.findMany.mockResolvedValue([{
      value: 'ACTIVE',
      label: '启用',
      tone: DictionaryTone.SUCCESS,
      enabled: true,
      dictionaryType: { enabled: false },
    }])

    await expect(fixture.service.resolveStoredValues({
      dictionaryCode: 'order.status',
      values: ['ACTIVE'],
    })).resolves.toEqual([expect.objectContaining({
      known: true,
      typeEnabled: false,
      itemEnabled: true,
      effectiveEnabled: false,
    })])
  })

  it.each([
    ['dictionaryCode', null],
    ['values', { dictionaryCode: 'order.status', values: null }],
    ['values', { dictionaryCode: 'order.status', values: ['ACTIVE', null] }],
  ] as const)(
    'rejects invalid batch %s before querying',
    async (field, input) => {
      const fixture = createFixture()

      await expectValidationError(
        () => fixture.service.resolveStoredValues(input as never),
        field,
      )
      expect(fixture.findMany).not.toHaveBeenCalled()
    },
  )
})
