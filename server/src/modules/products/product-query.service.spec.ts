import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type {
  DictionaryLookupService,
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import { ProductQueryService } from './product-query.service'
import type { ProductQueryRow } from './product-query.mapper'
import { ProductStatus } from '../../generated/prisma/enums'

function createRow(
  id: string,
  supplierValue: string | null,
): ProductQueryRow {
  return {
    id,
    name: `Product ${id}`,
    productNo: `NO-${id}`,
    status: ProductStatus.DRAFT,
    supplierValue,
    mainImage: null,
    images: [],
    videos: [],
    twdSalePriceAmount: null,
    twdSalePriceCurrency: 'TWD',
    myrSalePriceAmount: null,
    myrSalePriceCurrency: 'MYR',
    purchaseCostAmount: null,
    purchaseCostCurrency: 'CNY',
    attributes: [],
    createdBy: null,
    updatedBy: null,
    version: 1,
    createdAt: new Date('2026-08-12T01:00:00.000Z'),
    updatedAt: new Date('2026-08-12T02:00:00.000Z'),
  }
}

function createFixture(rows: ProductQueryRow[] = []): {
  readonly service: ProductQueryService
  readonly count: jest.Mock<Promise<number>, [unknown]>
  readonly findMany: jest.Mock<Promise<ProductQueryRow[]>, [unknown]>
  readonly findUnique: jest.Mock<Promise<ProductQueryRow | null>, [unknown]>
  readonly resolveStoredValue: jest.Mock<
    Promise<StoredDictionaryValueResolution>,
    [{ readonly dictionaryCode: string; readonly value: string }]
  >
  readonly resolveStoredValues: jest.Mock<
    Promise<readonly StoredDictionaryValueResolution[]>,
    [{ readonly dictionaryCode: string; readonly values: readonly string[] }]
  >
  readonly queryRaw: jest.Mock<Promise<unknown[]>, [unknown]>
} {
  const count = jest.fn<Promise<number>, [unknown]>()
    .mockResolvedValue(rows.length)
  const findMany = jest.fn<Promise<ProductQueryRow[]>, [unknown]>()
    .mockResolvedValue(rows)
  const findUnique = jest.fn<Promise<ProductQueryRow | null>, [unknown]>()
    .mockResolvedValue(rows[0] ?? null)
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue([])
  const transaction = jest.fn<
    Promise<unknown>,
    [(client: unknown) => Promise<unknown>]
  >((operation) => operation({
    product: { count, findMany },
    $queryRaw: queryRaw,
  }))
  const resolveStoredValues = jest.fn<
    Promise<readonly StoredDictionaryValueResolution[]>,
    [{ readonly dictionaryCode: string; readonly values: readonly string[] }]
  >(({ values }) => Promise.resolve(values.map(value => ({
    known: false as const,
    dictionaryCode: 'service_provider.supplier',
    value,
  }))))
  const resolveStoredValue = jest.fn<
    Promise<StoredDictionaryValueResolution>,
    [{ readonly dictionaryCode: string; readonly value: string }]
  >(({ value }) => Promise.resolve({
    known: false as const,
    dictionaryCode: 'service_provider.supplier',
    value,
  }))

  return {
    service: new ProductQueryService(
      {
        $transaction: transaction,
        product: { findUnique },
      } as unknown as PrismaService,
      {
        resolveStoredValue,
        resolveStoredValues,
      } as unknown as DictionaryLookupService,
    ),
    count,
    findMany,
    findUnique,
    resolveStoredValue,
    resolveStoredValues,
    queryRaw,
  }
}

describe('ProductQueryService', () => {
  it('returns one complete product and resolves its historical supplier', async () => {
    const fixture = createFixture([createRow('product-1', 'HISTORICAL')])

    await expect(fixture.service.getById('product-1')).resolves.toMatchObject({
      id: 'product-1',
      supplier: {
        value: 'HISTORICAL',
        state: 'UNKNOWN',
      },
    })
    const findUniqueCalls = fixture.findUnique.mock.calls as unknown as Array<
      readonly [unknown]
    >
    expect(findUniqueCalls[0]?.[0]).toMatchObject({
      where: { id: 'product-1' },
      select: {
        productNo: true,
        version: true,
      },
    })
    expect(fixture.resolveStoredValue).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      value: 'HISTORICAL',
    })
  })

  it('returns PRODUCT_NOT_FOUND without resolving a supplier', async () => {
    const fixture = createFixture([])

    await expect(fixture.service.getById('missing')).rejects.toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    })
    expect(fixture.resolveStoredValue).not.toHaveBeenCalled()
  })

  it('combines name/number search with exact supplier filtering and shares the where', async () => {
    const fixture = createFixture([
      createRow('1', 'SUPPLIER_A'),
      createRow('2', null),
      createRow('3', 'SUPPLIER_A'),
      createRow('4', ' raw '),
    ])

    const result = await fixture.service.list({
      keyword: 'product-001',
      page: 2,
      pageSize: 10,
      supplierValue: 'SUPPLIER_A',
    })

    const countInput = fixture.count.mock.calls[0]?.[0] as {
      where: unknown
    }
    const findManyInput = fixture.findMany.mock.calls[0]?.[0] as {
      where: unknown
      orderBy: unknown
      skip: number
      take: number
      select: Record<string, unknown>
    }
    expect(countInput.where).toEqual({
      supplierValue: 'SUPPLIER_A',
      OR: [
        {
          name: {
            contains: 'product-001',
            mode: 'insensitive',
          },
        },
        {
          productNo: {
            contains: 'product-001',
            mode: 'insensitive',
          },
        },
      ],
    })
    expect(findManyInput.where).toBe(countInput.where)
    expect(findManyInput).toMatchObject({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    })
    expect(findManyInput.select.createdBy).toEqual({
      select: { id: true, displayName: true },
    })
    expect(findManyInput.select.updatedBy).toEqual({
      select: { id: true, displayName: true },
    })
    expect(fixture.resolveStoredValues).toHaveBeenCalledTimes(1)
    expect(fixture.resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      values: ['SUPPLIER_A', ' raw '],
    })
    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 4 })
    expect(result.items.map(item => item.supplier?.value ?? null)).toEqual([
      'SUPPLIER_A',
      null,
      'SUPPLIER_A',
      ' raw ',
    ])
    expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns an empty stable page without dictionary queries', async () => {
    const fixture = createFixture([])

    await expect(fixture.service.list({})).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })
    expect(fixture.resolveStoredValues).not.toHaveBeenCalled()
  })

  it('maps database or dictionary failures to a fixed internal error', async () => {
    const fixture = createFixture([createRow('1', 'SUPPLIER_A')])
    fixture.resolveStoredValues.mockRejectedValue(new Error('secret sql value'))

    await expect(fixture.service.list({})).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
  })
})
