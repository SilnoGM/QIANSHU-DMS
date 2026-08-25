import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderQueryService } from './sales-order-query.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOM_LINE_ID = '55555555-5555-4555-8555-555555555555'
const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666'
const MEDIA_ASSET_ID = '77777777-7777-4777-8777-777777777777'

function decimal(value: string) {
  return { toFixed: jest.fn().mockReturnValue(value) }
}

function createFixture(
  media = [{ id: PRODUCT_MEDIA_ID }],
  twdSalePriceAmount: ReturnType<typeof decimal> | null = decimal('1234.5000'),
  myrSalePriceAmount: ReturnType<typeof decimal> | null = decimal('168.0000'),
) {
  const product = {
    count: jest.fn().mockResolvedValue(5),
    findMany: jest.fn().mockResolvedValue([{
      id: PRODUCT_ID,
      productNo: 'SKU-TW-001',
      name: '城市旅行收纳包',
      supplierValue: 'SUPPLIER_TW_01',
      attributes: [{ key: 'color', value: 'green' }],
      twdSalePriceAmount,
      myrSalePriceAmount,
      media,
    }]),
  }
  const service = new SalesOrderQueryService({ product } as unknown as PrismaService)
  return { product, service }
}

function createListFixture() {
  const listRow = {
    id: SALES_ORDER_ID,
    orderNo: 'SO-20260823-0001',
    orderDate: new Date('2026-08-22T00:00:00.000Z'),
    issuer: { id: '88888888-8888-4888-8888-888888888888', displayName: 'SilnoGM' },
    currencyCode: 'TWD',
    customerName: '林测试',
    customerPhone: '0912345678',
    customerProvinceStateNameSnapshot: '台湾',
    customerCityNameSnapshot: '新北市',
    customerFullAddressSnapshot: '中国台湾台湾新北市板桥区测试路1号',
    lineSubtotalAmount: decimal('1200.0000'),
    agreedTotalAmount: decimal('1200.0000'),
    depositDueAmount: decimal('200.0000'),
    balanceDueAmount: decimal('1000.0000'),
    remark: '客户要求周末送达',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    _count: {
      payments: 2,
      statusHistory: 3,
      amountRevisions: 1,
    },
    version: 3,
    createdAt: new Date('2026-08-22T09:00:00.000Z'),
    updatedAt: new Date('2026-08-23T10:30:00.000Z'),
    payments: [{ amount: decimal('200.0000') }],
    lines: [{
      id: SALES_ORDER_LINE_ID,
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      productNameSnapshot: '城市旅行收纳包',
      standardUnitPriceAmount: decimal('600.0000'),
      quantity: 2,
      product: {
        media: [{ id: PRODUCT_MEDIA_ID }],
      },
    }, {
      id: CUSTOM_LINE_ID,
      lineType: 'CUSTOM',
      productId: null,
      productNameSnapshot: '本单临时包装服务',
      standardUnitPriceAmount: null,
      quantity: 1,
      product: null,
    }],
    documents: [{
      id: DOCUMENT_ID,
      mediaAssetId: MEDIA_ASSET_ID,
      documentType: 'DEPOSIT_VOUCHER',
      title: '林测试-定金凭证-20260822090000',
      mediaAsset: { mediaType: 'IMAGE' },
    }],
  }
  const salesOrder = {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([listRow]),
    aggregate: jest.fn()
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('1200.0000'),
          depositDueAmount: decimal('200.0000'),
          balanceDueAmount: decimal('1000.0000'),
        },
      })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('800.0000'),
          depositDueAmount: decimal('300.0000'),
          balanceDueAmount: decimal('500.0000'),
        },
      }),
  }
  const salesOrderLine = {
    findMany: jest.fn()
      .mockResolvedValueOnce([{
        standardUnitPriceAmount: decimal('600.0000'),
        quantity: 2,
      }])
      .mockResolvedValueOnce([{
        standardUnitPriceAmount: decimal('400.0000'),
        quantity: 2,
      }]),
  }
  const salesOrderPayment = {
    aggregate: jest.fn()
      .mockResolvedValueOnce({ _sum: { amount: decimal('200.0000') } })
      .mockResolvedValueOnce({ _sum: { amount: decimal('300.0000') } }),
  }
  const transaction = jest.fn(async (operations: readonly Promise<unknown>[]) => (
    Promise.all(operations)
  ))
  const service = new SalesOrderQueryService({
    salesOrder,
    salesOrderLine,
    salesOrderPayment,
    $transaction: transaction,
  } as unknown as PrismaService)
  return {
    listRow,
    salesOrder,
    salesOrderLine,
    salesOrderPayment,
    service,
    transaction,
  }
}

