import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import { PurchaseOrderQueryService } from './purchase-order-query.service'

function decimal(value: string) {
  return { toFixed: () => Number(value).toFixed(4) }
}

const listLines = [{
  id: 'line-catalog-image-1',
  lineType: 'CATALOG',
  productId: 'product-1',
  productNameSnapshot: '目录产品一',
  quantity: 2,
  product: { media: [{ id: 'media-1' }] },
}, {
  id: 'line-catalog-empty',
  lineType: 'CATALOG',
  productId: 'product-2',
  productNameSnapshot: '目录产品无图',
  quantity: 3,
  product: { media: [] },
}, {
  id: 'line-custom',
  lineType: 'CUSTOM',
  productId: null,
  productNameSnapshot: '临时采购服务',
  quantity: 4,
  product: null,
}, ...[3, 4, 5].map(index => ({
  id: `line-catalog-image-${index}`,
  lineType: 'CATALOG',
  productId: `product-${index}`,
  productNameSnapshot: `目录产品${index}`,
  quantity: index + 2,
  product: { media: [{ id: `media-${index}` }] },
}))]

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-id',
    orderNo: 'PO-001',
    purchaseType: 'SALES_LINKED',
    supplierValue: 'SUPPLIER_A',
    orderDate: new Date('2026-08-27T00:00:00.000Z'),
    currencyCode: 'CNY',
    shippingMarkText: 'MARK',
    lineSubtotalAmount: decimal('100'),
    purchaseTotalAmount: decimal('100'),
    depositDueAmount: decimal('30'),
    balanceDueAmount: decimal('70'),
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    paymentStatus: 'PARTIALLY_PAID',
    remark: null,
    version: 1,
    createdAt: new Date('2026-08-27T01:00:00.000Z'),
    updatedAt: new Date('2026-08-27T02:00:00.000Z'),
    salesOrder: {
      id: 'sales-order-id',
      orderNo: 'SO-001',
      customerName: '客户甲',
    },
    lines: [],
    payments: [],
    documents: [],
    statusHistory: [],
    createdBy: { id: 'actor-id', displayName: '采购员' },
    ...overrides,
  }
}

function setup() {
  const prisma = {
    purchaseOrder: {
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([orderRow({ lines: listLines })]),
      findUnique: jest.fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue(orderRow({
          lines: [{
            id: 'line-id',
            lineNumber: 1,
            lineType: 'CATALOG',
            productId: 'product-id',
            sourceSalesOrderLineId: 'sales-line-id',
            productNoSnapshot: 'P-001',
            productNameSnapshot: '产品甲',
            productAttributesSnapshot: [],
            descriptionSnapshot: null,
            referencePurchaseUnitPriceAmount: decimal('12.34'),
            actualPurchaseUnitPriceAmount: decimal('10'),
            quantity: 10,
            lineTotalAmount: decimal('100'),
          }],
          payments: [{
            id: 'payment-id',
            paymentType: 'DEPOSIT',
            amount: decimal('30'),
            paidAt: new Date('2026-08-27T03:00:00.000Z'),
            paymentMethod: 'BANK',
            remark: null,
            createdAt: new Date('2026-08-27T03:00:00.000Z'),
            voidedAt: null,
            voidReason: null,
            createdBy: { id: 'actor-id', displayName: '采购员' },
            voidedBy: null,
          }],
        })),
    },
    purchaseOrderPayment: {
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{
          purchaseOrderId: 'order-id',
          _sum: { amount: decimal('30') },
        }]),
    },
  }
  const dictionaryLookup = {
    resolveStoredValues: jest.fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{
        known: true,
        dictionaryCode: 'service_provider.supplier',
        value: 'SUPPLIER_A',
        label: '供应商 A',
        tone: 'DEFAULT',
        typeEnabled: true,
        itemEnabled: true,
        effectiveEnabled: true,
      }]),
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
  const service = new PurchaseOrderQueryService(
    prisma as unknown as PrismaService,
    dictionaryLookup as unknown as DictionaryLookupService,
  )
  return { dictionaryLookup, prisma, service }
}

