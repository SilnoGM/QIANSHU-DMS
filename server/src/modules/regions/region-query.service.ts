import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  type RegionListQueryDto,
  type RegionNavigationNodeDto,
} from './dto/region-management.dto'
import {
  type RegionOptionDto,
  type RegionPathDto,
  type RegionPathNodeDto,
  type RegionSearchItemDto,
  type RegionSearchResponseDto,
  type RegionOptionsQueryDto,
  type RegionSearchQueryDto,
} from './dto/region-selection.dto'
import type { RegionDto, RegionPageDto } from './dto/region.dto'
import {
  readRegionById,
  readRegionNavigation,
  readRegionPage,
} from './region-management-query.persistence'
import { normalizeRegionSearchText } from './region.normalizer'

interface RegionNode {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  level: RegionLevelValue
  enabled: boolean
}

interface RegionWithChildCount extends RegionNode {
  _count: {
    children: number
  }
}

interface RegionAncestry extends RegionNode {
  parent: (RegionNode & {
    parent: RegionNode | null
  }) | null
}

interface RegionPathRecord extends RegionNode {
  parent: (RegionNode & {
    parent: RegionNode | null
  }) | null
}

interface RegionSearchRow {
  countryId: string
  countryParentId: string | null
  countryCode: string
  countryName: string
  countryEnglishName: string | null
  countryLevel: RegionLevelValue
  countryEnabled: boolean
  countrySortOrder: number
  provinceId: string
  provinceParentId: string
  provinceCode: string
  provinceName: string
  provinceEnglishName: string | null
  provinceLevel: RegionLevelValue
  provinceEnabled: boolean
  provinceSortOrder: number
  cityId: string
  cityParentId: string
  cityCode: string
  cityName: string
  cityEnglishName: string | null
  cityLevel: RegionLevelValue
  cityEnabled: boolean
  citySortOrder: number
}

const STABLE_REGION_ORDER: Prisma.RegionOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { normalizedName: 'asc' },
  { id: 'asc' },
]

const REGION_NODE_SELECT = {
  id: true,
  parentId: true,
  code: true,
  name: true,
  englishName: true,
  level: true,
  enabled: true,
} as const

const REGION_OPTION_SELECT = {
  ...REGION_NODE_SELECT,
  _count: {
    select: {
      children: {
        where: { enabled: true },
      },
    },
  },
} as const

function regionException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function toOption(
  region: RegionWithChildCount,
): RegionOptionDto {
  return {
    id: region.id,
    parentId: region.parentId,
    code: region.code,
    name: region.name,
    englishName: region.englishName,
    level: region.level,
    enabled: region.enabled,
    effectiveEnabled: true,
    hasChildren: region._count.children > 0,
  }
}

function toPathNode(
  region: RegionNode,
  effectiveEnabled: boolean,
  hasChildren: boolean,
): RegionPathNodeDto {
  return {
    id: region.id,
    parentId: region.parentId,
    code: region.code,
    name: region.name,
    englishName: region.englishName,
    level: region.level,
    enabled: region.enabled,
    effectiveEnabled,
    hasChildren,
  }
}

function isEffective(region: RegionAncestry): boolean {
  return region.enabled
    && (region.parent?.enabled ?? true)
    && (region.parent?.parent?.enabled ?? true)
}

function assertThreeLevelCityPath(
  city: RegionPathRecord,
): {
  city: RegionNode
  country: RegionNode
  province: RegionNode
} {
  const province = city.parent
  const country = province?.parent

  if (
    city.level !== RegionLevel.CITY
    || province?.level !== RegionLevel.PROVINCE_STATE
    || country?.level !== RegionLevel.COUNTRY_REGION
    || country.parentId !== null
  ) {
    // 数据库约束应保证该分支不可达；固定错误交由全局边界安全映射为 500。
    throw new Error('Region hierarchy invariant violated')
  }

  return { city, country, province }
}

/**
 * 地区读取保持在同一只读服务中：业务选择器只接触有效 options/search，
 * 历史 path 明确保留停用节点；管理读取则返回 own/effective 两类状态和来源字段。
 */
