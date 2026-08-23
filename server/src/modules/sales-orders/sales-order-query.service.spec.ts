import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderQueryService } from './sales-order-query.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'

function decimal(value: string) {
  return { toFixed: jest.fn().mockReturnValue(value) }
}

function createFixture(media = [{ id: PRODUCT_MEDIA_ID }]) {
  const product = {
    count: jest.fn().mockResolvedValue(5),
    findMany: jest.fn().mockResolvedValue([{
      id: PRODUCT_ID,
      productNo: 'SKU-TW-001',
      name: '城市旅行收纳包',
      supplierValue: 'SUPPLIER_TW_01',
      attributes: [{ key: 'color', value: 'green' }],
      twdSalePriceAmount: decimal('1234.5000'),
      myrSalePriceAmount: decimal('168.0000'),
      media,
    }]),
  }
  const service = new SalesOrderQueryService({ product } as unknown as PrismaService)
  return { product, service }
}

describe('SalesOrderQueryService product options', () => {
  it('uses the same qualified filters for count/page and returns one currency plus main image', async () => {
    const fixture = createFixture()

    await expect(fixture.service.productOptions({
      currencyCode: 'TWD',
      keyword: ' 旅行 ',
      supplierValue: 'SUPPLIER_TW_01',
      page: 2,
      pageSize: 2,
    })).resolves.toEqual({
      items: [{
        id: PRODUCT_ID,
        productNo: 'SKU-TW-001',
        name: '城市旅行收纳包',
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [{ key: 'color', value: 'green' }],
        standardUnitPriceAmount: '1234.5000',
        currencyCode: 'TWD',
        mainImage: {
          id: PRODUCT_MEDIA_ID,
          contentUrl: `/api/sales-orders/product-options/${PRODUCT_ID}/main-image/${PRODUCT_MEDIA_ID}/content?currencyCode=TWD`,
        },
      }],
      page: 2,
      pageSize: 2,
      total: 5,
    })

    const expectedWhere = {
      status: 'ACTIVE',
      supplierValue: 'SUPPLIER_TW_01',
      twdSalePriceAmount: { not: null },
      OR: [
        { productNo: { contains: '旅行', mode: 'insensitive' } },
        { name: { contains: '旅行', mode: 'insensitive' } },
      ],
    }
    expect(fixture.product.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(fixture.product.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 2,
      select: {
        id: true,
        productNo: true,
        name: true,
        supplierValue: true,
        attributes: true,
        twdSalePriceAmount: true,
        myrSalePriceAmount: true,
        media: {
          where: {
            kind: 'IMAGE',
            isPrimary: true,
            detachedAt: null,
            mediaAsset: { is: { status: 'READY' } },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 2,
          select: { id: true },
        },
      },
    })
  })

  it('fails closed when persisted state exposes more than one qualified main image', async () => {
    const fixture = createFixture([
      { id: PRODUCT_MEDIA_ID },
      { id: '33333333-3333-4333-8333-333333333333' },
    ])

    await expect(fixture.service.productOptions({
      currencyCode: 'MYR',
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_STATE_CHANGED',
    })
  })
})