describe('PurchaseOrderQueryService', () => {
  it('builds the fixed pending predicate and maps paid/outstanding amounts', async () => {
    const fixture = setup()
    const page = await fixture.service.list({
      view: 'pending',
      page: 1,
      pageSize: 20,
      keyword: 'PO',
      supplierValue: 'SUPPLIER_A',
    })
    expect(page).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'order-id',
      orderNo: 'PO-001',
      salesOrderNo: 'SO-001',
      customerName: '客户甲',
      supplier: { value: 'SUPPLIER_A', label: '供应商 A' },
      purchaseTotalAmount: '100.0000',
      paidAmount: '30.0000',
      outstandingAmount: '70.0000',
      lineSummary: {
        lineCount: 6,
        totalQuantity: 27,
      },
    })
    expect(page.items[0]?.lineSummary.previews).toHaveLength(6)
    expect(page.items[0]?.lineSummary.previews.slice(0, 3)).toEqual([{
      lineId: 'line-catalog-image-1',
      productName: '目录产品一',
      mainImage: {
        id: 'media-1',
        contentUrl:
          '/api/purchase-orders/order-id/lines/line-catalog-image-1/main-image/media-1/content',
      },
    }, {
      lineId: 'line-catalog-empty',
      productName: '目录产品无图',
      mainImage: null,
    }, {
      lineId: 'line-custom',
      productName: '临时采购服务',
      mainImage: null,
    }])
    expect(page.items[0]?.lineSummary.previews.filter(
      preview => preview.mainImage !== null,
    )).toHaveLength(4)
    const where = (fixture.prisma.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where?: unknown
      orderBy?: unknown
    } | undefined)
    expect(where?.where).toMatchObject({
      orderStatus: { not: 'CANCELLED' },
      AND: [{ OR: [
        { fulfillmentStatus: { not: 'SIGNED' } },
        { paymentStatus: { not: 'PAID' } },
      ] }],
    })
    expect(where?.orderBy).toEqual([{ orderDate: 'desc' }, { id: 'desc' }])
  })

  it.each([
    ['AWAITING_SHIPMENT', { fulfillmentStatus: { in: ['ORDERED', 'PREPARING'] } }],
    ['AWAITING_WAREHOUSE', { fulfillmentStatus: 'SHIPPED' }],
    ['AWAITING_PAYMENT', { paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } }],
  ] as const)('builds the %s pending task predicate', async (pendingTask, taskClause) => {
    const fixture = setup()

    await fixture.service.list({ view: 'pending', pendingTask })

    const query = fixture.prisma.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where?: { orderStatus?: unknown, AND?: unknown[] }
    }
    expect(query.where).toMatchObject({
      orderStatus: { not: 'CANCELLED' },
      AND: [taskClause],
    })
  })

  it('returns detail customer through SalesOrder and derives active payment totals', async () => {
    const fixture = setup()
    await expect(fixture.service.getById('order-id')).resolves.toMatchObject({
      id: 'order-id',
      sourceSalesOrder: {
        id: 'sales-order-id',
        orderNo: 'SO-001',
        customerName: '客户甲',
      },
      amounts: {
        lineSubtotalAmount: '100.0000',
        purchaseTotalAmount: '100.0000',
        paidAmount: '30.0000',
        outstandingAmount: '70.0000',
      },
      lines: [expect.objectContaining({
        referencePurchaseUnitPriceAmount: '12.3400',
        actualPurchaseUnitPriceAmount: '10.0000',
      })],
      payments: [expect.objectContaining({ amount: '30.0000' })],
    })
  })

  it('returns a stable not-found contract', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(null)
    await expect(fixture.service.getById('missing')).rejects.toMatchObject({
      status: 404,
      code: 'PURCHASE_ORDER_NOT_FOUND',
    })
  })
})
