import { HttpStatus } from '@nestjs/common'

import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  RegionAvailability,
  RegionOwnStatus,
  RegionSortBy,
  RegionSortOrder,
} from './dto/region-management.dto'
import { RegionQueryService } from './region-query.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({
    applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
  }),
)

const mockedApplyTransactionTimeouts = jest.mocked(
  applyTransactionTimeouts,
)

const COUNTRY_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const PROVINCE_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const CITY_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SECOND_CITY_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f4'

interface SqlShape {
  strings: readonly string[]
  values: unknown[]
}

interface ManagementRegionRow {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  sourceName: string | null
  sourceCode: string | null
  administrativeType: string
  level: RegionLevelValue
  enabled: boolean
  effectiveEnabled: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

type AsyncDatabaseMock = jest.Mock<Promise<unknown>, [unknown]>

interface ManagementPrismaFixture {
  prisma: PrismaService
  rootQueryRaw: AsyncDatabaseMock
  transaction: jest.Mock<
    Promise<unknown>,
    [(transaction: unknown) => Promise<unknown>]
  >
  transactionQueryRaw: AsyncDatabaseMock
  transactionFindUnique: AsyncDatabaseMock
  transactionClient: {
    $queryRaw: AsyncDatabaseMock
    region: {
      findUnique: AsyncDatabaseMock
    }
  }
}

function getSqlText(value: unknown): string {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return (value as SqlShape).strings.join(' ')
}

function getSqlValues(value: unknown): unknown[] {
  if (
    typeof value !== 'object'
    || value === null
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return (value as SqlShape).values
}

function regionRow(
  overrides: Partial<ManagementRegionRow> = {},
): ManagementRegionRow {
  return {
    id: CITY_ID,
    parentId: PROVINCE_ID,
    code: 'TW-64000',
    name: '高雄市',
    englishName: null,
    sourceName: '高雄市',
    sourceCode: 'E/64000',
    administrativeType: 'COUNTY_CITY',
    level: RegionLevel.CITY,
    enabled: true,
    effectiveEnabled: true,
    sortOrder: 5,
    createdAt: new Date('2026-07-27T01:00:00.000Z'),
    updatedAt: new Date('2026-07-27T02:00:00.000Z'),
    ...overrides,
  }
}

function createFixture(): ManagementPrismaFixture & {
  service: RegionQueryService
} {
  const rootQueryRaw = jest.fn<Promise<unknown>, [unknown]>()
  const transactionQueryRaw =
    jest.fn<Promise<unknown>, [unknown]>()
  const transactionFindUnique =
    jest.fn<Promise<unknown>, [unknown]>()
  const transactionClient = {
    $queryRaw: transactionQueryRaw,
    region: {
      findUnique: transactionFindUnique,
    },
  }
  const transaction = jest
    .fn<
      Promise<unknown>,
      [(transaction: unknown) => Promise<unknown>]
    >()
    .mockImplementation(callback => callback(transactionClient))
  const prisma = {
    $queryRaw: rootQueryRaw,
    $transaction: transaction,
  } as unknown as PrismaService

  return {
    prisma,
    rootQueryRaw,
    transaction,
    transactionQueryRaw,
    transactionFindUnique,
    transactionClient,
    service: new RegionQueryService(prisma),
  }
}

async function expectApiException(
  action: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await action()
    throw new Error('Expected action to reject')
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiException)
    const apiError = error as ApiException
    expect(apiError.getStatus()).toBe(status)
    expect(apiError.code).toBe(code)
  }
}