describe('SalesOrderQueryService list summaries', () => {
  it('returns bounded row summaries and fixed currency aggregates without per-row queries', async () => {
    const fixture = createListFixture()

    await expect(fixture.service.list({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [{
        id: SALES_ORDER_ID,
        orderNo: 'SO-20260823-0001',
        orderDate: '2026-08-22',
        issuer: { id: '88888888-8888-4888-8888-888888888888', displayName: 'SilnoGM' },
        currencyCode: 'TWD',
        customerName: '林测试',
        customerPhone: '0912345678',
        customerProvinceStateName: '台湾',
        customerCityName: '新北市',
        customerFullAddress: '中国台湾台湾新北市板桥区测试路1号',
        standardSubtotalAmount: '1200.0000',
        lineSubtotalAmount: '1200.0000',
        agreedTotalAmount: '1200.0000',
        depositDueAmount: '200.0000',
        balanceDueAmount: '1000.0000',
        receivedAmount: '200.0000',
        outstandingAmount: '1000.0000',
        remark: '客户要求周末送达',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        paymentRecordCount: 2,
        statusChangeRecordCount: 3,
        amountChangeRecordCount: 1,
        version: 3,
        lineSummary: {
          lineCount: 2,
          totalQuantity: 3,
          catalogCount: 1,
          customCount: 1,
          previews: [{
            lineId: SALES_ORDER_LINE_ID,
            productName: '城市旅行收纳包',
            mainImage: {
              id: PRODUCT_MEDIA_ID,
              contentUrl: `/api/sales-orders/${SALES_ORDER_ID}/lines/${SALES_ORDER_LINE_ID}/main-image/${PRODUCT_MEDIA_ID}/content`,
            },
          }, {
            lineId: CUSTOM_LINE_ID,
            productName: '本单临时包装服务',
            mainImage: null,
          }],
        },
        documentSummary: {
          count: 1,
          imageCount: 1,
          previews: [{
            id: DOCUMENT_ID,
            documentType: 'DEPOSIT_VOUCHER',
            title: '林测试-定金凭证-20260822090000',
            mediaType: 'IMAGE',
            contentUrl: `/api/sales-orders/${SALES_ORDER_ID}/documents/${DOCUMENT_ID}/content`,
          }],
        },
        createdAt: '2026-08-22T09:00:00.000Z',
        updatedAt: '2026-08-23T10:30:00.000Z',
      }],
      summariesByCurrency: [{
        currencyCode: 'TWD',
        orderCount: 1,
        standardSubtotalAmount: '1200.0000',
        agreedTotalAmount: '1200.0000',
        depositDueAmount: '200.0000',
        balanceDueAmount: '1000.0000',
        receivedAmount: '200.0000',
        outstandingAmount: '1000.0000',
      }, {
        currencyCode: 'MYR',
        orderCount: 1,
        standardSubtotalAmount: '800.0000',
        agreedTotalAmount: '800.0000',
        depositDueAmount: '300.0000',
        balanceDueAmount: '500.0000',
        receivedAmount: '300.0000',
        outstandingAmount: '500.0000',
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.salesOrder.findMany).toHaveBeenCalledTimes(1)
    expect(fixture.salesOrder.aggregate).toHaveBeenCalledTimes(2)
    expect(fixture.salesOrderLine.findMany).toHaveBeenCalledTimes(2)
    expect(fixture.salesOrderPayment.aggregate).toHaveBeenCalledTimes(2)
  })

  it('omits currencies that have no orders in the filtered result', async () => {
    const fixture = createListFixture()
    fixture.salesOrder.aggregate
      .mockReset()
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('1200.0000'),
          depositDueAmount: decimal('200.0000'),
          balanceDueAmount: decimal('1000.0000'),
        },
      })
      .mockResolvedValueOnce({
        _count: { _all: 0 },
        _sum: {
          agreedTotalAmount: null,
          depositDueAmount: null,
          balanceDueAmount: null,
        },
      })
    fixture.salesOrderPayment.aggregate
      .mockReset()
      .mockResolvedValueOnce({ _sum: { amount: decimal('200.0000') } })
      .mockResolvedValueOnce({ _sum: { amount: null } })

    const result = await fixture.service.list({ currencyCode: 'TWD' })

    expect(result.summariesByCurrency).toEqual([{
      currencyCode: 'TWD',
      orderCount: 1,
      standardSubtotalAmount: '1200.0000',
      agreedTotalAmount: '1200.0000',
      depositDueAmount: '200.0000',
      balanceDueAmount: '1000.0000',
      receivedAmount: '200.0000',
      outstandingAmount: '1000.0000',
    }])
  })

  it('returns every product line preview so the client can fold additional images', async () => {
    const fixture = createListFixture()
    const additionalLines = [1, 2, 3].map(index => ({
      id: `99999999-9999-4999-8999-99999999999${index}`,
      lineType: 'CATALOG',
      productId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
      productNameSnapshot: `追加产品 ${index}`,
      standardUnitPriceAmount: decimal(`${index}.0000`),
      quantity: index,
      product: {
        media: [{ id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index}` }],
      },
    }))
    fixture.salesOrder.findMany.mockResolvedValueOnce([{
      ...fixture.listRow,
      lines: [...fixture.listRow.lines, ...additionalLines],
    }])

    const result = await fixture.service.list({ page: 1, pageSize: 20 })

    expect(result.items[0]?.lineSummary.previews).toHaveLength(5)
    expect(result.items[0]?.lineSummary.previews.filter(
      preview => preview.mainImage !== null,
    )).toHaveLength(4)
    expect(result.items[0]?.lineSummary.previews.at(-1)).toMatchObject({
      lineId: additionalLines[2]?.id,
      productName: '追加产品 3',
    })
  })
})

describe('SalesOrderQueryService product options', () => {
  it('filters active products without using order currency as product eligibility', async () => {
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

  it('returns an active product when the current order currency has no standard price', async () => {
    const fixture = createFixture([], null)

    await expect(fixture.service.productOptions({
      currencyCode: 'TWD',
    })).resolves.toEqual({
      items: [{
        id: PRODUCT_ID,
        productNo: 'SKU-TW-001',
        name: '城市旅行收纳包',
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [{ key: 'color', value: 'green' }],
        standardUnitPriceAmount: null,
        currencyCode: 'TWD',
        mainImage: null,
      }],
      page: 1,
      pageSize: 20,
      total: 5,
    })

    expect(fixture.product.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
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
