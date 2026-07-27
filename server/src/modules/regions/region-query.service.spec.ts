import { HttpStatus } from '@nestjs/common'

import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { RegionQueryService } from './region-query.service'

const COUNTRY_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const PROVINCE_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const CITY_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SECOND_CITY_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f4'
const THIRD_CITY_ID = '50ad40d4-7fa5-46fb-81e4-1986bcebf8f5'

interface RegionFixture {
  id: string
  parentId: string | null
  code: string
  name: string
  normalizedName: string
  englishName: string | null
  level: RegionLevelValue
  enabled: boolean
  sortOrder: number
}

interface SqlShape {
  strings: readonly string[]
  values: unknown[]
}

type AsyncDatabaseMock = jest.Mock<Promise<unknown>, [unknown]>

interface PrismaFixture {
  region: {
    findMany: AsyncDatabaseMock
    findUnique: AsyncDatabaseMock
  }
  $queryRaw: AsyncDatabaseMock
}

function regionFixture(
  overrides: Partial<RegionFixture> = {},
): RegionFixture {
  return {
    id: CITY_ID,
    parentId: PROVINCE_ID,
    code: 'TW-64000',
    name: '高雄市',
    normalizedName: '高雄市',
    englishName: null,
    level: RegionLevel.CITY,
    enabled: true,
    sortOrder: 5,
    ...overrides,
  }
}

function createServiceFixture(): {
  prisma: PrismaFixture
  service: RegionQueryService
} {
  const prisma: PrismaFixture = {
    region: {
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
    },
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>(),
  }

  return {
    prisma,
    service: new RegionQueryService(
      prisma as unknown as PrismaService,
    ),
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

function searchRow(options: {
  cityId?: string
  cityCode?: string
  cityName?: string
} = {}) {
  return {
    countryId: COUNTRY_ID,
    countryParentId: null,
    countryCode: 'TW',
    countryName: '中国台湾',
    countryEnglishName: null,
    countryLevel: RegionLevel.COUNTRY_REGION,
    countryEnabled: true,
    countrySortOrder: 20,
    provinceId: PROVINCE_ID,
    provinceParentId: COUNTRY_ID,
    provinceCode: 'TW-TAIWAN',
    provinceName: '台湾',
    provinceEnglishName: null,
    provinceLevel: RegionLevel.PROVINCE_STATE,
    provinceEnabled: true,
    provinceSortOrder: 1,
    cityId: options.cityId ?? CITY_ID,
    cityParentId: PROVINCE_ID,
    cityCode: options.cityCode ?? 'TW-64000',
    cityName: options.cityName ?? '高雄市',
    cityEnglishName: null,
    cityLevel: RegionLevel.CITY,
    cityEnabled: true,
    citySortOrder: 5,
  }
}

describe('RegionQueryService options', () => {
  it('loads only enabled roots with the fixed stable order', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.region.findMany.mockResolvedValue([
      {
        ...regionFixture({
          id: COUNTRY_ID,
          parentId: null,
          code: 'TW',
          name: '中国台湾',
          normalizedName: '中国台湾',
          level: RegionLevel.COUNTRY_REGION,
          sortOrder: 20,
        }),
        _count: { children: 1 },
      },
    ])

    await expect(service.options({})).resolves.toEqual([
      {
        id: COUNTRY_ID,
        parentId: null,
        code: 'TW',
        name: '中国台湾',
        englishName: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        effectiveEnabled: true,
        hasChildren: true,
      },
    ])

    expect(prisma.region.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          parentId: null,
          enabled: true,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { normalizedName: 'asc' },
          { id: 'asc' },
        ],
      }),
    )
    expect(prisma.region.findUnique).not.toHaveBeenCalled()
  })

  it('validates the parent and returns only its enabled direct children', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.region.findUnique.mockResolvedValue({
      ...regionFixture({
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        code: 'TW-TAIWAN',
        name: '台湾',
        normalizedName: '台湾',
        level: RegionLevel.PROVINCE_STATE,
        sortOrder: 1,
      }),
      parent: {
        ...regionFixture({
          id: COUNTRY_ID,
          parentId: null,
          code: 'TW',
          name: '中国台湾',
          normalizedName: '中国台湾',
          level: RegionLevel.COUNTRY_REGION,
          sortOrder: 20,
        }),
        parent: null,
      },
    })
    prisma.region.findMany.mockResolvedValue([
      {
        ...regionFixture(),
        _count: { children: 0 },
      },
    ])

    await expect(
      service.options({ parentId: PROVINCE_ID }),
    ).resolves.toEqual([
      {
        id: CITY_ID,
        parentId: PROVINCE_ID,
        code: 'TW-64000',
        name: '高雄市',
        englishName: null,
        level: RegionLevel.CITY,
        enabled: true,
        effectiveEnabled: true,
        hasChildren: false,
      },
    ])
    expect(prisma.region.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          parentId: PROVINCE_ID,
          enabled: true,
        },
        orderBy: [
          { sortOrder: 'asc' },
          { normalizedName: 'asc' },
          { id: 'asc' },
        ],
      }),
    )
  })

  it('returns empty options without loading children when any ancestor is disabled', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.region.findUnique.mockResolvedValue({
      ...regionFixture({
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        level: RegionLevel.PROVINCE_STATE,
      }),
      parent: {
        ...regionFixture({
          id: COUNTRY_ID,
          parentId: null,
          level: RegionLevel.COUNTRY_REGION,
          enabled: false,
        }),
        parent: null,
      },
    })

    await expect(
      service.options({ parentId: PROVINCE_ID }),
    ).resolves.toEqual([])
    expect(prisma.region.findMany).not.toHaveBeenCalled()
  })

  it('separates missing parents from CITY hierarchy violations', async () => {
    const missing = createServiceFixture()
    missing.prisma.region.findUnique.mockResolvedValue(null)
    await expectApiException(
      () => missing.service.options({ parentId: PROVINCE_ID }),
      HttpStatus.NOT_FOUND,
      'REGION_PARENT_NOT_FOUND',
    )

    const city = createServiceFixture()
    city.prisma.region.findUnique.mockResolvedValue({
      ...regionFixture(),
      parent: {
        ...regionFixture({
          id: PROVINCE_ID,
          parentId: COUNTRY_ID,
          level: RegionLevel.PROVINCE_STATE,
        }),
        parent: {
          ...regionFixture({
            id: COUNTRY_ID,
            parentId: null,
            level: RegionLevel.COUNTRY_REGION,
          }),
          parent: null,
        },
      },
    })
    await expectApiException(
      () => city.service.options({ parentId: CITY_ID }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'REGION_HIERARCHY_INVALID',
    )
  })
})

