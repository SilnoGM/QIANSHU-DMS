import type { Prisma } from '../../generated/prisma/client'
import {
  escapeNumberingLikeLiteral,
  readDatabaseAsOfInTransaction,
  readNumberingIssuancesPageInTransaction,
  readNumberingPeriodUsageInTransaction,
  readNumberingRuleDetailInTransaction,
  readNumberingRuleListPageInTransaction,
  readNumberingRuleVersionsPageInTransaction,
} from './numbering-query.persistence'

const AS_OF = new Date('2026-08-02T02:03:04.000Z')

function createTransaction(): {
  transaction: Prisma.TransactionClient
  queryRaw: jest.Mock
  ruleCount: jest.Mock
  ruleGroupBy: jest.Mock
  ruleFindMany: jest.Mock
  ruleFindUnique: jest.Mock
  versionCount: jest.Mock
  versionFindMany: jest.Mock
  issuanceFindFirst: jest.Mock
} {
  const queryRaw = jest.fn()
  const ruleCount = jest.fn()
  const ruleGroupBy = jest.fn()
  const ruleFindMany = jest.fn()
  const ruleFindUnique = jest.fn()
  const versionCount = jest.fn()
  const versionFindMany = jest.fn()
  const issuanceFindFirst = jest.fn()
  const transaction = {
    $queryRaw: queryRaw,
    numberingRule: {
      count: ruleCount,
      groupBy: ruleGroupBy,
      findMany: ruleFindMany,
      findUnique: ruleFindUnique,
    },
    numberingRuleVersion: {
      count: versionCount,
      findMany: versionFindMany,
    },
    numberingIssuance: {
      findFirst: issuanceFindFirst,
    },
  } as unknown as Prisma.TransactionClient

  return {
    transaction,
    queryRaw,
    ruleCount,
    ruleGroupBy,
    ruleFindMany,
    ruleFindUnique,
    versionCount,
    versionFindMany,
    issuanceFindFirst,
  }
}

function sqlText(value: unknown): string {
  const sql = value as { strings?: readonly string[] }
  return sql.strings?.join('?') ?? String(value)
}

function sqlValues(value: unknown): readonly unknown[] {
  const sql = value as { values?: readonly unknown[] }
  return sql.values ?? []
}

function callArgument<T>(
  mock: jest.Mock,
  callIndex = 0,
  argumentIndex = 0,
): T {
  const calls = mock.mock.calls as unknown as readonly (readonly unknown[])[]
  return calls[callIndex]?.[argumentIndex] as T
}

