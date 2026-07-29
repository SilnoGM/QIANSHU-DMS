import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { CurrencyStatusFilter } from './dto/currency-management.dto'
import { CurrencyQueryService } from './currency-query.service'

const CNY_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const USD_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'

interface CurrencyRow {
  id: string
  code: string
  name: string
  englishName: string | null
  symbol: string | null
  minorUnit: number
  enabled: boolean
  sortOrder: number
  version: number
  createdAt: Date
  updatedAt: Date
  exchangeRate: { id: string } | null
}

interface CurrencyPrismaFixture {
  service: CurrencyQueryService
  count: jest.Mock
  findMany: jest.Mock
  findUnique: jest.Mock
}

function currencyRow(
  overrides: Partial<CurrencyRow> = {},
): CurrencyRow {
  return {
    id: USD_ID,
    code: 'USD',
    name: '美元',
    englishName: 'US Dollar',
    symbol: '$',
    minorUnit: 2,
    enabled: false,
    sortOrder: 40,
    version: 3,
    createdAt: new Date('2026-07-29T01:00:00.000Z'),
    updatedAt: new Date('2026-07-29T02:00:00.000Z'),
    exchangeRate: { id: '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3' },
    ...overrides,
  }
}

function createFixture(): CurrencyPrismaFixture {
  const count = jest.fn()
  const findMany = jest.fn()
  const findUnique = jest.fn()
  const prisma = {
    currency: {
      count,
      findMany,
      findUnique,
    },
  } as unknown as PrismaService

  return {
    service: new CurrencyQueryService(prisma),
    count,
    findMany,
    findUnique,
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

describe('CurrencyQueryService catalog', () => {
  it('returns enabled and disabled currencies in one stable catalog', async () => {
    const fixture = createFixture()
    fixture.findMany.mockResolvedValue([
      currencyRow({
        id: CNY_ID,
        code: 'CNY',
        name: '人民币',
        englishName: 'Chinese Yuan',
        symbol: '¥',
        enabled: true,
        sortOrder: 10,
        exchangeRate: null,
      }),
      currencyRow(),
    ])

    await expect(fixture.service.catalog()).resolves.toEqual([
      {
        id: CNY_ID,
        code: 'CNY',
        name: '人民币',
        englishName: 'Chinese Yuan',
        symbol: '¥',
        minorUnit: 2,
        enabled: true,
        isBase: true,
        sortOrder: 10,
      },
      {
        id: USD_ID,
        code: 'USD',
        name: '美元',
        englishName: 'US Dollar',
        symbol: '$',
        minorUnit: 2,
        enabled: false,
        isBase: false,
        sortOrder: 40,
      },
    ])

    expect(fixture.findMany).toHaveBeenCalledWith({
      orderBy: [
        { sortOrder: 'asc' },
        { code: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        code: true,
        name: true,
        englishName: true,
        symbol: true,
        minorUnit: true,
        enabled: true,
        sortOrder: true,
      },
    })
  })
})

describe('CurrencyQueryService management reads', () => {
  it('uses one normalized filter for total and stable page rows', async () => {
    const fixture = createFixture()
    fixture.count.mockResolvedValue(1)
    fixture.findMany.mockResolvedValue([currencyRow()])

    await expect(fixture.service.list({
      query: '  us   dollar ',
      status: CurrencyStatusFilter.DISABLED,
      page: 2,
      pageSize: 1,
    })).resolves.toEqual({
      items: [
        {
          id: USD_ID,
          code: 'USD',
          name: '美元',
          englishName: 'US Dollar',
          symbol: '$',
          minorUnit: 2,
          enabled: false,
          isBase: false,
          sortOrder: 40,
          exchangeRateConfigured: true,
          version: 3,
          createdAt: '2026-07-29T01:00:00.000Z',
          updatedAt: '2026-07-29T02:00:00.000Z',
        },
      ],
      page: 2,
      pageSize: 1,
      total: 1,
    })

    const expectedWhere = {
      enabled: false,
      OR: [
        {
          code: {
            contains: 'US DOLLAR',
            mode: 'insensitive',
          },
        },
        {
          name: {
            contains: 'us dollar',
            mode: 'insensitive',
          },
        },
        {
          englishName: {
            contains: 'us dollar',
            mode: 'insensitive',
          },
        },
      ],
    }
    expect(fixture.count).toHaveBeenCalledWith({
      where: expectedWhere,
    })
    expect(fixture.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        orderBy: [
          { sortOrder: 'asc' },
          { code: 'asc' },
          { id: 'asc' },
        ],
        skip: 1,
        take: 1,
      }),
    )
  })

  it('derives the fixed base flag and exchange-rate state on detail', async () => {
    const fixture = createFixture()
    fixture.findUnique.mockResolvedValue(currencyRow({
      id: CNY_ID,
      code: 'CNY',
      name: '人民币',
      englishName: null,
      symbol: '¥',
      enabled: true,
      sortOrder: 10,
      version: 1,
      exchangeRate: null,
    }))

    await expect(fixture.service.getById(CNY_ID)).resolves.toMatchObject({
      id: CNY_ID,
      code: 'CNY',
      isBase: true,
      exchangeRateConfigured: false,
      createdAt: '2026-07-29T01:00:00.000Z',
      updatedAt: '2026-07-29T02:00:00.000Z',
    })
    expect(fixture.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CNY_ID } }),
    )
  })

  it('rejects invalid direct list input and reports a stable missing code', async () => {
    const fixture = createFixture()
    fixture.findUnique.mockResolvedValue(null)

    await expectApiException(
      () => fixture.service.list({
        query: '　 ',
        page: 1,
        pageSize: 20,
      }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    await expectApiException(
      () => fixture.service.getById(USD_ID),
      HttpStatus.NOT_FOUND,
      'CURRENCY_NOT_FOUND',
    )
  })
})

describe('CurrencyQueryService safe failures', () => {
  it.each([
    ['catalog', (service: CurrencyQueryService) => service.catalog()],
    ['list', (service: CurrencyQueryService) => service.list({})],
    ['get', (service: CurrencyQueryService) => service.getById(USD_ID)],
  ])('maps unexpected %s failures without leaking driver details', async (
    _caseName,
    action,
  ) => {
    const fixture = createFixture()
    fixture.count.mockRejectedValue(new Error('secret SQL'))
    fixture.findMany.mockRejectedValue(new Error('secret SQL'))
    fixture.findUnique.mockRejectedValue(new Error('secret SQL'))

    await expectApiException(
      () => action(fixture.service),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})