describe('RegionQueryService search', () => {
  it('uses a parameterized three-level query with literal-safe matching and limit + 1', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.$queryRaw.mockResolvedValue([
      searchRow(),
      searchRow({
        cityId: SECOND_CITY_ID,
        cityCode: 'TW-65000',
        cityName: '新北市',
      }),
      searchRow({
        cityId: THIRD_CITY_ID,
        cityCode: 'TW-66000',
        cityName: '台中市',
      }),
    ])

    const result = await service.search({
      query: '  MY_%  ',
      limit: 2,
    })

    expect(result).toEqual({
      items: [
        expect.objectContaining({ cityId: CITY_ID }),
        expect.objectContaining({ cityId: SECOND_CITY_ID }),
      ],
      limit: 2,
      hasMore: true,
    })
    expect(result.items[0]?.path.map(({ name }) => name)).toEqual([
      '中国台湾',
      '台湾',
      '高雄市',
    ])
    expect(
      result.items[0]?.path.map(({ effectiveEnabled }) =>
        effectiveEnabled,
      ),
    ).toEqual([true, true, true])

    const sql = prisma.$queryRaw.mock.calls[0]?.[0]
    const sqlText = getSqlText(sql)
    const sqlValues = getSqlValues(sql)
    expect(sqlText).toContain('JOIN "regions" AS province')
    expect(sqlText).toContain('JOIN "regions" AS country')
    expect(sqlText).toContain('CASE')
    expect(sqlText).toContain('strpos')
    expect(sqlText).toContain('country."sort_order"')
    expect(sqlText).toContain('province."sort_order"')
    expect(sqlText).toContain('city."sort_order"')
    expect(sqlText).not.toMatch(/\b(?:LIKE|ILIKE)\b/u)
    expect(sqlValues).toContain('my_%')
    expect(sqlValues).toContain('MY_%')
    expect(sqlValues).toContain(3)
  })

  it('returns the default bounded limit and reports no overflow', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.$queryRaw.mockResolvedValue([searchRow()])

    const result = await service.search({
      query: '  高雄市  ',
      limit: 20,
    })
    expect(result).toMatchObject({
      limit: 20,
      hasMore: false,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.cityId).toBe(CITY_ID)
    expect(result.items[0]?.path).toHaveLength(3)

    const sql = prisma.$queryRaw.mock.calls[0]?.[0]
    expect(getSqlValues(sql)).toContain(21)
    expect(getSqlValues(sql)).toContain('高雄市')
  })
})

describe('RegionQueryService path', () => {
  it('returns exactly three levels even when an ancestor disables the historical value', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.region.findUnique.mockResolvedValue({
      ...regionFixture(),
      parent: {
        ...regionFixture({
          id: PROVINCE_ID,
          parentId: COUNTRY_ID,
          code: 'TW-TAIWAN',
          name: '台湾',
          normalizedName: '台湾',
          level: RegionLevel.PROVINCE_STATE,
          enabled: false,
          sortOrder: 1,
        }),
        parent: {
          ...regionFixture({
            id: COUNTRY_ID,
            parentId: null,
            code: 'TW',
            name: '中国台湾',
            normalizedName: '中国台湾',
            level: RegionLevel.COUNTRY_REGION,
            enabled: true,
            sortOrder: 20,
          }),
          parent: null,
        },
      },
    })

    const result = await service.path(CITY_ID)

    expect(result.cityId).toBe(CITY_ID)
    expect(result.path).toHaveLength(3)
    expect(result.path.map(({ name }) => name)).toEqual([
      '中国台湾',
      '台湾',
      '高雄市',
    ])
    expect(result.path.map(({ effectiveEnabled }) =>
      effectiveEnabled,
    )).toEqual([true, false, false])
    expect(result.path.map(({ hasChildren }) => hasChildren)).toEqual([
      true,
      true,
      false,
    ])
  })

  it('separates a missing value from an existing non-CITY value', async () => {
    const missing = createServiceFixture()
    missing.prisma.region.findUnique.mockResolvedValue(null)
    await expectApiException(
      () => missing.service.path(CITY_ID),
      HttpStatus.NOT_FOUND,
      'REGION_NOT_FOUND',
    )

    const province = createServiceFixture()
    province.prisma.region.findUnique.mockResolvedValue({
      ...regionFixture({
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        level: RegionLevel.PROVINCE_STATE,
      }),
      parent: {
        ...regionFixture({
          id: COUNTRY_ID,
          parentId: null,
          level: RegionLevel.COUNTRY_REGION,
        }),
        parent: null,
      },
    })
    await expectApiException(
      () => province.service.path(PROVINCE_ID),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'REGION_VALUE_NOT_CITY',
    )
  })
})
