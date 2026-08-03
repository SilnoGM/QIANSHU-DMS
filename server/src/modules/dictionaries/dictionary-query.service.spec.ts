import { HttpStatus } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { DictionaryTone } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  DictionaryItemSortBy,
  DictionarySortOrder,
  DictionaryStatusFilter,
  DictionaryTypeSortBy,
} from './dto/dictionary-management.dto'
import { DictionaryQueryService } from './dictionary-query.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({
    applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
  }),
)

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)

const TYPE_ID = '10ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const SECOND_TYPE_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const ITEM_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SECOND_ITEM_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f4'

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: unknown[]
}

interface DictionaryTypeRow {
  id: string
  code: string
  name: string
  description: string | null
  enabled: boolean
  sortOrder: number
  version: number
  createdAt: Date
  updatedAt: Date
}

interface DictionaryItemRow {
  id: string
  dictionaryTypeId: string
  value: string
  label: string
  description: string | null
  tone: DictionaryTone
  enabled: boolean
  sortOrder: number
  version: number
  createdAt: Date
  updatedAt: Date
}

type DatabaseMock = jest.Mock<Promise<unknown>, [unknown]>

interface TransactionClientFixture {
  $queryRaw: DatabaseMock
  dictionaryType: { findUnique: DatabaseMock }
  dictionaryItem: { findFirst: DatabaseMock }
}

type TransactionOperation = (
  transaction: TransactionClientFixture,
) => Promise<unknown>

type TransactionMock = jest.Mock<
  Promise<unknown>,
  [TransactionOperation, unknown?]
>

function getSqlShape(value: unknown): SqlShape {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected Prisma SQL object')
  }

  return value as unknown as SqlShape
}

function getSqlText(value: unknown): string {
  return getSqlShape(value).strings.join(' ')
}

function getSqlValues(value: unknown): unknown[] {
  return getSqlShape(value).values
}

function getOrderClause(value: unknown): string {
  const text = getSqlText(value)
  return text.slice(text.indexOf('ORDER BY'), text.indexOf('LIMIT'))
}

function typeRow(
  overrides: Partial<DictionaryTypeRow> = {},
): DictionaryTypeRow {
  return {
    id: TYPE_ID,
    code: 'order.status',
    name: '订单状态',
    description: null,
    enabled: true,
    sortOrder: 10,
    version: 2,
    createdAt: new Date('2026-08-03T01:00:00.000Z'),
    updatedAt: new Date('2026-08-03T02:00:00.000Z'),
    ...overrides,
  }
}

function itemRow(
  overrides: Partial<DictionaryItemRow> = {},
): DictionaryItemRow {
  return {
    id: ITEM_ID,
    dictionaryTypeId: TYPE_ID,
    value: 'PENDING',
    label: '待处理',
    description: null,
    tone: DictionaryTone.WARNING,
    enabled: true,
    sortOrder: 10,
    version: 3,
    createdAt: new Date('2026-08-03T03:00:00.000Z'),
    updatedAt: new Date('2026-08-03T04:00:00.000Z'),
    ...overrides,
  }
}

function createFixture(): {
  service: DictionaryQueryService
  transaction: TransactionMock
  transactionClient: TransactionClientFixture
} {
  const queryRaw = jest.fn<Promise<unknown>, [unknown]>()
  const typeFindUnique = jest.fn<Promise<unknown>, [unknown]>()
  const itemFindFirst = jest.fn<Promise<unknown>, [unknown]>()
  const transactionClient = {
    $queryRaw: queryRaw,
    dictionaryType: { findUnique: typeFindUnique },
    dictionaryItem: { findFirst: itemFindFirst },
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
    expect(JSON.stringify({
      code: exception.code,
      message: exception.publicMessage,
      response: exception.getResponse(),
    })).not.toContain(sensitiveValue)
  }
}

