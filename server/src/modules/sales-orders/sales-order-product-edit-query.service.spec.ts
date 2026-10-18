import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderProductEditQueryService } from './sales-order-product-edit-query.service'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sales-order-id',
    orderNo: 'SO-001',
    customerName: '客户甲',
    currencyCode: 'TWD',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    version: 4,
    lineSubtotalAmount: decimal('300'),
    agreedTotalAmount: decimal('300'),
    depositDueAmount: decimal('100'),
    balanceDueAmount: decimal('200'),
    lines: [{
      id: 'sales-line-a',
      lineNumber: 1,
      lineType: 'CATALOG',
      productId: 'product-id',
      productNoSnapshot: 'P-001',
      productNameSnapshot: '目录产品',
      descriptionSnapshot: '备注',
      standardUnitPriceAmount: decimal('55'),
      actualUnitPriceAmount: decimal('50'),
      quantity: 2,
      lineTotalAmount: decimal('100'),
      product: {
        supplierValue: 'SUPPLIER_A',
        media: [{ id: 'existing-product-media-id' }],
      },
    }, {
      id: 'sales-line-b',
      lineNumber: 2,
      lineType: 'CUSTOM',
      productId: null,
      productNoSnapshot: null,
      productNameSnapshot: '安装服务',
      descriptionSnapshot: null,
      standardUnitPriceAmount: null,
      actualUnitPriceAmount: decimal('200'),
      quantity: 1,
      lineTotalAmount: decimal('200'),
      product: null,
    }],
    payments: [{ amount: decimal('80') }],
    ...overrides,
  }
}

function setup() {
  const findUnique = jest.fn<Promise<ReturnType<typeof orderRow>>, [unknown]>()
    .mockResolvedValue(orderRow())
  const prisma = {
    salesOrder: {
      findUnique,
    },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([{
        sourceSalesOrderLineId: 'sales-line-a', quantity: 2,
      }]),
    },
    product: {
      count: jest.fn().mockImplementation((args: unknown) => {
        const where = (args as { where?: { categoryId?: unknown } }).where
        return Promise.resolve(where?.categoryId === null ? 0 : 1)
      }),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([{
        id: 'product-id',
        productNo: 'P-001',
        name: '目录产品',
        category: { name: '收纳包' },
        productHead: { name: '城市旅行' },
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [],
        twdSalePriceAmount: decimal('55'),
        myrSalePriceAmount: decimal('9'),
        media: [{ id: 'product-media-id' }],
      }]),
    },
    productCategory: {
      findMany: jest.fn().mockResolvedValue([{
        name: '收纳包',
        _count: { products: 1 },
        productHeads: [{ name: '城市旅行', _count: { products: 1 } }],
      }]),
    },
  }
  return {
    prisma,
    service: new SalesOrderProductEditQueryService(
      prisma as unknown as PrismaService,
    ),
  }
}

describe('SalesOrderProductEditQueryService', () => {
  it('returns only active lines with current active-purchase locks', async () => {
    const fixture = setup()

    await expect(fixture.service.context('sales-order-id')).resolves.toEqual({
      salesOrder: {
        id: 'sales-order-id',
        orderNo: 'SO-001',
        customerName: '客户甲',
        currencyCode: 'TWD',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        version: 4,
      },
      amounts: {
        lineSubtotalAmount: '300.0000',
        agreedTotalAmount: '300.0000',
        depositDueAmount: '100.0000',
        balanceDueAmount: '200.0000',
        paidAmount: '80.0000',
        outstandingAmount: '220.0000',
      },
      existingLines: [{
        id: 'sales-line-a',
        lineNumber: 1,
        lineType: 'CATALOG',
        productId: 'product-id',
        productNo: 'P-001',
        productName: '目录产品',
        supplierValue: 'SUPPLIER_A',
        description: '备注',
        standardUnitPriceAmount: '55.0000',
        actualUnitPriceAmount: '50.0000',
        quantity: 2,
        lineTotalAmount: '100.0000',
        activePurchasedQuantity: 2,
        canDecrease: false,
        mainImage: {
          id: 'existing-product-media-id',
          contentUrl: '/api/sales-orders/sales-order-id/lines/sales-line-a/main-image/existing-product-media-id/content',
        },
      }, expect.objectContaining({
        id: 'sales-line-b',
        activePurchasedQuantity: 0,
        canDecrease: true,
        mainImage: null,
      })],
      availableLineCapacity: 98,
    })
    const findUniqueInput = fixture.prisma.salesOrder.findUnique.mock.calls[0]?.[0]
    expect(findUniqueInput).toMatchObject({
      select: { lines: { where: { removedAt: null } } },
    })
    expect(fixture.prisma.purchaseOrderLine.findMany).toHaveBeenCalledWith({
      where: {
        sourceSalesOrderLineId: { in: ['sales-line-a', 'sales-line-b'] },
        purchaseOrder: { is: {
          purchaseType: 'SALES_LINKED',
          salesOrderId: 'sales-order-id',
          orderStatus: { not: 'CANCELLED' },
        } },
      },
      select: { sourceSalesOrderLineId: true, quantity: true },
    })
  })

  it('marks a partially purchased line as decreaseable down to the purchased quantity', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrderLine.findMany.mockResolvedValue([{
      sourceSalesOrderLineId: 'sales-line-a', quantity: 1,
    }])

    const result = await fixture.service.context('sales-order-id')

    expect(result.existingLines[0]).toMatchObject({
      quantity: 2,
      activePurchasedQuantity: 1,
      canDecrease: true,
    })
  })

  it.each([
    { orderStatus: 'DRAFT' },
    { orderStatus: 'CANCELLED' },
    { fulfillmentStatus: 'SEA_TRANSIT' },
    { fulfillmentStatus: 'SIGNED' },
  ])('rejects an order outside the confirmed pre-sea boundary %#', async (override) => {
    const fixture = setup()
    fixture.prisma.salesOrder.findUnique.mockResolvedValue(orderRow(override))

    await expect(fixture.service.context('sales-order-id')).rejects.toMatchObject({
      code: 'SALES_ORDER_PRODUCT_EDIT_NOT_ALLOWED',
      status: 422,
    })
  })

  it('returns active catalog products scoped to the selected supplier', async () => {
    const fixture = setup()

    await expect(fixture.service.productOptions('sales-order-id', {
      keyword: '目录', page: 2, pageSize: 10, supplierValue: 'SUPPLIER_TW_01',
    })).resolves.toEqual({
      items: [expect.objectContaining({
        id: 'product-id',
        standardUnitPriceAmount: '55.0000',
        currencyCode: 'TWD',
        mainImage: {
          id: 'product-media-id',
          contentUrl: '/api/sales-orders/sales-order-id/product-edit-options/product-id/main-image/product-media-id/content',
        },
      })],
      categories: [{ name: '收纳包', count: 1, productHeads: [{ name: '城市旅行', count: 1 }] }],
      unclassifiedCount: 0,
      page: 2,
      pageSize: 10,
      total: 1,
    })
    expect(fixture.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          supplierValue: 'SUPPLIER_TW_01',
          OR: [
            { productNo: { contains: '目录', mode: 'insensitive' } },
            { name: { contains: '目录', mode: 'insensitive' } },
          ],
        },
      }),
    )
  })
})
