import { HttpStatus } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { DictionaryTone } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DictionaryQueryService } from './dictionary-query.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({
    applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
  }),
)

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)

const FIRST_TYPE_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const SECOND_TYPE_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const FIRST_ITEM_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'

interface CatalogItemRow {
  readonly value: string
  readonly label: string
  readonly tone: DictionaryTone
  readonly enabled: boolean
  readonly sortOrder: number
  readonly [key: string]: unknown
}

interface CatalogTypeRow {
  readonly code: string
  readonly name: string
  readonly enabled: boolean
  readonly items: CatalogItemRow[]
  readonly [key: string]: unknown
}

type FindManyMock = jest.Mock<Promise<unknown[]>, [unknown]>

interface CatalogTransactionClient {
  readonly dictionaryType: { readonly findMany: FindManyMock }
}

type TransactionOperation = (
  transaction: CatalogTransactionClient,
) => Promise<unknown>

type TransactionMock = jest.Mock<
  Promise<unknown>,
  [TransactionOperation, unknown?]
>

function catalogItemRow(
  overrides: Partial<CatalogItemRow> = {},
): CatalogItemRow {
  return {
    value: 'PENDING',
    label: '待处理',
    tone: DictionaryTone.WARNING,
    enabled: true,
    sortOrder: 10,
    id: FIRST_ITEM_ID,
    description: 'must-not-leak Item description',
    version: 9,
    createdAt: new Date('2026-08-03T01:00:00.000Z'),
    updatedAt: new Date('2026-08-03T02:00:00.000Z'),
    ...overrides,
  }
}

function catalogTypeRow(
  overrides: Partial<CatalogTypeRow> = {},
): CatalogTypeRow {
  return {
    code: 'order.status',
    name: '订单状态',
    enabled: true,
    items: [catalogItemRow()],
    id: FIRST_TYPE_ID,
    description: 'must-not-leak Type description',
    version: 7,
    itemCount: 1,
    createdAt: new Date('2026-08-03T01:00:00.000Z'),
    updatedAt: new Date('2026-08-03T02:00:00.000Z'),
    ...overrides,
  }
}

function createFixture(): {
  readonly service: DictionaryQueryService
  readonly transaction: TransactionMock
  readonly transactionClient: CatalogTransactionClient
} {
  const transactionClient = {
    dictionaryType: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>(),
    },
  }
  const transaction = jest.fn<
    Promise<unknown>,
    [TransactionOperation, unknown?]
  >(async (operation, options) => {
    void options
    return operation(transactionClient)
  })
  const prisma = { $transaction: transaction } as unknown as PrismaService

  return {
    service: new DictionaryQueryService(prisma),
    transaction,
    transactionClient,
  }
}