describe('DictionaryQueryService Type management reads', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('reads count, page rows and Item statistics in one timed RepeatableRead snapshot', async () => {
    const fixture = createFixture()
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        typeRow(),
        typeRow({
          id: SECOND_TYPE_ID,
          code: 'shipping.method',
          name: '配送方式',
          enabled: false,
          sortOrder: 20,
        }),
      ])
      .mockResolvedValueOnce([
        { dictionaryTypeId: TYPE_ID, itemCount: 3, enabledItemCount: 2 },
      ])

    await expect(fixture.service.listTypes({})).resolves.toEqual({
      items: [
        {
          id: TYPE_ID,
          code: 'order.status',
          name: '订单状态',
          description: null,
          enabled: true,
          sortOrder: 10,
          itemCount: 3,
          enabledItemCount: 2,
          version: 2,
          createdAt: '2026-08-03T01:00:00.000Z',
          updatedAt: '2026-08-03T02:00:00.000Z',
        },
        expect.objectContaining({
          id: SECOND_TYPE_ID,
          itemCount: 0,
          enabledItemCount: 0,
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    })

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(
      fixture.transactionClient,
    )
    expect(fixture.transactionClient.$queryRaw).toHaveBeenCalledTimes(3)

    const countSql = fixture.transactionClient.$queryRaw.mock.calls[0]?.[0]
    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    const statsSql = fixture.transactionClient.$queryRaw.mock.calls[2]?.[0]
    expect(getSqlText(countSql)).toContain('FROM "dictionary_types" AS target')
    expect(getOrderClause(rowsSql)).toContain(
      'target."sort_order" ASC, target."code" ASC, target."id" ASC',
    )
    expect(getSqlText(statsSql)).toContain('FROM "dictionary_items" AS item')
    expect(getSqlText(statsSql)).toContain('GROUP BY item."dictionary_type_id"')
    expect(getSqlText(statsSql).match(/CAST\(/gu)).toHaveLength(2)
    expect(getSqlValues(statsSql)).toEqual([TYPE_ID, SECOND_TYPE_ID])

    const timeoutOrder = mockedApplyTransactionTimeouts.mock.invocationCallOrder[0]
    const [countOrder, rowsOrder, statsOrder] =
      fixture.transactionClient.$queryRaw.mock.invocationCallOrder
    expect(timeoutOrder).toBeLessThan(countOrder ?? 0)
    expect(countOrder).toBeLessThan(rowsOrder ?? 0)
    expect(rowsOrder).toBeLessThan(statsOrder ?? 0)
  })

  it('uses case-insensitive literal substring filters and a whitelisted custom order', async () => {
    const fixture = createFixture()
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])

    await fixture.service.listTypes({
      query: '  %_\u3000Status  ',
      status: DictionaryStatusFilter.DISABLED,
      page: 2,
      pageSize: 10,
      sortBy: DictionaryTypeSortBy.NAME,
      sortOrder: DictionarySortOrder.DESC,
    })

    const countSql = fixture.transactionClient.$queryRaw.mock.calls[0]?.[0]
    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    for (const sql of [countSql, rowsSql]) {
      const text = getSqlText(sql)
      expect(text).toContain('strpos(lower(target."code"), lower(')
      expect(text).toContain('strpos(lower(target."name"), lower(')
      expect(text).toContain('lower(coalesce(target."description", \'\'))')
      expect(text).not.toMatch(/\b(?:LIKE|ILIKE)\b/u)
      expect(getSqlValues(sql)).toEqual(expect.arrayContaining([
        '%_ Status',
        false,
      ]))
    }
    expect(getOrderClause(rowsSql)).toContain(
      'target."name" DESC, target."code" ASC, target."id" ASC',
    )
    expect(getSqlValues(rowsSql)).toEqual(expect.arrayContaining([10, 10]))
  })

  it('does not duplicate the identity tie-breaker when code is primary sort', async () => {
    const fixture = createFixture()
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])

    await fixture.service.listTypes({
      sortBy: DictionaryTypeSortBy.CODE,
      sortOrder: DictionarySortOrder.DESC,
    })

    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    expect(getOrderClause(rowsSql)).toContain(
      'target."code" DESC, target."id" ASC',
    )
    expect(getOrderClause(rowsSql)).not.toContain('target."code" ASC')
  })

  it('returns Type detail with live Item statistics and hides missing resources', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findUnique.mockResolvedValue(
      typeRow(),
    )
    fixture.transactionClient.$queryRaw.mockResolvedValue([
      { dictionaryTypeId: TYPE_ID, itemCount: 5, enabledItemCount: 4 },
    ])

    await expect(fixture.service.getTypeById(TYPE_ID)).resolves.toEqual(
      expect.objectContaining({
        id: TYPE_ID,
        itemCount: 5,
        enabledItemCount: 4,
        createdAt: '2026-08-03T01:00:00.000Z',
      }),
    )
    expect(fixture.transactionClient.dictionaryType.findUnique)
      .toHaveBeenCalledWith(expect.objectContaining({
        where: { id: TYPE_ID },
      }))

    const missing = createFixture()
    missing.transactionClient.dictionaryType.findUnique.mockResolvedValue(null)
    await expectApiException(
      () => missing.service.getTypeById(TYPE_ID),
      HttpStatus.NOT_FOUND,
      'DICTIONARY_TYPE_NOT_FOUND',
    )
    expect(missing.transactionClient.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('DictionaryQueryService nested Item management reads', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it('derives effectiveEnabled from the parent in the same stable Item page snapshot', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findUnique.mockResolvedValue({
      id: TYPE_ID,
      enabled: false,
    })
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        itemRow(),
        itemRow({
          id: SECOND_ITEM_ID,
          value: 'SHIPPED',
          label: '已发货',
          enabled: false,
          sortOrder: 20,
        }),
      ])

    const result = await fixture.service.listItems(TYPE_ID, {})

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 2 })
    expect(result.items).toEqual([
      expect.objectContaining({
        id: ITEM_ID,
        enabled: true,
        effectiveEnabled: false,
        tone: DictionaryTone.WARNING,
        updatedAt: '2026-08-03T04:00:00.000Z',
      }),
      expect.objectContaining({
        id: SECOND_ITEM_ID,
        enabled: false,
        effectiveEnabled: false,
      }),
    ])
    expect(fixture.transactionClient.dictionaryType.findUnique)
      .toHaveBeenCalledWith(expect.objectContaining({
        where: { id: TYPE_ID },
        select: { id: true, enabled: true },
      }))
    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    expect(getOrderClause(rowsSql)).toContain(
      'target."sort_order" ASC, target."value" ASC, target."id" ASC',
    )
    expect(getSqlValues(rowsSql)).toEqual(expect.arrayContaining([TYPE_ID, 20, 0]))

    const timeoutOrder = mockedApplyTransactionTimeouts.mock.invocationCallOrder[0]
    const parentOrder = fixture.transactionClient.dictionaryType.findUnique
      .mock.invocationCallOrder[0]
    const countOrder = fixture.transactionClient.$queryRaw
      .mock.invocationCallOrder[0]
    expect(timeoutOrder).toBeLessThan(parentOrder ?? 0)
    expect(parentOrder).toBeLessThan(countOrder ?? 0)
  })

  it('rejects a missing parent before reading Item rows', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findUnique.mockResolvedValue(null)

    await expectApiException(
      () => fixture.service.listItems(TYPE_ID, {}),
      HttpStatus.NOT_FOUND,
      'DICTIONARY_TYPE_NOT_FOUND',
    )
    expect(fixture.transactionClient.$queryRaw).not.toHaveBeenCalled()
  })

  it('keeps % and _ literal in Item search and appends value/id tie-breakers', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findUnique.mockResolvedValue({
      id: TYPE_ID,
      enabled: true,
    })
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])

    await fixture.service.listItems(TYPE_ID, {
      query: ' %_ ',
      status: DictionaryStatusFilter.ENABLED,
      page: 3,
      pageSize: 5,
      sortBy: DictionaryItemSortBy.LABEL,
      sortOrder: DictionarySortOrder.DESC,
    })

    const countSql = fixture.transactionClient.$queryRaw.mock.calls[0]?.[0]
    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    for (const sql of [countSql, rowsSql]) {
      const text = getSqlText(sql)
      expect(text).toContain('strpos(lower(target."value"), lower(')
      expect(text).toContain('strpos(lower(target."label"), lower(')
      expect(text).toContain('lower(coalesce(target."description", \'\'))')
      expect(text).not.toMatch(/\b(?:LIKE|ILIKE)\b/u)
      expect(getSqlValues(sql)).toEqual(expect.arrayContaining([
        TYPE_ID,
        '%_',
        true,
      ]))
    }
    expect(getOrderClause(rowsSql)).toContain(
      'target."label" DESC, target."value" ASC, target."id" ASC',
    )
    expect(getSqlValues(rowsSql)).toEqual(expect.arrayContaining([5, 10]))
  })

  it('does not repeat value when it is the requested primary sort', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryType.findUnique.mockResolvedValue({
      id: TYPE_ID,
      enabled: true,
    })
    fixture.transactionClient.$queryRaw
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])

    await fixture.service.listItems(TYPE_ID, {
      sortBy: DictionaryItemSortBy.VALUE,
      sortOrder: DictionarySortOrder.DESC,
    })

    const rowsSql = fixture.transactionClient.$queryRaw.mock.calls[1]?.[0]
    expect(getOrderClause(rowsSql)).toContain(
      'target."value" DESC, target."id" ASC',
    )
    expect(getOrderClause(rowsSql)).not.toContain('target."value" ASC')
  })

  it('uses typeId plus itemId so cross-Type probes become ITEM_NOT_FOUND', async () => {
    const fixture = createFixture()
    fixture.transactionClient.dictionaryItem.findFirst.mockResolvedValue({
      ...itemRow(),
      dictionaryType: { enabled: false },
    })

    await expect(fixture.service.getItemById(TYPE_ID, ITEM_ID)).resolves.toEqual(
      expect.objectContaining({
        id: ITEM_ID,
        dictionaryTypeId: TYPE_ID,
        effectiveEnabled: false,
      }),
    )
    expect(fixture.transactionClient.dictionaryItem.findFirst)
      .toHaveBeenCalledWith(expect.objectContaining({
        where: { id: ITEM_ID, dictionaryTypeId: TYPE_ID },
      }))

    const crossType = createFixture()
    crossType.transactionClient.dictionaryItem.findFirst.mockResolvedValue(null)
    await expectApiException(
      () => crossType.service.getItemById(SECOND_TYPE_ID, ITEM_ID),
      HttpStatus.NOT_FOUND,
      'DICTIONARY_ITEM_NOT_FOUND',
    )
  })
})