describe('numbering query persistence', () => {
  it('reads the database transaction timestamp as the sole asOf clock', async () => {
    const { transaction, queryRaw } = createTransaction()
    queryRaw.mockResolvedValue([{ asOf: AS_OF }])

    await expect(readDatabaseAsOfInTransaction(transaction)).resolves.toBe(AS_OF)
    expect(sqlText(callArgument(queryRaw))).toContain('transaction_timestamp()')
  })

  it('lists with keyword/status filters and a same-direction UUID tie-breaker', async () => {
    const mocks = createTransaction()
    mocks.ruleCount.mockResolvedValue(2)
    mocks.ruleGroupBy.mockResolvedValue([{ purpose: 'BUSINESS', _count: { _all: 2 } }])
    mocks.ruleFindMany.mockResolvedValue([])

    await expect(readNumberingRuleListPageInTransaction(
      mocks.transaction,
      {
        keyword: '销售',
        status: 'ENABLED',
        page: 2,
        pageSize: 10,
        skip: 10,
        sortOrder: 'asc',
      },
    )).resolves.toEqual({ total: 2, rows: [], purposeCounts: [{ value: 'ALL', count: 2 }, { value: 'BUSINESS', count: 2 }, { value: 'SHIPPING_MARK', count: 0 }] })

    const countArguments = callArgument<{ where: unknown }>(mocks.ruleGroupBy)
    const findArguments = callArgument<{
      where: unknown
      orderBy: unknown
      select: unknown
    }>(mocks.ruleFindMany)
    expect(countArguments.where).toEqual(findArguments.where)
    expect(findArguments.where).toEqual({
      status: 'ENABLED',
      OR: [
        { ruleCode: { contains: '销售', mode: 'insensitive' } },
        { name: { contains: '销售', mode: 'insensitive' } },
        { description: { contains: '销售', mode: 'insensitive' } },
      ],
    })
    expect(findArguments.orderBy).toEqual([
      { updatedAt: 'asc' },
      { id: 'asc' },
    ])
    expect(findArguments).toEqual(expect.objectContaining({ skip: 10, take: 10 }))
    expect(JSON.stringify(findArguments.select)).not.toContain('configFingerprint')
  })

  it('reads detail and version history with explicit public configuration fields', async () => {
    const mocks = createTransaction()
    mocks.ruleFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rule-id' })
    mocks.versionCount.mockResolvedValue(2)
    mocks.versionFindMany.mockResolvedValue([])

    await expect(readNumberingRuleDetailInTransaction(
      mocks.transaction,
      '00000000-0000-4000-8000-000000000001',
    )).resolves.toBeNull()
    await expect(readNumberingRuleVersionsPageInTransaction(
      mocks.transaction,
      '00000000-0000-4000-8000-000000000001',
      { page: 1, pageSize: 20, skip: 0 },
    )).resolves.toEqual({ ruleExists: true, total: 2, rows: [] })

    const versionArguments = callArgument<{ orderBy: unknown }>(
      mocks.versionFindMany,
    )
    expect(versionArguments.orderBy).toEqual([
      { revision: 'desc' },
      { id: 'desc' },
    ])
    const detailArguments = callArgument<{ select: unknown }>(
      mocks.ruleFindUnique,
    )
    expect(JSON.stringify(detailArguments.select))
      .not.toContain('configFingerprint')
  })

  it('loads all rule usage in one set-based SUM(...used_count)::text query', async () => {
    const { transaction, queryRaw } = createTransaction()
    queryRaw.mockResolvedValue([
      {
        ruleId: '00000000-0000-4000-8000-000000000001',
        periodKey: '20260802',
        usedCount: '9007199254740993',
        lifetimeUsedCount: '999999999999999999',
      },
      {
        ruleId: '00000000-0000-4000-8000-000000000002',
        periodKey: null,
        usedCount: '0',
        lifetimeUsedCount: '0',
      },
    ])

    const result = await readNumberingPeriodUsageInTransaction(transaction, [
      {
        ruleId: '00000000-0000-4000-8000-000000000001',
        periodKey: '20260802',
      },
      {
        ruleId: '00000000-0000-4000-8000-000000000002',
        periodKey: null,
      },
    ])

    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(sqlText(callArgument(queryRaw)))
      .toMatch(/SUM\([\s\S]*used_count[\s\S]*\)::text/u)
    expect(result.get('00000000-0000-4000-8000-000000000001')).toEqual({
      usedCount: '9007199254740993',
      lifetimeUsedCount: '999999999999999999',
    })
  })

  it('escapes LIKE metacharacters fail-safe for exact and prefix issuance reads', async () => {
    expect(escapeNumberingLikeLiteral('A%_\\B')).toBe('A\\%\\_\\\\B')

    const exactMocks = createTransaction()
    exactMocks.ruleFindUnique.mockResolvedValue({ id: 'rule-id' })
    exactMocks.queryRaw
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([])

    await readNumberingIssuancesPageInTransaction(
      exactMocks.transaction,
      'rule-id',
      {
        page: 1,
        pageSize: 20,
        skip: 0,
        generatedNumber: 'A%_\\B',
        generatedNumberMatch: 'EXACT',
      },
    )

    const exactCount = callArgument(exactMocks.queryRaw)
    expect(sqlText(exactCount)).toContain('LIKE')
    expect(sqlText(exactCount)).toContain('ESCAPE')
    expect(sqlValues(exactCount)).toContain('A\\%\\_\\\\B')

    const prefixMocks = createTransaction()
    prefixMocks.ruleFindUnique.mockResolvedValue({ id: 'rule-id' })
    prefixMocks.queryRaw
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: 'issuance-id',
        ruleRevision: 3,
        periodKey: 'ALL',
        generatedNumber: 'A%_\\B1',
        sequenceValue: 9007199254740993n,
        consumerCode: 'ORDER',
        issuedAt: AS_OF,
      }])

    const result = await readNumberingIssuancesPageInTransaction(
      prefixMocks.transaction,
      'rule-id',
      {
        page: 1,
        pageSize: 20,
        skip: 0,
        generatedNumber: 'A%_\\B',
        generatedNumberMatch: 'PREFIX',
      },
    )

    const prefixCount = callArgument(prefixMocks.queryRaw)
    const publicSelect = sqlText(callArgument(prefixMocks.queryRaw, 1))
    expect(sqlValues(prefixCount)).toContain('A\\%\\_\\\\B%')
    expect(publicSelect).toContain('ORDER BY i."issued_at" DESC, i.id DESC')
    expect(publicSelect).not.toMatch(/idempotency|fingerprint|hash/iu)
    expect(result.rows[0].sequenceValue).toBe('9007199254740993')
  })
})
