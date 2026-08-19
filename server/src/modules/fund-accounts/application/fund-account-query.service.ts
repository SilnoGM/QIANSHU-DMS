import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import type {
  FundAccountListQuery,
  FundAccountPage,
  FundAccountSortField,
  FundAccountSortOrder,
} from './fund-account.contract'
import {
  FUND_ACCOUNT_VIEW_SELECT,
  mapFundAccountView,
} from './fund-account.mapper'
import {
  normalizeFundAccountListQuery,
  type NormalizedFundAccountListQuery,
} from './fund-account.normalizer'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

function buildFundAccountOrderBy(
  sortBy: FundAccountSortField,
  sortOrder: FundAccountSortOrder,
): Prisma.FundAccountOrderByWithRelationInput[] {
  // PostgreSQL enum 顺序是 USER、COMPANY；降序可让公司账户在业务排序和分页前固定置顶。
  const companyFirstOrder: Prisma.FundAccountOrderByWithRelationInput = {
    ownerType: 'desc',
  }
  const stableIdOrder: Prisma.FundAccountOrderByWithRelationInput = {
    id: sortOrder,
  }

  if (sortBy === 'userShareRate') {
    return [
      companyFirstOrder,
      { userShareRate: { sort: sortOrder, nulls: 'last' } },
      stableIdOrder,
    ]
  }

  return [companyFirstOrder, { [sortBy]: sortOrder }, stableIdOrder]
}

function buildFundAccountWhere(
  query: NormalizedFundAccountListQuery,
): Prisma.FundAccountWhereInput {
  return {
    ...(query.ownerType === null ? {} : { ownerType: query.ownerType }),
    ...(query.search === null
      ? {}
      : {
          user: {
            is: {
              OR: [
                {
                  username: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  displayName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            },
          },
        }),
  }
}

/** 账户读取不返回 Prisma Decimal，并对底层异常统一使用固定安全错误。 */
@Injectable()
export class FundAccountQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listAccounts(input: FundAccountListQuery): Promise<FundAccountPage> {
    try {
      const query = normalizeFundAccountListQuery(input)
      const where = buildFundAccountWhere(query)
      const [rows, total] = await Promise.all([
        this.prisma.fundAccount.findMany({
          where,
          select: FUND_ACCOUNT_VIEW_SELECT,
          orderBy: buildFundAccountOrderBy(query.sortBy, query.sortOrder),
          skip: query.skip,
          take: query.pageSize,
        }),
        this.prisma.fundAccount.count({ where }),
      ])

      if (!Number.isSafeInteger(total) || total < 0) {
        throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
      }

      return Object.freeze({
        items: Object.freeze(rows.map(mapFundAccountView)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }
}
