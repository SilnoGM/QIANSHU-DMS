import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function sqlShape(value: unknown): SqlShape {
  if (
    typeof value !== 'object'
    || value === null
    || !('strings' in value)
    || !Array.isArray(value.strings)
    || !('values' in value)
    || !Array.isArray(value.values)
  ) {
    throw new Error('Expected a parameterized Prisma SQL object')
  }
  return value as unknown as SqlShape
}

function sqlText(value: unknown): string {
  return sqlShape(value).strings.join(' ')
}

function sourceSalesOrderRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function setup() {
  const prisma = {
    $queryRaw: jest.fn<Promise<unknown>, [unknown]>(),
    product: {
      count: jest.fn<Promise<number>, [unknown]>().mockImplementation((args: unknown) => {
        const where = (args as { where?: { categoryId?: unknown } }).where
        return Promise.resolve(where?.categoryId === null ? 0 : 1)
      }),
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'product-id',
        productNo: 'P-001',
        name: '采购产品',
        category: { name: '农机' },
        productHead: { name: '微耕机' },
        attributes: [],
        supplierValue: 'SUPPLIER_A',
        purchaseCostAmount: decimal('12.34'),
        purchaseCostCurrency: 'CNY',
        media: [{ id: 'product-media-id' }],
      }]),
    },
    productCategory: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        name: '农机',
        _count: { products: 1 },
        productHeads: [{ name: '微耕机', _count: { products: 1 } }],
      }]),
    },
    salesOrder: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([sourceSalesOrderRow()]),
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
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'purchase-line-id',
        sourceSalesOrderLineId: 'sales-line-id',
        referencePurchaseUnitPriceAmount: decimal('12.34'),
        actualPurchaseUnitPriceAmount: decimal('11.50'),
        quantity: 2,
        lineTotalAmount: decimal('23.00'),
        descriptionSnapshot: '历史采购备注',
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

function prepareSourceFacts(
  fixture: ReturnType<typeof setup>,
  input: {
    readonly counts?: readonly { readonly view: string, readonly count: bigint }[]
    readonly page?: readonly {
      readonly id: string
      readonly lineIds: readonly string[]
      readonly remainingQuantity: bigint
    }[]
  } = {},
) {
  fixture.prisma.$queryRaw
    .mockResolvedValueOnce(input.counts ?? [
      { view: 'UNPURCHASED', count: 1n },
      { view: 'PARTIALLY_PURCHASED', count: 1n },
    ])
    .mockResolvedValueOnce(input.page ?? [{
      id: 'sales-order-id',
      lineIds: ['sales-line-id'],
      remainingQuantity: 3n,
    }])
}

