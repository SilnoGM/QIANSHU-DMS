import type { Prisma } from '../../generated/prisma/client'
import {
  CurrencyLookupError,
  CurrencyLookupService,
  type CurrencyLookupFailureReason,
} from './currency-lookup.service'

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

function createFixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  const transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient
  const service = new CurrencyLookupService()

  return { queryRaw, service, transaction }
}

async function expectLookupError(
  action: Promise<unknown>,
  reason: CurrencyLookupFailureReason,
): Promise<CurrencyLookupError> {
  let thrown: unknown
  try {
    await action
  }
  catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(CurrencyLookupError)
  expect(thrown).toMatchObject({
    name: 'CurrencyLookupError',
    code: 'CURRENCY_LOOKUP_FAILED',
    message: 'Currency lookup failed',
    reason,
  })
  return thrown as CurrencyLookupError
}

describe('CurrencyLookupService requireEnabledCodes', () => {
  it('deduplicates and stably sorts codes in one caller-transaction lock query', async () => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce([
      { code: 'CNY', enabled: true, minorUnit: 2 },
      { code: 'MYR', enabled: true, minorUnit: 2 },
      { code: 'TWD', enabled: true, minorUnit: 2 },
    ])

    const result = await fixture.service.requireEnabledCodes(
      fixture.transaction,
      ['TWD', 'CNY', 'TWD', 'MYR'],
    )

    expect(result).toEqual([
      { code: 'CNY', minorUnit: 2 },
      { code: 'MYR', minorUnit: 2 },
      { code: 'TWD', minorUnit: 2 },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every(item => Object.isFrozen(item))).toBe(true)
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
    const sql = requireSql(fixture.queryRaw.mock.calls[0]?.[0])
    const text = sql.strings.join('?')
    expect(text).toContain('FROM "currencies"')
    expect(text).toContain('ORDER BY "code" COLLATE "C" ASC')
    expect(text).toContain('FOR SHARE')
    expect(text).not.toContain('FOR UPDATE')
    expect(sql.values).toEqual(['CNY', 'MYR', 'TWD'])
  })

  it.each([
    ['CURRENCY_NOT_FOUND', [{ code: 'CNY', enabled: true, minorUnit: 2 }]],
    ['CURRENCY_DISABLED', [
      { code: 'CNY', enabled: true, minorUnit: 2 },
      { code: 'TWD', enabled: false, minorUnit: 2 },
    ]],
    ['CURRENCY_MINOR_UNIT_INVALID', [
      { code: 'CNY', enabled: true, minorUnit: 2 },
      { code: 'TWD', enabled: true, minorUnit: 5 },
    ]],
  ] as const)('fails closed with %s', async (reason, rows) => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce([...rows])

    await expectLookupError(
      fixture.service.requireEnabledCodes(
        fixture.transaction,
        ['TWD', 'CNY'],
      ),
      reason,
    )
  })

  it('rejects malformed inputs before SQL and accepts an empty frozen set', async () => {
    for (const codes of [null, 'CNY', ['cny'], ['CN'], ['CNY', 123]]) {
      const fixture = createFixture()

      await expectLookupError(
        fixture.service.requireEnabledCodes(fixture.transaction, codes as never),
        'INPUT_INVALID',
      )
      expect(fixture.queryRaw).not.toHaveBeenCalled()
    }

    const emptyFixture = createFixture()
    const empty = await emptyFixture.service.requireEnabledCodes(
      emptyFixture.transaction,
      [],
    )
    expect(empty).toEqual([])
    expect(Object.isFrozen(empty)).toBe(true)
    expect(emptyFixture.queryRaw).not.toHaveBeenCalled()
  })

  it('maps driver failures and damaged rows without leaking details', async () => {
    const driverFixture = createFixture()
    driverFixture.queryRaw.mockRejectedValueOnce(
      new Error('secret SQL and complete currency input'),
    )
    const driverError = await expectLookupError(
      driverFixture.service.requireEnabledCodes(
        driverFixture.transaction,
        ['CNY'],
      ),
      'PERSISTENCE_ERROR',
    )
    expect(JSON.stringify(driverError)).not.toMatch(/secret|SQL|complete/iu)

    for (const minorUnit of [-1, 1.5, '2']) {
      const rowFixture = createFixture()
      rowFixture.queryRaw.mockResolvedValueOnce([
        { code: 'CNY', enabled: true, minorUnit },
      ])
      await expectLookupError(
        rowFixture.service.requireEnabledCodes(
          rowFixture.transaction,
          ['CNY'],
        ),
        'CURRENCY_MINOR_UNIT_INVALID',
      )
    }
  })
})
