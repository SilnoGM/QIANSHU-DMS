import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { ExchangeRateStatusFilter } from './dto/exchange-rate-management.dto'
import { ExchangeRateQueryService } from './exchange-rate-query.service'

const TWD_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const MYR_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const RATE_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'

type AsyncDatabaseMock = jest.Mock<Promise<unknown>, [unknown]>

interface PrismaFixture {
  currency: {
    count: AsyncDatabaseMock
    findMany: AsyncDatabaseMock
  }
  exchangeRate: {
    findUnique: AsyncDatabaseMock
  }
}

function decimal(value: string): { toString: () => string } {
  return { toString: () => value }
}

function currencyFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: TWD_ID,
    code: 'TWD',
    name: '新台币',
    englishName: 'New Taiwan Dollar',
    symbol: 'NT$',
    minorUnit: 2,
    enabled: false,
    sortOrder: 20,
    exchangeRate: {
      id: RATE_ID,
      currencyId: TWD_ID,
      foreignUnitsPerCny: decimal('4.800000000000'),
      version: 3,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    },
    ...overrides,
  }
}

function createServiceFixture(): {
  prisma: PrismaFixture
  service: ExchangeRateQueryService
} {
  const prisma: PrismaFixture = {
    currency: {
      count: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    exchangeRate: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
    },
  }

  return {
    prisma,
    service: new ExchangeRateQueryService(
      prisma as unknown as PrismaService,
    ),
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
  }
  catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiException)
    const apiError = error as ApiException
    expect(apiError.getStatus()).toBe(status)
    expect(apiError.code).toBe(code)
  }
}

describe('ExchangeRateQueryService list', () => {
  it('lists every non-CNY currency and preserves an unconfigured nullable rate', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.currency.count.mockResolvedValue(2)
    prisma.currency.findMany.mockResolvedValue([
      currencyFixture(),
      currencyFixture({
        id: MYR_ID,
        code: 'MYR',
        name: '马来西亚林吉特',
        englishName: 'Malaysian Ringgit',
        symbol: 'RM',
        sortOrder: 30,
        exchangeRate: null,
      }),
    ])

    await expect(service.list({})).resolves.toEqual({
      items: [
        {
          currency: {
            id: TWD_ID,
            code: 'TWD',
            name: '新台币',
            englishName: 'New Taiwan Dollar',
            symbol: 'NT$',
            minorUnit: 2,
            enabled: false,
            isBase: false,
            sortOrder: 20,
          },
          currentRate: {
            id: RATE_ID,
            currencyId: TWD_ID,
            foreignUnitsPerCny: '4.8',
            version: 3,
            createdAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
          },
        },
        {
          currency: {
            id: MYR_ID,
            code: 'MYR',
            name: '马来西亚林吉特',
            englishName: 'Malaysian Ringgit',
            symbol: 'RM',
            minorUnit: 2,
            enabled: false,
            isBase: false,
            sortOrder: 30,
          },
          currentRate: null,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    })

    expect(prisma.currency.count).toHaveBeenCalledWith({
      where: { code: { not: 'CNY' } },
    })
    expect(prisma.currency.findMany).toHaveBeenCalledWith(
      {
        where: { code: { not: 'CNY' } },
        orderBy: [
          { sortOrder: 'asc' },
          { code: 'asc' },
          { id: 'asc' },
        ],
        skip: 0,
        take: 20,
        select: {
          id: true,
          code: true,
          name: true,
          englishName: true,
          symbol: true,
          minorUnit: true,
          enabled: true,
          sortOrder: true,
          exchangeRate: {
            select: {
              id: true,
              currencyId: true,
              foreignUnitsPerCny: true,
              version: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    )
  })

  it('shares query/status filters between count and page with stable pagination', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.currency.count.mockResolvedValue(0)
    prisma.currency.findMany.mockResolvedValue([])

    await service.list({
      query: ' twd ',
      status: ExchangeRateStatusFilter.CONFIGURED,
      page: 3,
      pageSize: 10,
    })

    const where = {
      code: { not: 'CNY' },
      AND: [
        {
          OR: [
            { code: { contains: 'TWD' } },
            { name: { contains: 'twd', mode: 'insensitive' } },
            {
              englishName: {
                contains: 'twd',
                mode: 'insensitive',
              },
            },
          ],
        },
        { exchangeRate: { isNot: null } },
      ],
    }
    expect(prisma.currency.count).toHaveBeenCalledWith({ where })
    expect(prisma.currency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 20,
        take: 10,
      }),
    )
  })

  it('filters explicitly for currencies without a current rate', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.currency.count.mockResolvedValue(0)
    prisma.currency.findMany.mockResolvedValue([])

    await service.list({
      status: ExchangeRateStatusFilter.UNCONFIGURED,
    })

    expect(prisma.currency.count).toHaveBeenCalledWith({
      where: {
        code: { not: 'CNY' },
        AND: [{ exchangeRate: { is: null } }],
      },
    })
  })

  it('maps database failures to a fixed non-leaking internal error', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.currency.count.mockRejectedValue(
      new Error('postgres://user:secret@database'),
    )
    prisma.currency.findMany.mockResolvedValue([])

    await expectApiException(
      () => service.list({}),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})

describe('ExchangeRateQueryService getById', () => {
  it('returns a decimal string instead of a JavaScript number', async () => {
    const { prisma, service } = createServiceFixture()
    prisma.exchangeRate.findUnique.mockResolvedValue({
      id: RATE_ID,
      currencyId: TWD_ID,
      foreignUnitsPerCny: decimal('4.800000000000'),
      version: 3,
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    })

    await expect(service.getById(RATE_ID)).resolves.toEqual({
      id: RATE_ID,
      currencyId: TWD_ID,
      foreignUnitsPerCny: '4.8',
      version: 3,
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    })
    expect(prisma.exchangeRate.findUnique).toHaveBeenCalledWith(
      {
        where: { id: RATE_ID },
        select: {
          id: true,
          currencyId: true,
          foreignUnitsPerCny: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    )
  })

  it('separates missing rates from unexpected database failures', async () => {
    const missing = createServiceFixture()
    missing.prisma.exchangeRate.findUnique.mockResolvedValue(null)
    await expectApiException(
      () => missing.service.getById(RATE_ID),
      HttpStatus.NOT_FOUND,
      'EXCHANGE_RATE_NOT_FOUND',
    )

    const failed = createServiceFixture()
    failed.prisma.exchangeRate.findUnique.mockRejectedValue(
      new Error('driver detail'),
    )
    await expectApiException(
      () => failed.service.getById(RATE_ID),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})