async function expectApiException(
  action: () => Promise<unknown>,
  status: HttpStatus,
  code: string,
  sensitiveValue?: string,
): Promise<void> {
  let thrown: unknown
  try {
    await action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  const exception = thrown as ApiException
  expect(exception.getStatus()).toBe(status)
  expect(exception.code).toBe(code)
  if (sensitiveValue !== undefined) {
    expect(JSON.stringify(exception.getResponse())).not.toContain(
      sensitiveValue,
    )
  }
}

describe('DictionaryQueryService Consumer Catalog', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('returns every Item from a disabled Type with a strict Catalog whitelist', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findMany.mockResolvedValue([
      catalogTypeRow({
        enabled: false,
        items: [
          catalogItemRow(),
          catalogItemRow({
            value: 'CANCELLED',
            label: '已取消',
            tone: DictionaryTone.DANGER,
            enabled: false,
            sortOrder: 20,
          }),
        ],
      }),
    ])

    await expect(
      fixture.service.getCatalogByCode(' Order.Status '),
    ).resolves.toEqual({
      code: 'order.status',
      name: '订单状态',
      enabled: false,
      items: [
        {
          value: 'PENDING',
          label: '待处理',
          tone: DictionaryTone.WARNING,
          enabled: true,
          effectiveEnabled: false,
          sortOrder: 10,
        },
        {
          value: 'CANCELLED',
          label: '已取消',
          tone: DictionaryTone.DANGER,
          enabled: false,
          effectiveEnabled: false,
          sortOrder: 20,
        },
      ],
    })

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(
      fixture.transactionClient,
    )
    expect(fixture.transactionClient.dictionaryType.findMany)
      .toHaveBeenCalledWith({
        where: { code: { in: ['order.status'] } },
        select: {
          code: true,
          name: true,
          enabled: true,
          items: {
            orderBy: [
              { sortOrder: 'asc' },
              { value: 'asc' },
              { id: 'asc' },
            ],
            select: {
              value: true,
              label: true,
              tone: true,
              enabled: true,
              sortOrder: true,
            },
          },
        },
      })

    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.transactionClient.dictionaryType.findMany
        .mock.invocationCallOrder[0] ?? 0,
    )
    const serialized = JSON.stringify(
      await fixture.service.getCatalogByCode('order.status'),
    )
    for (const forbidden of [
      'id',
      'description',
      'version',
      'createdAt',
      'updatedAt',
      'itemCount',
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`)
    }
  })

  it('returns Type not-found for a missing single Catalog', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findMany.mockResolvedValue([])

    await expectApiException(
      () => fixture.service.getCatalogByCode('missing.catalog'),
      HttpStatus.NOT_FOUND,
      'DICTIONARY_TYPE_NOT_FOUND',
    )
  })

  it('keeps found and missing batch results in normalized request order', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findMany.mockResolvedValue([
      catalogTypeRow({
        id: SECOND_TYPE_ID,
        code: 'shipping.method',
        name: '配送方式',
        enabled: false,
        items: [],
      }),
      catalogTypeRow({
        items: [
          catalogItemRow(),
          catalogItemRow({
            value: 'CANCELLED',
            label: '已取消',
            tone: DictionaryTone.DANGER,
            enabled: false,
            sortOrder: 20,
          }),
        ],
      }),
    ])

    await expect(fixture.service.listCatalogs([
      ' Shipping.Method ',
      'ORDER.STATUS',
      ' Payment.Mode ',
    ])).resolves.toEqual({
      dictionaries: [
        {
          code: 'shipping.method',
          name: '配送方式',
          enabled: false,
          items: [],
        },
        {
          code: 'order.status',
          name: '订单状态',
          enabled: true,
          items: [
            expect.objectContaining({
              value: 'PENDING',
              effectiveEnabled: true,
            }),
            expect.objectContaining({
              value: 'CANCELLED',
              effectiveEnabled: false,
            }),
          ],
        },
      ],
      missingCodes: ['payment.mode'],
    })

    expect(fixture.transactionClient.dictionaryType.findMany)
      .toHaveBeenCalledWith(expect.objectContaining({
        where: {
          code: {
            in: [
              'shipping.method',
              'order.status',
              'payment.mode',
            ],
          },
        },
      }))
  })

  it('accepts exactly twenty batch codes and reports all missing in order', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findMany.mockResolvedValue([])
    const codes = Array.from(
      { length: 20 },
      (_unused, index) => `group.code_${index}`,
    )

    await expect(fixture.service.listCatalogs(codes)).resolves.toEqual({
      dictionaries: [],
      missingCodes: codes,
    })
  })

  it.each([
    ['invalid single code', (service: DictionaryQueryService) =>
      service.getCatalogByCode('not valid')],
    ['empty batch', (service: DictionaryQueryService) =>
      service.listCatalogs([])],
    ['normalized duplicate', (service: DictionaryQueryService) =>
      service.listCatalogs(['order.status', ' ORDER.STATUS '])],
    ['more than twenty', (service: DictionaryQueryService) =>
      service.listCatalogs(Array.from(
        { length: 21 },
        (_unused, index) => `group.code_${index}`,
      ))],
  ] as const)(
    'rejects %s before opening a snapshot',
    async (_caseName, action) => {
      const fixture = createFixture()

      await expectApiException(
        () => action(fixture.service),
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
      )
      expect(fixture.transaction).not.toHaveBeenCalled()
    },
  )

  it('fails closed instead of exposing an undeclared Catalog conflict', async () => {
    const fixture = createFixture()
    const sensitiveValue = 'must-not-leak Catalog database state'
    fixture.transaction.mockRejectedValue({
      code: 'P2034',
      message: sensitiveValue,
    })

    await expectApiException(
      () => fixture.service.getCatalogByCode('order.status'),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      sensitiveValue,
    )
  })
})
