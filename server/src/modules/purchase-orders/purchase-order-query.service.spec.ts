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
      shippingMarkText: 'MARK',
      supplier: { value: 'SUPPLIER_A', label: '供应商 A' },
      createdBy: { id: 'actor-id', displayName: '采购员' },
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
      select?: unknown
    } | undefined)
    expect(where?.where).toMatchObject({
      orderStatus: 'CONFIRMED',
      AND: [{ OR: [
        { fulfillmentStatus: { not: 'SIGNED' } },
        { paymentStatus: { not: 'PAID' } },
      ] }],
      OR: [
        { orderNo: { contains: 'PO', mode: 'insensitive' } },
        { salesOrder: { is: {
          orderNo: { contains: 'PO', mode: 'insensitive' },
        } } },
        { salesOrder: { is: {
          customerName: { contains: 'PO', mode: 'insensitive' },
        } } },
        { shippingMarkText: { contains: 'PO', mode: 'insensitive' } },
      ],
    })
    expect(where?.orderBy).toEqual([{ orderDate: 'desc' }, { id: 'desc' }])
    expect(where?.select).toMatchObject({
      createdBy: { select: { id: true, displayName: true } },
      shippingMarkText: true,
    })
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
      orderStatus: 'CONFIRMED',
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

describe('PurchaseOrderQueryService status counts', () => {
  function createStatusCountsFixture() {
    const purchaseOrder = {
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>(),
    }
    const transaction = jest.fn(async (
      operation: (client: { purchaseOrder: typeof purchaseOrder }) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options
      return operation({ purchaseOrder })
    })
    const service = new PurchaseOrderQueryService({
      purchaseOrder,
      $transaction: transaction,
    } as unknown as PrismaService, {
      resolveStoredValues: jest.fn(),
      resolveStoredValue: jest.fn(),
    } as unknown as DictionaryLookupService)
    return { purchaseOrder, service, transaction }
  }

  it('counts all order statuses under the shared base filters and fills missing groups with zero', async () => {
    const fixture = createStatusCountsFixture()
    fixture.purchaseOrder.groupBy.mockResolvedValueOnce([{
      orderStatus: 'CONFIRMED',
      _count: { _all: 5 },
    }, {
      orderStatus: 'COMPLETED',
      _count: { _all: 2 },
    }])

    await expect(fixture.service.statusCounts({
      view: 'all',
      keyword: '  客户甲  ',
      supplierValue: 'SUPPLIER_A',
      purchaseType: 'SALES_LINKED',
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PAID',
      orderDateFrom: '2026-08-01',
      orderDateTo: '2026-08-31',
    })).resolves.toEqual({
      view: 'all',
      items: [
        { value: 'ALL', count: 7 },
        { value: 'CONFIRMED', count: 5 },
        { value: 'COMPLETED', count: 2 },
        { value: 'CANCELLED', count: 0 },
      ],
    })

    const query = fixture.purchaseOrder.groupBy.mock.calls[0]?.[0] as {
      by?: unknown
      where?: unknown
      _count?: unknown
    }
    expect(query.by).toEqual(['orderStatus'])
    expect(query.where).toMatchObject({
        supplierValue: 'SUPPLIER_A',
        purchaseType: 'SALES_LINKED',
        fulfillmentStatus: 'SIGNED',
        paymentStatus: 'PAID',
        orderDate: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T00:00:00.000Z'),
        },
        OR: [
          { orderNo: { contains: '客户甲', mode: 'insensitive' } },
          { salesOrder: { is: {
            orderNo: { contains: '客户甲', mode: 'insensitive' },
          } } },
          { salesOrder: { is: {
            customerName: { contains: '客户甲', mode: 'insensitive' },
          } } },
          { shippingMarkText: { contains: '客户甲', mode: 'insensitive' } },
        ],
    })
    expect(query._count).toEqual({ _all: true })
  })

  it('counts overlapping pending categories in one repeatable-read snapshot', async () => {
    const fixture = createStatusCountsFixture()
    fixture.purchaseOrder.groupBy
      .mockResolvedValueOnce([
        { fulfillmentStatus: 'ORDERED', _count: { _all: 4 } },
        { fulfillmentStatus: 'PREPARING', _count: { _all: 3 } },
        { fulfillmentStatus: 'SHIPPED', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { paymentStatus: 'UNPAID', _count: { _all: 5 } },
        { paymentStatus: 'PARTIALLY_PAID', _count: { _all: 1 } },
      ])

    await expect(fixture.service.statusCounts({ view: 'pending' })).resolves.toEqual({
      view: 'pending',
      items: [
        { value: 'AWAITING_SHIPMENT', count: 7 },
        { value: 'AWAITING_WAREHOUSE', count: 2 },
        { value: 'AWAITING_PAYMENT', count: 6 },
      ],
    })

    const pendingBaseWhere = {
      AND: [
        expect.objectContaining({
          fulfillmentStatus: undefined,
          paymentStatus: undefined,
          purchaseType: undefined,
          supplierValue: undefined,
          orderDate: undefined,
        }),
        { orderStatus: 'CONFIRMED' },
      ],
    }
    expect(fixture.purchaseOrder.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['fulfillmentStatus'],
      where: pendingBaseWhere,
      _count: { _all: true },
    })
    expect(fixture.purchaseOrder.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['paymentStatus'],
      where: pendingBaseWhere,
      _count: { _all: true },
    })
    expect(fixture.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' },
    )
  })
})
