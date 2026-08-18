import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { FundAccountQueryService } from './fund-account-query.service'
import { FundPostingError } from './fund-posting.errors'

const USER_ID = '22222222-2222-4222-a222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-a333-333333333333'

function userAccountRow() {
  return {
    id: ACCOUNT_ID,
    ownerType: 'USER' as const,
    userId: USER_ID,
    currency: 'CNY',
    balance: new Prisma.Decimal('-12.3'),
    userShareRate: new Prisma.Decimal('30'),
    version: 2,
    shareRateUpdatedAt: new Date('2026-08-18T01:00:00.000Z'),
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T02:00:00.000Z'),
    user: {
      id: USER_ID,
      username: 'zhangsan',
      displayName: '张三',
      status: 'ACTIVE' as const,
    },
  }
}

describe('FundAccountQueryService', () => {
  it('returns decimal strings, derived company share and stable paging', async () => {
    const fundAccount = {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([userAccountRow()]),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    }
    const service = new FundAccountQueryService(
      { fundAccount } as unknown as PrismaService,
    )

    const result = await service.listAccounts({
      page: 2,
      pageSize: 10,
      ownerType: 'USER',
      search: ' 张三 ',
      sortBy: 'balance',
      sortOrder: 'asc',
    })

    expect(result).toEqual({
      items: [{
        id: ACCOUNT_ID,
        ownerType: 'USER',
        user: {
          id: USER_ID,
          username: 'zhangsan',
          displayName: '张三',
          status: 'ACTIVE',
        },
        currency: 'CNY',
        balance: '-12.3000',
        userShareRate: '30.0000',
        companyShareRate: '70.0000',
        version: 2,
        shareRateUpdatedAt: '2026-08-18T01:00:00.000Z',
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T02:00:00.000Z',
      }],
      page: 2,
      pageSize: 10,
      total: 1,
    })
    const findArguments = fundAccount.findMany.mock.calls[0]?.[0]
    expect(findArguments).toEqual(expect.objectContaining({
      skip: 10,
      take: 10,
      orderBy: [{ balance: 'asc' }, { id: 'asc' }],
    }))
    expect(findArguments).toHaveProperty('where.ownerType', 'USER')
    expect(findArguments).toHaveProperty('where.user.is.OR')
    expect(fundAccount.count.mock.calls[0]?.[0]).toHaveProperty(
      'where.ownerType',
      'USER',
    )
  })

  it('keeps company share fields null and uses explicit null ordering', async () => {
    const row = {
      ...userAccountRow(),
      ownerType: 'COMPANY' as const,
      userId: null,
      userShareRate: null,
      shareRateUpdatedAt: null,
      user: null,
    }
    const fundAccount = {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([row]),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    }
    const service = new FundAccountQueryService(
      { fundAccount } as unknown as PrismaService,
    )

    const result = await service.listAccounts({
      sortBy: 'userShareRate',
      sortOrder: 'desc',
    })

    expect(result.items[0]).toMatchObject({
      ownerType: 'COMPANY',
      user: null,
      userShareRate: null,
      companyShareRate: null,
    })
    expect(fundAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { userShareRate: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ],
    }))
  })

  it('fails closed without exposing Prisma details', async () => {
    const fundAccount = {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockRejectedValue(new Error('must-not-leak database detail')),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
    }
    const service = new FundAccountQueryService(
      { fundAccount } as unknown as PrismaService,
    )

    const promise = service.listAccounts({})
    await expect(promise).rejects.toBeInstanceOf(FundPostingError)
    await expect(promise).rejects.toMatchObject({
      code: 'FUND_INTERNAL_ERROR',
      message: '资金服务内部错误',
    })
  })
})
