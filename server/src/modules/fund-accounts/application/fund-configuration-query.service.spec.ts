import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { FundConfigurationQueryService } from './fund-configuration-query.service'
import { FundPostingError } from './fund-posting.errors'

const TYPE_ID = '22222222-2222-4222-a222-222222222222'
const ACTIVE_RULE_ID = '33333333-3333-4333-a333-333333333333'
const DRAFT_RULE_ID = '44444444-4444-4444-a444-444444444444'
const SOURCE_ID = '55555555-5555-4555-a555-555555555555'

function ruleRow(id: string, revision: number, status: 'DRAFT' | 'ACTIVE') {
  return {
    id,
    revision,
    status,
    createdByUserId: null,
    publishedByUserId: status === 'ACTIVE'
      ? '11111111-1111-4111-a111-111111111111'
      : null,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    publishedAt: status === 'ACTIVE'
      ? new Date('2026-08-18T01:00:00.000Z')
      : null,
    legs: [{
      id: `${revision}6666666-6666-4666-a666-666666666666`,
      position: 1,
      accountTarget: 'COMPANY' as const,
      directionPolicy: 'DEBIT' as const,
      amountStrategy: 'FULL_AMOUNT' as const,
      adjustmentMode: null,
    }],
  }
}

function postingTypeRow() {
  return {
    id: TYPE_ID,
    code: 'RENT_UTILITIES',
    name: '房租水电',
    description: null,
    businessCategory: 'COST' as const,
    requiresUser: false,
    amountSignPolicy: 'POSITIVE_ONLY' as const,
    inputMode: 'STANDARD' as const,
    enabled: true,
    currentRuleVersionId: ACTIVE_RULE_ID,
    version: 3,
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T02:00:00.000Z'),
    currentRuleVersion: ruleRow(ACTIVE_RULE_ID, 1, 'ACTIVE'),
    ruleVersions: [ruleRow(DRAFT_RULE_ID, 2, 'DRAFT')],
  }
}

describe('FundConfigurationQueryService', () => {
  it('lists posting types with filters, active/DRAFT rules and stable ordering', async () => {
    const fundPostingType = {
      findMany: jest.fn().mockResolvedValue([postingTypeRow()]),
      count: jest.fn().mockResolvedValue(1),
    }
    const service = new FundConfigurationQueryService({
      fundPostingType,
    } as unknown as PrismaService)

    const result = await service.listPostingTypes({
      page: 2,
      pageSize: 5,
      search: '房租',
      businessCategory: 'COST',
      enabled: true,
      sortBy: 'code',
      sortOrder: 'asc',
    })

    expect(result).toMatchObject({
      page: 2,
      pageSize: 5,
      total: 1,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: TYPE_ID,
      code: 'RENT_UTILITIES',
      name: '房租水电',
      description: null,
      businessCategory: 'COST',
      requiresUser: false,
      amountSignPolicy: 'POSITIVE_ONLY',
      inputMode: 'STANDARD',
      enabled: true,
      currentRuleVersionId: ACTIVE_RULE_ID,
      version: 3,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T02:00:00.000Z',
    })
    expect(result.items[0]?.activeRule).toMatchObject({
      id: ACTIVE_RULE_ID,
      revision: 1,
      status: 'ACTIVE',
    })
    expect(result.items[0]?.draftRule).toMatchObject({
      id: DRAFT_RULE_ID,
      revision: 2,
      status: 'DRAFT',
    })
    expect(fundPostingType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        where: {
          businessCategory: 'COST',
          enabled: true,
          OR: [
            { code: { contains: '房租', mode: 'insensitive' } },
            { name: { contains: '房租', mode: 'insensitive' } },
          ],
        },
      }),
    )
  })

  it('lists sources with allowed types and stable default ordering', async () => {
    const fundBusinessSource = {
      findMany: jest.fn().mockResolvedValue([{
        id: SOURCE_ID,
        code: 'ORDER_DOMAIN',
        name: '订单域',
        description: '订单结算调用方',
        enabled: true,
        version: 2,
        createdAt: new Date('2026-08-18T00:00:00.000Z'),
        updatedAt: new Date('2026-08-18T01:00:00.000Z'),
        allowedPostingTypes: [{
          createdAt: new Date('2026-08-18T00:30:00.000Z'),
          postingType: {
            id: TYPE_ID,
            code: 'ORDER_SETTLEMENT',
            name: '订单结算',
            businessCategory: 'REVENUE',
            enabled: true,
          },
        }],
      }]),
      count: jest.fn().mockResolvedValue(1),
    }
    const service = new FundConfigurationQueryService({
      fundBusinessSource,
    } as unknown as PrismaService)

    const result = await service.listBusinessSources({ search: '订单' })

    expect(result.items[0]).toEqual(expect.objectContaining({
      id: SOURCE_ID,
      code: 'ORDER_DOMAIN',
      allowedPostingTypes: [{
        id: TYPE_ID,
        code: 'ORDER_SETTLEMENT',
        name: '订单结算',
        businessCategory: 'REVENUE',
        enabled: true,
        allowedAt: '2026-08-18T00:30:00.000Z',
      }],
    }))
    expect(fundBusinessSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('fails closed without leaking persistence details', async () => {
    const service = new FundConfigurationQueryService({
      fundPostingType: {
        findMany: jest.fn().mockRejectedValue(new Error('secret SQL detail')),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService)

    const promise = service.listPostingTypes({})
    await expect(promise).rejects.toBeInstanceOf(FundPostingError)
    await expect(promise).rejects.toMatchObject({
      code: 'FUND_INTERNAL_ERROR',
      message: '资金服务内部错误',
    })
  })
})
