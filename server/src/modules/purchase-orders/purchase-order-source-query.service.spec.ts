import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

function setup() {
  const prisma = {
    product: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'product-id',
        productNo: 'P-001',
        name: '采购产品',
        attributes: [],
        supplierValue: 'SUPPLIER_A',
        purchaseCostAmount: decimal('12.34'),
        purchaseCostCurrency: 'CNY',
        media: [{ id: 'product-media-id' }],
      }]),
    },
    salesOrder: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'sales-order-id',
        orderNo: 'SO-001',
        orderDate: new Date('2026-08-26T00:00:00.000Z'),
        issuer: { id: 'issuer-id', displayName: '出单人甲' },
        customerName: '客户甲',
        lineSubtotalAmount: decimal('100'),
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        lines: [{
          id: 'sales-line-id',
          productId: 'product-id',
          productNameSnapshot: '销售快照产品',
          quantity: 5,
          product: { media: [{ id: 'product-media-id' }] },
        }, {
          id: 'custom-line-id',
          productId: null,
          productNameSnapshot: '本单临时服务',
          quantity: 1,
          product: null,
        }],
      }]),
      findFirst: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'sales-order-id', orderNo: 'SO-001', customerName: '客户甲' }),
    },
    salesOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'sales-line-id',
        lineNumber: 1,
        lineType: 'CATALOG',
        productId: 'product-id',
        productNoSnapshot: 'P-001',
        productNameSnapshot: '销售快照产品',
        productAttributesSnapshot: [],
        descriptionSnapshot: null,
        quantity: 5,
      }]),
    },
    purchaseOrderLine: {
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        sourceSalesOrderLineId: 'sales-line-id',
        _sum: { quantity: 2 },
      }]),
    },
  }
  const dictionaryLookup = {
    resolveStoredValue: jest.fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({
        known: true,
        dictionaryCode: 'service_provider.supplier',
        value: 'SUPPLIER_A',
        label: '供应商 A',
        tone: 'DEFAULT',
        typeEnabled: true,
        itemEnabled: true,
        effectiveEnabled: true,
      }),
  }
  const service = new PurchaseOrderSourceQueryService(
    prisma as unknown as PrismaService,
    dictionaryLookup as unknown as DictionaryLookupService,
  )
  return { dictionaryLookup, prisma, service }
}

describe('PurchaseOrderSourceQueryService', () => {
  it('returns only current ACTIVE CNY products for an effective supplier', async () => {
    const fixture = setup()
    await expect(fixture.service.productOptions({
      supplierValue: ' supplier_a ',
      keyword: '采购',
      page: 1,
      pageSize: 20,
    })).resolves.toEqual({
      items: [{
        id: 'product-id',
        productNo: 'P-001',
        name: '采购产品',
        attributes: [],
        supplierValue: 'SUPPLIER_A',
        referencePurchaseUnitPriceAmount: '12.3400',
        currencyCode: 'CNY',
        mainImage: {
          id: 'product-media-id',
          contentUrl:
            '/api/purchase-orders/product-options/product-id/main-image/product-media-id/content',
        },
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    const productQuery = fixture.prisma.product.findMany.mock.calls[0]?.[0] as
      | { select?: Record<string, unknown>, where?: Record<string, unknown> }
      | undefined
    expect(productQuery?.where).toMatchObject({
      status: 'ACTIVE',
      supplierValue: 'SUPPLIER_A',
      purchaseCostAmount: { not: null },
      purchaseCostCurrency: 'CNY',
    })
    expect(productQuery?.select).toMatchObject({
      media: {
        where: {
          kind: 'IMAGE',
          isPrimary: true,
          detachedAt: null,
          mediaAsset: { is: { status: 'READY' } },
        },
        take: 2,
        select: { id: true },
      },
    })
  })

  it('rejects inconsistent products that expose more than one current primary image', async () => {
    const fixture = setup()
    fixture.prisma.product.findMany.mockResolvedValue([{
      id: 'product-id',
      productNo: 'P-001',
      name: '采购产品',
      attributes: [],
      supplierValue: 'SUPPLIER_A',
      purchaseCostAmount: decimal('12.34'),
      purchaseCostCurrency: 'CNY',
      media: [{ id: 'media-a' }, { id: 'media-b' }],
    }])

    await expect(fixture.service.productOptions({
      supplierValue: 'SUPPLIER_A',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
  })

  it('rejects an unknown or disabled supplier before reading products', async () => {
    const fixture = setup()
    fixture.dictionaryLookup.resolveStoredValue.mockResolvedValue({
      known: false,
      dictionaryCode: 'service_provider.supplier',
      value: 'MISSING',
    })
    await expect(fixture.service.productOptions({
      supplierValue: 'MISSING',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE' })
    expect(fixture.prisma.product.findMany).not.toHaveBeenCalled()
  })

  it('returns selector-ready CONFIRMED sales-order sources', async () => {
    const fixture = setup()
    await expect(fixture.service.salesOrders({ keyword: 'SO' })).resolves.toEqual({
      items: [{
        id: 'sales-order-id',
        orderNo: 'SO-001',
        orderDate: '2026-08-26',
        issuer: { id: 'issuer-id', displayName: '出单人甲' },
        customerName: '客户甲',
        salesTotalAmount: '100.0000',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        lineSummary: {
          lineCount: 2,
          totalQuantity: 6,
          previews: [{
            lineId: 'sales-line-id',
            productName: '销售快照产品',
            mainImage: {
              id: 'product-media-id',
              contentUrl: '/api/purchase-orders/source-sales-orders/sales-order-id/lines/sales-line-id/main-image/product-media-id/content',
            },
          }, {
            lineId: 'custom-line-id',
            productName: '本单临时服务',
            mainImage: null,
          }],
        },
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    const sourceQuery = fixture.prisma.salesOrder.findMany.mock.calls[0]?.[0] as
      | { select?: Record<string, unknown>, where?: Record<string, unknown> }
      | undefined
    expect(sourceQuery?.where).toMatchObject({ orderStatus: 'CONFIRMED' })
    expect(sourceQuery?.select).toMatchObject({
      issuer: { select: { id: true, displayName: true } },
      orderStatus: true,
      fulfillmentStatus: true,
      paymentStatus: true,
      lines: {
        select: {
          id: true,
          productId: true,
          productNameSnapshot: true,
          quantity: true,
          product: {
            select: {
              media: {
                where: {
                  kind: 'IMAGE',
                  isPrimary: true,
                  detachedAt: null,
                  mediaAsset: { is: { status: 'READY' } },
                },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      },
    })
  })

  it('returns source lines with remaining quantity after active purchases', async () => {
    const fixture = setup()
    await expect(fixture.service.salesOrderLines('sales-order-id')).resolves.toEqual({
      salesOrder: { id: 'sales-order-id', orderNo: 'SO-001', customerName: '客户甲' },
      items: [expect.objectContaining({
        id: 'sales-line-id',
        quantity: 5,
        purchasedQuantity: 2,
        remainingQuantity: 3,
      })],
    })
  })
})
