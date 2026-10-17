import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import type {
  FundAccountListQuery,
  FundAccountOwnerCandidates,
  FundAccountPage,
  FundAccountSortField,
  FundAccountSortOrder,
  FundSelfAccountResponse,
} from './fund-account.contract'
import {
  FUND_ACCOUNT_VIEW_SELECT,
  mapFundAccountView,
} from './fund-account.mapper'
import { mapFundSelfAccountView } from './fund-self.mapper'
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

  /**
   * 运营本人账户：user_id 唯一索引保证最多一条，未开户返回 account: null。
   *
   * 这里只读取 USER 账户；公司账户没有 user_id，不可能被本查询命中。
   */
  async getOwnAccount(userId: string): Promise<FundSelfAccountResponse> {
    try {
      const row = await this.prisma.fundAccount.findUnique({
        where: { userId },
        select: FUND_ACCOUNT_VIEW_SELECT,
      })
      if (row === null) {
        return Object.freeze({ account: null })
      }

      return Object.freeze({
        account: mapFundSelfAccountView(mapFundAccountView(row)),
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }

  /**
   * 新建账户的候选归属人：还没有 USER 账户的用户，按展示名稳定排序。
   *
   * 该查询只服务于资金域的下拉选择，因此不返回用户档案等资金域无关字段，
   * 让财务角色无需用户管理读取权限即可开立账户。
   */
  async listOwnerCandidates(): Promise<FundAccountOwnerCandidates> {
    try {
      const rows = await this.prisma.user.findMany({
        where: { fundAccount: { is: null } },
        select: {
          id: true,
          username: true,
          displayName: true,
          status: true,
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      })

      return Object.freeze({
        items: Object.freeze(rows.map(row => Object.freeze({
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          status: row.status,
        }))),
      })
    }
    catch (error) {
      if (error instanceof FundPostingError) throw error
      throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
    }
  }
}
