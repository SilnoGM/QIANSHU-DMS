import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type {
  DictionaryLookupService,
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import { ProductQueryService } from './product-query.service'
import type { ProductQueryRow } from './product-query.mapper'
import {
  MediaAssetStatus,
  MediaType,
  ProductMediaKind,
  ProductStatus,
} from '../../generated/prisma/enums'

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
  readonly productMediaFindMany: jest.Mock<Promise<unknown[]>, [unknown]>
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
  const productMediaFindMany = jest.fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue([])
  const transaction = jest.fn<
    Promise<unknown>,
    [(client: unknown) => Promise<unknown>]
  >((operation) => operation({
    product: { count, findMany, findUnique },
    productMedia: { findMany: productMediaFindMany },
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
        productMedia: { findMany: productMediaFindMany },
      } as unknown as PrismaService,
      {
        resolveStoredValue,
        resolveStoredValues,
      } as unknown as DictionaryLookupService,
    ),
    count,
    findMany,
    findUnique,
    productMediaFindMany,
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
      media: { mainImage: null, images: [], videos: [] },
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
    expect(fixture.productMediaFindMany).toHaveBeenCalledTimes(1)
    expect(fixture.productMediaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        productId: { in: ['product-1'] },
        detachedAt: null,
      },
    }))
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
    expect(result.items.every(item => (
      item.media.mainImage === null
      && item.media.images.length === 0
      && item.media.videos.length === 0
    ))).toBe(true)
    expect(fixture.productMediaFindMany).toHaveBeenCalledTimes(1)
    expect(fixture.productMediaFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        productId: { in: ['1', '2', '3', '4'] },
        detachedAt: null,
      },
      orderBy: [
        { productId: 'asc' },
        { kind: 'asc' },
        { sortOrder: 'asc' },
        { id: 'asc' },
      ],
    }))
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
    expect(fixture.productMediaFindMany).not.toHaveBeenCalled()
  })

  it('groups one batch of active ProductMedia into the matching products', async () => {
    const fixture = createFixture([
      createRow('1', null),
      createRow('2', null),
    ])
    fixture.productMediaFindMany.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        productId: '2',
        kind: ProductMediaKind.IMAGE,
        sortOrder: 0,
        isPrimary: true,
        createdAt: new Date('2026-08-14T01:00:00.000Z'),
        mediaAsset: {
          mediaType: MediaType.IMAGE,
          status: MediaAssetStatus.READY,
          originalFilename: 'front.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048n,
          width: 1200,
          height: 800,
          durationMs: null,
        },
      },
    ])

    const result = await fixture.service.list({})

    expect(result.items[0]?.media).toEqual({
      mainImage: null,
      images: [],
      videos: [],
    })
    expect(result.items[1]?.media).toMatchObject({
      mainImage: {
        id: '11111111-1111-4111-8111-111111111111',
        contentUrl: '/api/products/2/media/11111111-1111-4111-8111-111111111111/content',
      },
      images: [{ id: '11111111-1111-4111-8111-111111111111' }],
      videos: [],
    })
    expect(fixture.productMediaFindMany).toHaveBeenCalledTimes(1)
    const input = fixture.productMediaFindMany.mock.calls[0]?.[0] as {
      select: { mediaAsset: { select: Record<string, unknown> } }
    }
    expect(Object.keys(input.select.mediaAsset.select).sort()).toEqual([
      'durationMs',
      'height',
      'mediaType',
      'mimeType',
      'originalFilename',
      'sizeBytes',
      'status',
      'width',
    ])
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