@Injectable()
export class RegionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async navigation(): Promise<RegionNavigationNodeDto[]> {
    return readRegionNavigation(this.prisma)
  }

  async list(
    query: Readonly<Partial<RegionListQueryDto>>,
  ): Promise<RegionPageDto> {
    return readRegionPage(this.prisma, query)
  }

  async getById(regionId: string): Promise<RegionDto> {
    return readRegionById(this.prisma, regionId)
  }

  async options(
    query: RegionOptionsQueryDto,
  ): Promise<RegionOptionDto[]> {
    if (query.parentId === undefined) {
      const roots = await this.prisma.region.findMany({
        where: {
          parentId: null,
          enabled: true,
        },
        select: REGION_OPTION_SELECT,
        orderBy: STABLE_REGION_ORDER,
      })
      return roots.map(toOption)
    }

    const parent = await this.prisma.region.findUnique({
      where: { id: query.parentId },
      select: {
        ...REGION_NODE_SELECT,
        parent: {
          select: {
            ...REGION_NODE_SELECT,
            parent: {
              select: REGION_NODE_SELECT,
            },
          },
        },
      },
    })

    if (!parent) {
      throw regionException(
        HttpStatus.NOT_FOUND,
        'REGION_PARENT_NOT_FOUND',
        '上级地区不存在',
      )
    }

    if (parent.level === RegionLevel.CITY) {
      throw regionException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'REGION_HIERARCHY_INVALID',
        '地区层级关系不合法',
      )
    }

    if (!isEffective(parent)) {
      return []
    }

    const children = await this.prisma.region.findMany({
      where: {
        parentId: parent.id,
        enabled: true,
      },
      select: REGION_OPTION_SELECT,
      orderBy: STABLE_REGION_ORDER,
    })
    return children.map(toOption)
  }

  async search(
    query: RegionSearchQueryDto,
  ): Promise<RegionSearchResponseDto> {
    const normalizedQuery = normalizeRegionSearchText(query.query)
    const codeQuery = normalizedQuery.toLocaleUpperCase('en-US')
    const boundedRows = await this.prisma.$queryRaw<RegionSearchRow[]>(
      Prisma.sql`
        SELECT
          country."id" AS "countryId",
          country."parent_id" AS "countryParentId",
          country."code" AS "countryCode",
          country."name" AS "countryName",
          country."english_name" AS "countryEnglishName",
          country."level"::text AS "countryLevel",
          country."enabled" AS "countryEnabled",
          country."sort_order" AS "countrySortOrder",
          province."id" AS "provinceId",
          province."parent_id" AS "provinceParentId",
          province."code" AS "provinceCode",
          province."name" AS "provinceName",
          province."english_name" AS "provinceEnglishName",
          province."level"::text AS "provinceLevel",
          province."enabled" AS "provinceEnabled",
          province."sort_order" AS "provinceSortOrder",
          city."id" AS "cityId",
          city."parent_id" AS "cityParentId",
          city."code" AS "cityCode",
          city."name" AS "cityName",
          city."english_name" AS "cityEnglishName",
          city."level"::text AS "cityLevel",
          city."enabled" AS "cityEnabled",
          city."sort_order" AS "citySortOrder"
        FROM "regions" AS city
        JOIN "regions" AS province
          ON province."id" = city."parent_id"
          AND province."level" = 'PROVINCE_STATE'::"region_level"
        JOIN "regions" AS country
          ON country."id" = province."parent_id"
          AND country."level" = 'COUNTRY_REGION'::"region_level"
        CROSS JOIN LATERAL (
          SELECT min(
            CASE
              WHEN candidate = ${normalizedQuery}
                OR candidate = ${codeQuery}
                THEN 0
              WHEN strpos(candidate, ${normalizedQuery}) = 1
                OR strpos(candidate, ${codeQuery}) = 1
                THEN 1
              WHEN strpos(candidate, ${normalizedQuery}) > 0
                OR strpos(candidate, ${codeQuery}) > 0
                THEN 2
              ELSE 3
            END
          ) AS rank
          FROM unnest(ARRAY[
            city."normalized_name",
            lower(COALESCE(city."english_name", '')),
            city."code",
            province."normalized_name",
            lower(COALESCE(province."english_name", '')),
            province."code",
            country."normalized_name",
            lower(COALESCE(country."english_name", '')),
            country."code"
          ]) AS searchable(candidate)
        ) AS hit
        WHERE city."level" = 'CITY'::"region_level"
          AND city."enabled" = true
          AND province."enabled" = true
          AND country."enabled" = true
          AND hit.rank < 3
        ORDER BY
          hit.rank ASC,
          country."sort_order" ASC,
          country."normalized_name" ASC,
          country."id" ASC,
          province."sort_order" ASC,
          province."normalized_name" ASC,
          province."id" ASC,
          city."sort_order" ASC,
          city."normalized_name" ASC,
          city."id" ASC
        LIMIT ${query.limit + 1}
      `,
    )
    const hasMore = boundedRows.length > query.limit
    const items = boundedRows
      .slice(0, query.limit)
      .map((row) => {
        const country = toPathNode(
          {
            id: row.countryId,
            parentId: row.countryParentId,
            code: row.countryCode,
            name: row.countryName,
            englishName: row.countryEnglishName,
            level: row.countryLevel,
            enabled: row.countryEnabled,
          },
          true,
          true,
        )
        const province = toPathNode(
          {
            id: row.provinceId,
            parentId: row.provinceParentId,
            code: row.provinceCode,
            name: row.provinceName,
            englishName: row.provinceEnglishName,
            level: row.provinceLevel,
            enabled: row.provinceEnabled,
          },
          true,
          true,
        )
        const city = toPathNode(
          {
            id: row.cityId,
            parentId: row.cityParentId,
            code: row.cityCode,
            name: row.cityName,
            englishName: row.cityEnglishName,
            level: row.cityLevel,
            enabled: row.cityEnabled,
          },
          true,
          false,
        )

        const path: RegionSearchItemDto['path'] = [
          country,
          province,
          city,
        ]

        return {
          cityId: row.cityId,
          path,
        }
      })

    return {
      items,
      limit: query.limit,
      hasMore,
    }
  }

  async path(cityId: string): Promise<RegionPathDto> {
    const candidate = await this.prisma.region.findUnique({
      where: { id: cityId },
      select: {
        ...REGION_NODE_SELECT,
        parent: {
          select: {
            ...REGION_NODE_SELECT,
            parent: {
              select: REGION_NODE_SELECT,
            },
          },
        },
      },
    })

    if (!candidate) {
      throw regionException(
        HttpStatus.NOT_FOUND,
        'REGION_NOT_FOUND',
        '地区不存在',
      )
    }

    if (candidate.level !== RegionLevel.CITY) {
      throw regionException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'REGION_VALUE_NOT_CITY',
        '地区值必须是城市',
      )
    }

    const { country, province, city } =
      assertThreeLevelCityPath(candidate)
    const countryEffective = country.enabled
    const provinceEffective = countryEffective && province.enabled
    const cityEffective = provinceEffective && city.enabled

    return {
      cityId: city.id,
      path: [
        toPathNode(country, countryEffective, true),
        toPathNode(province, provinceEffective, true),
        toPathNode(city, cityEffective, false),
      ],
    }
  }
}
