import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderAddOnQueryService } from './sales-order-add-on-query.service'

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
    paymentStatus: 'PAID',
    version: 4,
    lineSubtotalAmount: decimal('300'),
    agreedTotalAmount: decimal('300'),
    depositDueAmount: decimal('100'),
    balanceDueAmount: decimal('200'),
    lines: [{
      id: 'sales-line-a',
      lineNumber: 1,
      lineType: 'CATALOG',
      productNoSnapshot: 'P-001',
      productNameSnapshot: '产品甲',
      actualUnitPriceAmount: decimal('100'),
      quantity: 2,
      lineTotalAmount: decimal('200'),
    }, {
      id: 'sales-line-b',
      lineNumber: 2,
      lineType: 'CUSTOM',
      productNoSnapshot: null,
      productNameSnapshot: '临时服务',
      actualUnitPriceAmount: decimal('100'),
      quantity: 1,
      lineTotalAmount: decimal('100'),
    }],
    payments: [{ amount: decimal('300') }],
    ...overrides,
  }
}

function setup() {
  const prisma = {
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue(orderRow()),
    },
    purchaseOrder: {
      count: jest.fn().mockResolvedValue(1),
    },
    purchaseOrderLine: {
      findMany: jest.fn().mockResolvedValue([{ sourceSalesOrderLineId: 'sales-line-a', quantity: 2 }, {
        sourceSalesOrderLineId: 'sales-line-b', quantity: 1,
      }]),
    },
    product: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'product-id',
        productNo: 'P-002',
        name: '加购产品',
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [],
        twdSalePriceAmount: decimal('80'),
        myrSalePriceAmount: decimal('12'),
        media: [{ id: 'product-media-id' }],
      }]),
    },
  }
  const dictionaryLookup = {
    resolveStoredValue: jest.fn().mockResolvedValue({
      known: true,
      effectiveEnabled: true,
      value: 'SUPPLIER_TW_01',
    }),
  }
  const service = new SalesOrderAddOnQueryService(
    prisma as unknown as PrismaService,
    dictionaryLookup as unknown as DictionaryLookupService,
  )
  return { dictionaryLookup, prisma, service }
}

describe('SalesOrderAddOnQueryService', () => {
  it('returns a fully purchased pre-sea context with trusted amounts and line capacity', async () => {
    const fixture = setup()

    await expect(fixture.service.context('sales-order-id')).resolves.toEqual({
      salesOrder: {
        id: 'sales-order-id',
        orderNo: 'SO-001',
        customerName: '客户甲',
        currencyCode: 'TWD',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PAID',
        version: 4,
      },
      amounts: {
        lineSubtotalAmount: '300.0000',
        agreedTotalAmount: '300.0000',
        depositDueAmount: '100.0000',
        balanceDueAmount: '200.0000',
        paidAmount: '300.0000',
        outstandingAmount: '0.0000',
      },
      existingLines: [{
        id: 'sales-line-a',
        lineNumber: 1,
        lineType: 'CATALOG',
        productNo: 'P-001',
        productName: '产品甲',
        actualUnitPriceAmount: '100.0000',
        quantity: 2,
        lineTotalAmount: '200.0000',
      }, {
        id: 'sales-line-b',
        lineNumber: 2,
        lineType: 'CUSTOM',
        productNo: null,
        productName: '临时服务',
        actualUnitPriceAmount: '100.0000',
        quantity: 1,
        lineTotalAmount: '100.0000',
      }],
      availableLineCapacity: 98,
    })
  })

  it.each([
    ['non-confirmed', { orderStatus: 'COMPLETED' }, 1, 3],
    ['sea transit', { fulfillmentStatus: 'SEA_TRANSIT' }, 1, 3],
    ['signed', { fulfillmentStatus: 'SIGNED' }, 1, 3],
    ['without active purchase', {}, 0, 3],
    ['with remaining quantity', {}, 1, 2],
  ])('rejects %s add-on context', async (_name, order, activeCount, purchasedQuantity) => {
    const fixture = setup()
    fixture.prisma.salesOrder.findUnique.mockResolvedValue(orderRow(order))
    fixture.prisma.purchaseOrder.count.mockResolvedValue(activeCount)
    fixture.prisma.purchaseOrderLine.findMany.mockResolvedValue(
      purchasedQuantity === 3
        ? [{ sourceSalesOrderLineId: 'sales-line-a', quantity: 2 }, {
            sourceSalesOrderLineId: 'sales-line-b', quantity: 1,
          }]
        : [{ sourceSalesOrderLineId: 'sales-line-a', quantity: purchasedQuantity }],
    )

    await expect(fixture.service.context('sales-order-id'))
      .rejects.toMatchObject({ code: 'SALES_ORDER_ADD_ON_NOT_ALLOWED' })
  })

  it('uses the order currency and selected effective supplier for catalog options', async () => {
    const fixture = setup()

    const result = await fixture.service.productOptions('sales-order-id', {
      supplierValue: 'supplier_tw_01',
      keyword: '加购',
    })
    expect(result).toMatchObject({
      items: [{
        id: 'product-id',
        standardUnitPriceAmount: '80.0000',
        currencyCode: 'TWD',
        supplierValue: 'SUPPLIER_TW_01',
        mainImage: {
          id: 'product-media-id',
        },
      }],
      total: 1,
    })
    expect(result.items[0]?.mainImage?.contentUrl).toContain(
      '/add-on-product-options/product-id/main-image/product-media-id/content',
    )
    const productQuery = fixture.prisma.product.findMany.mock.calls[0]?.[0] as
      | { readonly where?: Record<string, unknown> }
      | undefined
    expect(productQuery?.where).toMatchObject({
      status: 'ACTIVE',
      supplierValue: 'SUPPLIER_TW_01',
    })
  })

  it('rejects disabled suppliers and inconsistent primary images', async () => {
    const disabled = setup()
    disabled.dictionaryLookup.resolveStoredValue.mockResolvedValue({
      known: true,
      effectiveEnabled: false,
      value: 'SUPPLIER_TW_01',
    })
    await expect(disabled.service.productOptions('sales-order-id', {
      supplierValue: 'SUPPLIER_TW_01',
    })).rejects.toMatchObject({ code: 'SALES_ORDER_ADD_ON_SUPPLIER_UNAVAILABLE' })

    const duplicateImage = setup()
    duplicateImage.prisma.product.findMany.mockResolvedValue([{
      id: 'product-id',
      productNo: 'P-002',
      name: '加购产品',
      supplierValue: 'SUPPLIER_TW_01',
      attributes: [],
      twdSalePriceAmount: decimal('80'),
      myrSalePriceAmount: decimal('12'),
      media: [{ id: 'media-a' }, { id: 'media-b' }],
    }])
    await expect(duplicateImage.service.productOptions('sales-order-id', {
      supplierValue: 'SUPPLIER_TW_01',
    })).rejects.toMatchObject({ code: 'SALES_ORDER_STATE_CHANGED' })
  })
})