describe('PurchaseOrderSourceQueryService', () => {
  it('uses only parameterized Prisma SQL for purchase-fact classification', () => {
    const source = readFileSync(
      join(__dirname, 'purchase-order-source-query.service.ts'),
      'utf8',
    )

    expect(source).toContain('Prisma.sql`')
    expect(source).not.toContain('$queryRawUnsafe')
  })

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
        categoryName: '农机',
        productHeadName: '微耕机',
        attributes: [],
        supplierValue: 'SUPPLIER_A',
        referencePurchaseUnitPriceAmount: '12.34',
        currencyCode: 'CNY',
        mainImage: {
          id: 'product-media-id',
          contentUrl:
            '/api/purchase-orders/product-options/product-id/main-image/product-media-id/content',
        },
      }],
      categories: [{ name: '农机', count: 1, productHeads: [{ name: '微耕机', count: 1 }] }],
      unclassifiedCount: 0,
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

  it('returns selector-ready confirmed sources from the unpurchased facts view', async () => {
    const fixture = setup()
    prepareSourceFacts(fixture)
    await expect(fixture.service.salesOrders({
      view: 'UNPURCHASED',
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_A',
      keyword: 'SO',
    })).resolves.toEqual({
      view: 'UNPURCHASED',
      counts: [
        { value: 'UNPURCHASED', count: 1 },
        { value: 'PARTIALLY_PURCHASED', count: 1 },
      ],
      items: [{
        id: 'sales-order-id',
        orderNo: 'SO-001',
        orderDate: '2026-08-26',
        issuer: { id: 'issuer-id', displayName: '出单人甲', avatarUrl: null },
        customerName: '客户甲',
        salesTotalAmount: '100.0000',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        lineSummary: {
          lineCount: 1,
          totalQuantity: 3,
          previews: [{
            lineId: 'sales-line-id',
            productName: '销售快照产品',
            mainImage: {
              id: 'product-media-id',
              contentUrl: '/api/purchase-orders/source-sales-orders/sales-order-id/lines/sales-line-id/main-image/product-media-id/content',
            },
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
    expect(sourceQuery?.where).toEqual({
      id: { in: ['sales-order-id'] },
      lines: { some: { id: { in: ['sales-line-id'] }, removedAt: null } },
    })
    expect(sourceQuery?.select).toMatchObject({
      issuer: { select: { id: true, displayName: true } },
      orderStatus: true,
      fulfillmentStatus: true,
      paymentStatus: true,
      lines: {
        where: { id: { in: ['sales-line-id'] }, removedAt: null },
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
    expect(fixture.prisma.salesOrder.count).not.toHaveBeenCalled()
    expect(fixture.prisma.$queryRaw).toHaveBeenCalledTimes(2)

    const [countsSql, pageSql] = fixture.prisma.$queryRaw.mock.calls
      .map(call => call[0])
    for (const sql of [countsSql, pageSql]) {
      const text = sqlText(sql)
      expect(text).toContain('source_sales_order_lines')
      expect(text).toContain('target_source_sales_order_lines')
      expect(text).toContain('target_remaining_lines')
      expect(text).toContain('source_line."removed_at" IS NULL')
      expect(text).toContain('purchased_by_line')
      expect(text).toContain('active_purchase_by_order')
      expect(text).toContain('source_sales_order_line_id')
      expect(text).toContain('purchase_type')
      expect(text).toContain('SALES_LINKED')
      expect(text).toContain('CANCELLED')
      expect(text).toContain('product_id')
      expect(sqlShape(sql).values).toContain('CATALOG')
      expect(sqlShape(sql).values).toContain('SUPPLIER_A')
      expect(sqlShape(sql).values).toContain('SO')
    }
    expect(sqlText(pageSql)).toContain('"order_date" DESC')
    expect(sqlText(pageSql)).toContain('"sales_order_id" DESC')
  })

  it('returns both counts with explicit zeroes and uses the requested fact view total', async () => {
    const fixture = setup()
    prepareSourceFacts(fixture, {
      counts: [{ view: 'PARTIALLY_PURCHASED', count: 7n }],
      page: [],
    })
    fixture.prisma.salesOrder.findMany.mockResolvedValue([])

    await expect(fixture.service.salesOrders({
      view: 'PARTIALLY_PURCHASED',
      productMode: 'CUSTOM',
    })).resolves.toMatchObject({
      view: 'PARTIALLY_PURCHASED',
      counts: [
        { value: 'UNPURCHASED', count: 0 },
        { value: 'PARTIALLY_PURCHASED', count: 7 },
      ],
      items: [],
      total: 7,
    })
    expect(fixture.dictionaryLookup.resolveStoredValue).not.toHaveBeenCalled()
  })

  it('parameterizes the exact sales order eligibility filter for shortcuts', async () => {
    const fixture = setup()
    prepareSourceFacts(fixture, { page: [] })

    await fixture.service.salesOrders({
      view: 'UNPURCHASED',
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_A',
      salesOrderId: '11111111-1111-4111-8111-111111111111',
    })

    for (const [sql] of fixture.prisma.$queryRaw.mock.calls) {
      expect(sqlText(sql)).toContain('source_order."id" = CAST(')
      expect(sqlShape(sql).values).toContain(
        '11111111-1111-4111-8111-111111111111',
      )
    }
  })

  it('loads only the current page summaries and restores raw order after Prisma loading', async () => {
    const fixture = setup()
    prepareSourceFacts(fixture, {
      counts: [
        { view: 'UNPURCHASED', count: 1n },
        { view: 'PARTIALLY_PURCHASED', count: 2n },
      ],
      page: [
        {
          id: 'sales-order-id',
          lineIds: ['sales-line-id'],
          remainingQuantity: 3n,
        },
        {
          id: 'second-sales-order-id',
          lineIds: ['sales-line-id'],
          remainingQuantity: 3n,
        },
      ],
    })
    fixture.prisma.salesOrder.findMany.mockResolvedValue([
      sourceSalesOrderRow({
        id: 'second-sales-order-id',
        orderNo: 'SO-002',
      }),
      sourceSalesOrderRow(),
    ])

    const result = await fixture.service.salesOrders({
      view: 'PARTIALLY_PURCHASED',
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_A',
      page: 2,
      pageSize: 2,
    })

    expect(result.items.map(item => item.id)).toEqual([
      'sales-order-id',
      'second-sales-order-id',
    ])
    expect(result.total).toBe(2)
    expect(fixture.prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {
        id: { in: [
          'sales-order-id',
          'second-sales-order-id',
        ] },
        lines: { some: { id: { in: ['sales-line-id'] }, removedAt: null } },
      } }),
    )
  })

  it('returns source lines with remaining quantity after active purchases', async () => {
    const fixture = setup()
    await expect(fixture.service.salesOrderLines('sales-order-id', {
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_A',
    })).resolves.toEqual({
      salesOrder: { id: 'sales-order-id', orderNo: 'SO-001', customerName: '客户甲' },
      items: [expect.objectContaining({
        id: 'sales-line-id',
        quantity: 5,
        purchasedQuantity: 2,
        remainingQuantity: 3,
        purchasedLines: [{
          id: 'purchase-line-id',
          referencePurchaseUnitPriceAmount: '12.3400',
          actualPurchaseUnitPriceAmount: '11.50',
          quantity: 2,
          lineTotalAmount: '23.00',
          description: '历史采购备注',
        }],
      })],
    })
    expect(fixture.prisma.purchaseOrderLine.findMany).toHaveBeenCalledWith({
      where: {
        sourceSalesOrderLineId: { in: ['sales-line-id'] },
        purchaseOrder: { orderStatus: { not: 'CANCELLED' } },
      },
      orderBy: [
        { purchaseOrder: { createdAt: 'asc' } },
        { purchaseOrderId: 'asc' },
        { lineNumber: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        sourceSalesOrderLineId: true,
        referencePurchaseUnitPriceAmount: true,
        actualPurchaseUnitPriceAmount: true,
        quantity: true,
        lineTotalAmount: true,
        descriptionSnapshot: true,
      },
    })
    expect(fixture.prisma.salesOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salesOrderId: 'sales-order-id',
          removedAt: null,
          lineType: 'CATALOG',
          product: { is: { supplierValue: 'SUPPLIER_A' } },
        },
      }),
    )
  })

  it('filters CUSTOM orders and lines without resolving a dictionary supplier', async () => {
    const fixture = setup()
    prepareSourceFacts(fixture, { page: [] })

    await fixture.service.salesOrders({
      view: 'UNPURCHASED',
      productMode: 'CUSTOM',
    })
    expect(fixture.dictionaryLookup.resolveStoredValue).not.toHaveBeenCalled()
    for (const [sql] of fixture.prisma.$queryRaw.mock.calls) {
      expect(sqlShape(sql).values).toContain('CUSTOM')
      expect(sqlShape(sql).values).not.toContain('SUPPLIER_A')
    }

    fixture.prisma.salesOrderLine.findMany.mockResolvedValue([{
      id: 'custom-line-id',
      lineNumber: 2,
      lineType: 'CUSTOM',
      productId: null,
      productNoSnapshot: null,
      productNameSnapshot: '本单临时服务',
      productAttributesSnapshot: [],
      descriptionSnapshot: null,
      quantity: 1,
    }])
    fixture.prisma.purchaseOrderLine.findMany.mockResolvedValue([])
    await expect(fixture.service.salesOrderLines('sales-order-id', {
      productMode: 'CUSTOM',
    })).resolves.toMatchObject({
      items: [{ lineType: 'CUSTOM', remainingQuantity: 1 }],
    })
    expect(fixture.prisma.salesOrderLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salesOrderId: 'sales-order-id',
          removedAt: null,
          lineType: 'CUSTOM',
        },
      }),
    )
  })

  it('rejects source lines when all target quantities are already purchased', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrderLine.findMany.mockResolvedValue([{
      id: 'purchase-line-id',
      sourceSalesOrderLineId: 'sales-line-id',
      referencePurchaseUnitPriceAmount: decimal('12.34'),
      actualPurchaseUnitPriceAmount: decimal('11.50'),
      quantity: 5,
      lineTotalAmount: decimal('57.50'),
      descriptionSnapshot: null,
    }])

    await expect(fixture.service.salesOrderLines('sales-order-id', {
      productMode: 'CATALOG',
      supplierValue: 'SUPPLIER_A',
    })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_STATE_CHANGED' })
  })

  it.each([
    [{ view: 'UNPURCHASED', productMode: 'CATALOG' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
    [{ view: 'UNPURCHASED', productMode: 'CUSTOM', supplierValue: 'SUPPLIER_A' }, 'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID'],
    [{ view: 'UNPURCHASED', productMode: 'MIXED' }, 'PURCHASE_ORDER_PRODUCT_MODE_INVALID'],
  ])('rejects an invalid source filter %#', async (input, code) => {
    const fixture = setup()
    await expect(fixture.service.salesOrders(input as never)).rejects.toMatchObject({ code })
    expect(fixture.prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