describe('RegionQueryService management navigation', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('returns only the first two levels, including disabled nodes, in stable order', async () => {
    const fixture = createFixture()
    fixture.rootQueryRaw.mockResolvedValue([
      {
        id: COUNTRY_ID,
        parentId: null,
        code: 'TW',
        name: '中国台湾',
        englishName: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        effectiveEnabled: true,
      },
      {
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        code: 'TW-TAIWAN',
        name: '台湾',
        englishName: null,
        level: RegionLevel.PROVINCE_STATE,
        enabled: false,
        effectiveEnabled: false,
      },
    ])

    await expect(fixture.service.navigation()).resolves.toEqual([
      {
        id: COUNTRY_ID,
        parentId: null,
        code: 'TW',
        name: '中国台湾',
        englishName: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        effectiveEnabled: true,
        children: [
          {
            id: PROVINCE_ID,
            parentId: COUNTRY_ID,
            code: 'TW-TAIWAN',
            name: '台湾',
            englishName: null,
            level: RegionLevel.PROVINCE_STATE,
            enabled: false,
            effectiveEnabled: false,
            children: [],
          },
        ],
      },
    ])

    const sql = fixture.rootQueryRaw.mock.calls[0]?.[0]
    const text = getSqlText(sql)
    expect(text).toContain('LEFT JOIN "regions" AS parent')
    expect(text).toContain(`'COUNTRY_REGION'::"region_level"`)
    expect(text).toContain(`'PROVINCE_STATE'::"region_level"`)
    expect(text).not.toContain(`'CITY'::"region_level"`)
    expect(text).toContain('target."sort_order" ASC')
    expect(text).toContain('target."normalized_name" ASC')
    expect(text).toContain('target."id" ASC')
  })

  it('maps unexpected navigation failures to the fixed safe boundary', async () => {
    const fixture = createFixture()
    fixture.rootQueryRaw.mockRejectedValue(
      new Error('secret PostgreSQL details'),
    )

    await expectApiException(
      () => fixture.service.navigation(),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})

describe('RegionQueryService management list', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('uses one timed interactive transaction for count and default stable page rows', async () => {
    const fixture = createFixture()
    fixture.transactionQueryRaw
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        regionRow({
          id: COUNTRY_ID,
          parentId: null,
          code: 'CN',
          name: '中国',
          sourceName: null,
          sourceCode: null,
          administrativeType: 'COUNTRY_REGION',
          level: RegionLevel.COUNTRY_REGION,
          sortOrder: 10,
        }),
        regionRow({
          id: SECOND_CITY_ID,
          parentId: null,
          code: 'TW',
          name: '中国台湾',
          sourceName: null,
          sourceCode: null,
          administrativeType: 'COUNTRY_REGION',
          level: RegionLevel.COUNTRY_REGION,
          sortOrder: 20,
        }),
      ])

    const result = await fixture.service.list({})

    expect(result).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
    })
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: COUNTRY_ID,
      code: 'CN',
      effectiveEnabled: true,
      createdAt: '2026-07-27T01:00:00.000Z',
      updatedAt: '2026-07-27T02:00:00.000Z',
    })
    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(
      fixture.transactionClient,
    )
    expect(fixture.transactionFindUnique).not.toHaveBeenCalled()
    expect(fixture.transactionQueryRaw).toHaveBeenCalledTimes(2)

    const countSql = fixture.transactionQueryRaw.mock.calls[0]?.[0]
    const rowsSql = fixture.transactionQueryRaw.mock.calls[1]?.[0]
    const countText = getSqlText(countSql)
    const rowsText = getSqlText(rowsSql)
    expect(countText).toContain('count(*)::integer AS "count"')
    expect(countText).toContain('LEFT JOIN "regions" AS parent')
    expect(countText).toContain('LEFT JOIN "regions" AS grandparent')
    expect(rowsText).toContain('target."sort_order" ASC')
    expect(rowsText).toContain('target."normalized_name" ASC')
    expect(rowsText).toContain('target."id" ASC')
    expect(getSqlValues(rowsSql)).toEqual(
      expect.arrayContaining([
        RegionLevel.COUNTRY_REGION,
        20,
        0,
      ]),
    )

    const timeoutOrder =
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0]
    const countOrder =
      fixture.transactionQueryRaw.mock.invocationCallOrder[0]
    const rowsOrder =
      fixture.transactionQueryRaw.mock.invocationCallOrder[1]
    expect(timeoutOrder).toBeLessThan(countOrder)
    expect(countOrder).toBeLessThan(rowsOrder)
  })

  it('infers CITY scope and combines normalized filters with a whitelisted custom order', async () => {
    const fixture = createFixture()
    fixture.transactionFindUnique.mockResolvedValue({
      id: PROVINCE_ID,
      level: RegionLevel.PROVINCE_STATE,
      enabled: false,
      parentId: COUNTRY_ID,
      parent: {
        id: COUNTRY_ID,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        parentId: null,
      },
    })
    fixture.transactionQueryRaw
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])

    await fixture.service.list({
      parentId: PROVINCE_ID,
      query: '  KUALA   LUMPUR ',
      code: 'my-14-01',
      ownStatus: RegionOwnStatus.ENABLED,
      availability: RegionAvailability.ANCESTOR_DISABLED,
      page: 2,
      pageSize: 100,
      sortBy: RegionSortBy.UPDATED_AT,
      sortOrder: RegionSortOrder.DESC,
    })

    const countSql = fixture.transactionQueryRaw.mock.calls[0]?.[0]
    const rowsSql = fixture.transactionQueryRaw.mock.calls[1]?.[0]
    for (const sql of [countSql, rowsSql]) {
      const text = getSqlText(sql)
      const values = getSqlValues(sql)
      expect(text).toContain('target."parent_id" = CAST(')
      expect(text).toContain('target."enabled" = true')
      expect(text).toContain('strpos(target."normalized_name"')
      expect(text).toContain('NOT parent."enabled"')
      expect(text).toContain('NOT grandparent."enabled"')
      expect(text).not.toMatch(/\b(?:LIKE|ILIKE)\b/u)
      expect(values).toEqual(expect.arrayContaining([
        PROVINCE_ID,
        RegionLevel.CITY,
        'kuala lumpur',
        'KUALA LUMPUR',
        'MY-14-01',
      ]))
    }
    const rowsText = getSqlText(rowsSql)
    expect(rowsText).toContain('target."updated_at" DESC')
    expect(rowsText).toContain('target."id" DESC')
    expect(getSqlValues(rowsSql)).toEqual(
      expect.arrayContaining([100, 100]),
    )
  })

  it('separates missing parents and CITY hierarchy violations before count', async () => {
    const missing = createFixture()
    missing.transactionFindUnique.mockResolvedValue(null)
    await expectApiException(
      () => missing.service.list({ parentId: PROVINCE_ID }),
      HttpStatus.NOT_FOUND,
      'REGION_PARENT_NOT_FOUND',
    )
    expect(missing.transactionQueryRaw).not.toHaveBeenCalled()

    const city = createFixture()
    city.transactionFindUnique.mockResolvedValue({
      id: CITY_ID,
      level: RegionLevel.CITY,
      enabled: true,
      parentId: PROVINCE_ID,
      parent: {
        id: PROVINCE_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: true,
        parentId: COUNTRY_ID,
      },
    })
    await expectApiException(
      () => city.service.list({ parentId: CITY_ID }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'REGION_HIERARCHY_INVALID',
    )
    expect(city.transactionQueryRaw).not.toHaveBeenCalled()
  })

  it('rejects contradictory direct service filters and safely maps database failures', async () => {
    const invalid = createFixture()
    await expectApiException(
      () => invalid.service.list({
        ownStatus: RegionOwnStatus.DISABLED,
        availability: RegionAvailability.EFFECTIVE,
      }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(invalid.transaction).not.toHaveBeenCalled()

    const failed = createFixture()
    failed.transactionQueryRaw.mockRejectedValue(
      new Error('secret query details'),
    )
    await expectApiException(
      () => failed.service.list({}),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})

describe('RegionQueryService management detail', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('returns source fields, timestamps and effective state from fixed ancestry joins', async () => {
    const fixture = createFixture()
    fixture.rootQueryRaw.mockResolvedValue([
      regionRow({
        enabled: true,
        effectiveEnabled: false,
      }),
    ])

    await expect(fixture.service.getById(CITY_ID)).resolves.toEqual({
      id: CITY_ID,
      parentId: PROVINCE_ID,
      code: 'TW-64000',
      name: '高雄市',
      englishName: null,
      sourceName: '高雄市',
      sourceCode: 'E/64000',
      administrativeType: 'COUNTY_CITY',
      level: RegionLevel.CITY,
      enabled: true,
      effectiveEnabled: false,
      sortOrder: 5,
      createdAt: '2026-07-27T01:00:00.000Z',
      updatedAt: '2026-07-27T02:00:00.000Z',
    })
    const sql = fixture.rootQueryRaw.mock.calls[0]?.[0]
    expect(getSqlText(sql)).toContain(
      'LEFT JOIN "regions" AS grandparent',
    )
    expect(getSqlValues(sql)).toContain(CITY_ID)
  })

  it('returns REGION_NOT_FOUND and hides unexpected database details', async () => {
    const missing = createFixture()
    missing.rootQueryRaw.mockResolvedValue([])
    await expectApiException(
      () => missing.service.getById(CITY_ID),
      HttpStatus.NOT_FOUND,
      'REGION_NOT_FOUND',
    )

    const failed = createFixture()
    failed.rootQueryRaw.mockRejectedValue(
      new Error('secret database details'),
    )
    await expectApiException(
      () => failed.service.getById(CITY_ID),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})
