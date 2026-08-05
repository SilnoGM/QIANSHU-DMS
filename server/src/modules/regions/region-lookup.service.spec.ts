import type { Prisma } from '../../generated/prisma/client'
import { RegionLevel } from '../../generated/prisma/enums'
import { RegionLookupService } from './region-lookup.service'

const COUNTRY_ID = '10000000-0000-4000-8000-000000000001'
const PROVINCE_ID = '20000000-0000-4000-8000-000000000001'
const CITY_ID = '30000000-0000-4000-8000-000000000001'
const MISSING_ID = '40000000-0000-4000-8000-000000000001'

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
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

function createFixture() {
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  const transaction = {
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient
  return {
    queryRaw,
    service: new RegionLookupService(),
    transaction,
  }
}

describe('RegionLookupService lockReferences', () => {
  it('returns an empty immutable-facing map without SQL for no references', async () => {
    const fixture = createFixture()

    const result = await fixture.service.lockReferences(
      fixture.transaction,
      [],
    )

    expect([...result]).toEqual([])
    expect(fixture.queryRaw).not.toHaveBeenCalled()
  })

  it('deduplicates UUIDs, locks the full ancestry in SQL order and derives effective state', async () => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce([
      {
        id: COUNTRY_ID,
        parentId: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
      },
      {
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: false,
      },
      {
        id: CITY_ID,
        parentId: PROVINCE_ID,
        level: RegionLevel.CITY,
        enabled: true,
      },
    ])

    const result = await fixture.service.lockReferences(
      fixture.transaction,
      [CITY_ID, COUNTRY_ID, CITY_ID],
    )

    expect([...result]).toEqual([
      [COUNTRY_ID, {
        id: COUNTRY_ID,
        parentId: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        effectiveEnabled: true,
      }],
      [CITY_ID, {
        id: CITY_ID,
        parentId: PROVINCE_ID,
        level: RegionLevel.CITY,
        enabled: true,
        effectiveEnabled: false,
      }],
    ])
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
    const sql = getSqlShape(fixture.queryRaw.mock.calls[0]?.[0])
    const text = sql.strings.join(' ')
    expect(text).toContain('WITH RECURSIVE')
    expect(text).toContain('ORDER BY region."id"')
    expect(text).toContain('FOR KEY SHARE OF region')
    expect(sql.values).toEqual([COUNTRY_ID, CITY_ID])
  })

  it('omits missing requested IDs without inventing a domain error', async () => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce([])

    const result = await fixture.service.lockReferences(
      fixture.transaction,
      [MISSING_ID],
    )

    expect(result.has(MISSING_ID)).toBe(false)
  })

  it.each([
    [[{ id: COUNTRY_ID, parentId: null, level: 'UNKNOWN', enabled: true }]],
    [[{ id: COUNTRY_ID, parentId: null, level: RegionLevel.COUNTRY_REGION, enabled: 1 }]],
    [[{ id: 1, parentId: null, level: RegionLevel.COUNTRY_REGION, enabled: true }]],
  ])('fails closed for a malformed locked graph', async (rows) => {
    const fixture = createFixture()
    fixture.queryRaw.mockResolvedValueOnce(rows)

    await expect(fixture.service.lockReferences(
      fixture.transaction,
      [COUNTRY_ID],
    )).rejects.toThrow('Region lookup invariant violated')
  })
})
