import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import type {
  FundBusinessSourceListQuery,
  FundBusinessSourcePage,
  FundBusinessSourceSortField,
  FundConfigurationSortOrder,
  FundPostingTypeListQuery,
  FundPostingTypePage,
  FundPostingTypeSortField,
} from './fund-configuration.contract'
import {
  FUND_BUSINESS_SOURCE_VIEW_SELECT,
  FUND_POSTING_TYPE_VIEW_SELECT,
  mapFundBusinessSourceView,
  mapFundPostingTypeView,
} from './fund-configuration.mapper'
import {
  normalizeFundBusinessSourceListQuery,
  normalizeFundPostingTypeListQuery,
  type NormalizedFundBusinessSourceListQuery,
  type NormalizedFundPostingTypeListQuery,
} from './fund-configuration.normalizer'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

function postingTypeOrderBy(
  sortBy: FundPostingTypeSortField,
  sortOrder: FundConfigurationSortOrder,
): Prisma.FundPostingTypeOrderByWithRelationInput[] {
  return [{ [sortBy]: sortOrder }, { id: sortOrder }]
}

function businessSourceOrderBy(
  sortBy: FundBusinessSourceSortField,
  sortOrder: FundConfigurationSortOrder,
): Prisma.FundBusinessSourceOrderByWithRelationInput[] {
  return [{ [sortBy]: sortOrder }, { id: sortOrder }]
}

function postingTypeWhere(
  query: NormalizedFundPostingTypeListQuery,
): Prisma.FundPostingTypeWhereInput {
  return {
    ...(query.businessCategory === null
      ? {}
      : { businessCategory: query.businessCategory }),
    ...(query.enabled === null ? {} : { enabled: query.enabled }),
    ...(query.search === null
      ? {}
      : {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }),
  }
}

function businessSourceWhere(
  query: NormalizedFundBusinessSourceListQuery,
): Prisma.FundBusinessSourceWhereInput {
  return {
    ...(query.enabled === null ? {} : { enabled: query.enabled }),
    ...(query.search === null
      ? {}
      : {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }),
  }
}

function requireSafeTotal(total: number): number {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
  }
  return total
}

/** 配置读取始终携带稳定 ID 次排序，并将数据库异常收敛为固定安全错误。 */
@Injectable()
export class FundConfigurationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listPostingTypes(
    input: FundPostingTypeListQuery,
  ): Promise<FundPostingTypePage> {
    try {
      const query = normalizeFundPostingTypeListQuery(input)
      const where = postingTypeWhere(query)
      const [rows, total] = await Promise.all([
        this.prisma.fundPostingType.findMany({
          where,
          select: FUND_POSTING_TYPE_VIEW_SELECT,
          orderBy: postingTypeOrderBy(query.sortBy, query.sortOrder),
          skip: query.skip,
          take: query.pageSize,
        }),
        this.prisma.fundPostingType.count({ where }),
      ])
      return Object.freeze({
        items: Object.freeze(rows.map(mapFundPostingTypeView)),
        page: query.page,
        pageSize: query.pageSize,
        total: requireSafeTotal(total),
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  async listBusinessSources(
    input: FundBusinessSourceListQuery,
  ): Promise<FundBusinessSourcePage> {
    try {
      const query = normalizeFundBusinessSourceListQuery(input)
      const where = businessSourceWhere(query)
      const [rows, total] = await Promise.all([
        this.prisma.fundBusinessSource.findMany({
          where,
          select: FUND_BUSINESS_SOURCE_VIEW_SELECT,
          orderBy: businessSourceOrderBy(query.sortBy, query.sortOrder),
          skip: query.skip,
          take: query.pageSize,
        }),
        this.prisma.fundBusinessSource.count({ where }),
      ])
      return Object.freeze({
        items: Object.freeze(rows.map(mapFundBusinessSourceView)),
        page: query.page,
        pageSize: query.pageSize,
        total: requireSafeTotal(total),
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }
}