describe('DictionaryQueryService direct boundary and safe errors', () => {
  beforeEach(() => {
    mockedApplyTransactionTimeouts.mockClear()
  })

  it.each([
    (service: DictionaryQueryService) => service.listTypes(null as never),
    (service: DictionaryQueryService) => service.listTypes({ page: 0 }),
    (service: DictionaryQueryService) => service.listTypes({ pageSize: 101 }),
    (service: DictionaryQueryService) => service.listTypes({ query: ' \t ' }),
    (service: DictionaryQueryService) => service.listTypes({ status: 'BAD' as never }),
    (service: DictionaryQueryService) => service.listTypes({ sortBy: 'BAD' as never }),
    (service: DictionaryQueryService) => service.listTypes({ sortOrder: 'BAD' as never }),
    (service: DictionaryQueryService) => service.getTypeById('not-a-uuid'),
    (service: DictionaryQueryService) => service.listItems(TYPE_ID, { page: 1.5 }),
    (service: DictionaryQueryService) => service.listItems(
      TYPE_ID,
      { sortBy: 'BAD' as never },
    ),
    (service: DictionaryQueryService) => service.listItems(
      TYPE_ID,
      { sortOrder: 'BAD' as never },
    ),
    (service: DictionaryQueryService) => service.listItems('not-a-uuid', {}),
    (service: DictionaryQueryService) => service.getItemById(TYPE_ID, 'bad'),
  ])('validates direct service inputs before opening a transaction', async (action) => {
    const fixture = createFixture()
    await expectApiException(
      () => action(fixture.service),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(fixture.transaction).not.toHaveBeenCalled()
  })

  it('maps an unknown Type driver failure to a fixed safe 500 response', async () => {
    const fixture = createFixture()
    const sensitiveValue = 'postgres://secret@host/dictionary'
    fixture.transactionClient.$queryRaw.mockRejectedValue(
      new Error(sensitiveValue),
    )

    await expectApiException(
      () => fixture.service.listTypes({}),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      sensitiveValue,
    )
  })

  it.each([
    ['Type list', (service: DictionaryQueryService) =>
      service.listTypes({})],
    ['Type detail', (service: DictionaryQueryService) =>
      service.getTypeById(TYPE_ID)],
    ['Item list', (service: DictionaryQueryService) =>
      service.listItems(TYPE_ID, {})],
    ['Item detail', (service: DictionaryQueryService) =>
      service.getItemById(TYPE_ID, ITEM_ID)],
  ] as const)(
    'fails closed when the %s snapshot has a transaction conflict',
    async (_caseName, action) => {
      const fixture = createFixture()
      fixture.transaction.mockRejectedValue({ code: 'P2034' })

      await expectApiException(
        () => action(fixture.service),
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
      )
    },
  )
})
