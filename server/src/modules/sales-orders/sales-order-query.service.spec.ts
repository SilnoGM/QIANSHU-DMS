import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderQueryService } from './sales-order-query.service'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_MEDIA_ID = '22222222-2222-4222-8222-222222222222'
const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333'
const SALES_ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'
const CUSTOM_LINE_ID = '55555555-5555-4555-8555-555555555555'
const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666'
const MEDIA_ASSET_ID = '77777777-7777-4777-8777-777777777777'
const ISSUER_ID = '88888888-8888-4888-8888-888888888888'

function decimal(value: string) {
  return { toFixed: jest.fn().mockReturnValue(value) }
}

function createFixture(
  media = [{ id: PRODUCT_MEDIA_ID }],
  twdSalePriceAmount: ReturnType<typeof decimal> | null = decimal('1234.50'),
  myrSalePriceAmount: ReturnType<typeof decimal> | null = decimal('168.00'),
) {
  const product = {
    count: jest.fn().mockImplementation((args: { where?: { categoryId?: unknown } }) => (
      Promise.resolve(args.where?.categoryId === null ? 1 : 5)
    )),
    groupBy: jest.fn().mockResolvedValue([
      { categoryName: '收纳包', productHeadName: '城市旅行', _count: { _all: 4 } },
      { categoryName: null, productHeadName: null, _count: { _all: 1 } },
    ]),
    findMany: jest.fn().mockResolvedValue([{
      id: PRODUCT_ID,
      productNo: 'SKU-TW-001',
      name: '城市旅行收纳包',
      category: { name: '收纳包' },
      productHead: { name: '城市旅行' },
      supplierValue: 'SUPPLIER_TW_01',
      attributes: [{ key: 'color', value: 'green' }],
      twdSalePriceAmount,
      myrSalePriceAmount,
      media,
    }]),
  }
  const productCategory = {
    findMany: jest.fn().mockResolvedValue([{
      name: '收纳包',
      _count: { products: 4 },
      productHeads: [{
        name: '城市旅行',
        _count: { products: 4 },
      }],
    }, {
      name: '空分类',
      _count: { products: 0 },
      productHeads: [],
    }]),
  }
  const service = new SalesOrderQueryService({ product, productCategory } as unknown as PrismaService)
  return { prisma: { product, productCategory }, product, productCategory, service }
}

function createListFixture() {
  const listRow = {
    id: SALES_ORDER_ID,
    orderNo: 'SO-20260823-0001',
    orderDate: new Date('2026-08-22T00:00:00.000Z'),
    issuer: { id: ISSUER_ID, displayName: 'SilnoGM', profile: null },
    currencyCode: 'TWD',
    customerName: '林测试',
    customerPhone: '0912345678',
    customerProvinceStateNameSnapshot: '台湾',
    customerCityNameSnapshot: '新北市',
    customerFullAddressSnapshot: '中国台湾台湾新北市板桥区测试路1号',
    lineSubtotalAmount: decimal('1200.00'),
    agreedTotalAmount: decimal('1200.00'),
    depositDueAmount: decimal('200.00'),
    balanceDueAmount: decimal('1000.00'),
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
    payments: [{ amount: decimal('200.00') }],
    lines: [{
      id: SALES_ORDER_LINE_ID,
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      productNameSnapshot: '城市旅行收纳包',
      standardUnitPriceAmount: decimal('600.00'),
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
      documentType: 'ORDER_ISSUANCE_VOUCHER',
      title: '林测试-出单凭证-20260822090000',
      mediaAsset: { mediaType: 'IMAGE' },
    }],
  }
  const salesOrder = {
    count: jest.fn<Promise<number>, [{ where: unknown }]>().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([listRow]),
    aggregate: jest.fn()
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('1200.00'),
          depositDueAmount: decimal('200.00'),
          balanceDueAmount: decimal('1000.00'),
        },
      })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('800.00'),
          depositDueAmount: decimal('300.00'),
          balanceDueAmount: decimal('500.00'),
        },
      }),
  }
  const salesOrderLine = {
    findMany: jest.fn()
      .mockResolvedValueOnce([{
        standardUnitPriceAmount: decimal('600.00'),
        quantity: 2,
      }])
      .mockResolvedValueOnce([{
        standardUnitPriceAmount: decimal('400.00'),
        quantity: 2,
      }]),
  }
  const salesOrderPayment = {
    aggregate: jest.fn()
      .mockResolvedValueOnce({ _sum: { amount: decimal('200.00') } })
      .mockResolvedValueOnce({ _sum: { amount: decimal('300.00') } }),
  }
  const transaction = jest.fn(async (operations: readonly Promise<unknown>[]) => (
    Promise.all(operations)
  ))
  const slhReconciliationBatchLine = {
    findMany: jest.fn().mockResolvedValue([]),
  }
  let awaitingReviewRows: unknown[] = []
  let summaryQueryCount = 0
  // 同一个 $queryRaw 同时服务「审核中覆盖」与「标准价小计」，按 SQL 形状分流。
  const queryRaw = jest.fn().mockImplementation((query: { strings?: readonly string[] }) => {
    const sql = query?.strings?.join(' ') ?? ''
    if (sql.includes('standard_unit_price_amount')) {
      summaryQueryCount += 1
      return Promise.resolve([{
        total: decimal(summaryQueryCount % 2 === 1 ? '1200.00' : '800.00'),
      }])
    }
    return Promise.resolve(awaitingReviewRows)
  })
  const service = new SalesOrderQueryService({
    salesOrder,
    salesOrderLine,
    salesOrderPayment,
    slhReconciliationBatchLine,
    $queryRaw: queryRaw,
    $transaction: transaction,
  } as unknown as PrismaService)
  return {
    listRow,
    salesOrder,
    salesOrderLine,
    salesOrderPayment,
    service,
    setAwaitingReviewRows: (rows: unknown[]) => {
      awaitingReviewRows = rows
    },
    slhReconciliationBatchLine,
    queryRaw,
    transaction,
  }
}

describe('SalesOrderQueryService list summaries', () => {
  it('returns bounded row summaries and fixed currency aggregates without per-row queries', async () => {
    const fixture = createListFixture()

    await expect(fixture.service.list({
      issuerUserId: ISSUER_ID,
      page: 1,
      pageSize: 20,
    })).resolves.toEqual({
      items: [{
        id: SALES_ORDER_ID,
        orderNo: 'SO-20260823-0001',
        orderDate: '2026-08-22',
        issuer: { id: '88888888-8888-4888-8888-888888888888', displayName: 'SilnoGM', avatarUrl: null },
        currencyCode: 'TWD',
        customerName: '林测试',
        customerPhone: '0912345678',
        customerProvinceStateName: '台湾',
        customerCityName: '新北市',
        customerFullAddress: '中国台湾台湾新北市板桥区测试路1号',
        standardSubtotalAmount: '1200.00',
        lineSubtotalAmount: '1200.00',
        agreedTotalAmount: '1200.00',
        depositDueAmount: '200.00',
        balanceDueAmount: '1000.00',
        receivedAmount: '200.00',
        outstandingAmount: '1000.00',
        remark: '客户要求周末送达',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        paymentStatus: 'PARTIALLY_PAID',
        completionHold: null,
        purchaseHold: null,
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
            documentType: 'ORDER_ISSUANCE_VOUCHER',
            title: '林测试-出单凭证-20260822090000',
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
        standardSubtotalAmount: '1200.00',
        agreedTotalAmount: '1200.00',
        depositDueAmount: '200.00',
        balanceDueAmount: '1000.00',
        receivedAmount: '200.00',
        outstandingAmount: '1000.00',
      }, {
        currencyCode: 'MYR',
        orderCount: 1,
        standardSubtotalAmount: '800.00',
        agreedTotalAmount: '800.00',
        depositDueAmount: '300.00',
        balanceDueAmount: '500.00',
        receivedAmount: '300.00',
        outstandingAmount: '500.00',
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    // 当前页一次，TWD/MYR 标准价汇总各取一次订单 ID。
    expect(fixture.salesOrder.findMany).toHaveBeenCalledTimes(3)
    expect(fixture.salesOrder.aggregate).toHaveBeenCalledTimes(2)
    expect(fixture.salesOrderLine.findMany).not.toHaveBeenCalled()
    expect(fixture.salesOrderPayment.aggregate).toHaveBeenCalledTimes(2)
    expect(fixture.salesOrder.count).toHaveBeenCalledWith({
      where: {
        currencyCode: undefined,
        fulfillmentStatus: undefined,
        issuerUserId: ISSUER_ID,
        orderDate: undefined,
        orderStatus: undefined,
        paymentStatus: undefined,
      },
    })
  })

  it('uses one wrapped OR predicate for the all-orders selection', async () => {
    const fixture = createListFixture()

    await fixture.service.list({
      view: 'all',
      statusSelection: 'ALL',
      page: 1,
      pageSize: 20,
    })

    const countArgs = fixture.salesOrder.count.mock.calls[0]?.[0] as {
      where: { AND?: Array<{ OR?: unknown[] }> }
    }
    expect(countArgs.where.AND?.[0]?.OR).toEqual([
      { orderStatus: 'CONFIRMED' },
      { orderStatus: 'PENDING_RECONCILIATION' },
      { orderStatus: 'CANCELLED' },
      { orderStatus: 'COMPLETED' },
    ])
    // 单条 OR 谓词同时服务总数、当前页与汇总，不再按状态拆成多次查询。
    expect(fixture.salesOrder.count).toHaveBeenCalledTimes(1)
    const listArgs = (fixture.salesOrder.findMany.mock.calls[0] as [
      { where?: { AND?: unknown[] } },
    ] | undefined)?.[0]
    expect(Array.isArray(listArgs?.where?.AND)).toBe(true)
  })

  it('adds the reconciliation hold for pending orders with one batched coverage read', async () => {
    const fixture = createListFixture()
    fixture.listRow.orderStatus = 'PENDING_RECONCILIATION'
    fixture.listRow.fulfillmentStatus = 'SIGNED'
    fixture.listRow.paymentStatus = 'PAID'
    fixture.slhReconciliationBatchLine.findMany.mockResolvedValue([{
      batchId: 'batch-1',
      reconciledAt: null,
      batch: { completedAt: null },
      matchedLoadingItem: { shipment: { purchaseOrder: { salesOrderId: SALES_ORDER_ID } } },
    }])

    const page = await fixture.service.list({ page: 1, pageSize: 20 })

    expect(page.items[0]?.completionHold).toEqual({
      reason: 'RECONCILIATION_IN_PROGRESS',
      pendingBatchCount: 1,
      unreconciledMemberCount: 1,
    })
    // 对账覆盖按当页订单一次性读取，不随行数增长。
    expect(fixture.slhReconciliationBatchLine.findMany).toHaveBeenCalledTimes(1)

    // 非待对账订单不读取对账覆盖。
    const confirmed = createListFixture()
    const confirmedPage = await confirmed.service.list({ page: 1, pageSize: 20 })
    expect(confirmedPage.items[0]?.completionHold).toBeNull()
    expect(confirmed.slhReconciliationBatchLine.findMany).not.toHaveBeenCalled()
  })

  it('moves orders whose quantity is fully preempted by pending review into their own bucket', async () => {
    const awaiting = createListFixture()
    awaiting.listRow.orderStatus = 'CONFIRMED'
    awaiting.listRow.fulfillmentStatus = 'PENDING'
    awaiting.setAwaitingReviewRows([{
      salesOrderId: SALES_ORDER_ID,
      pendingReviewOrderCount: 2,
    }])

    const awaitingPage = await awaiting.service.list({
      page: 1,
      pageSize: 20,
      purchaseHold: 'AWAITING_PURCHASE_REVIEW',
    })

    expect(awaitingPage.items[0]?.purchaseHold).toEqual({
      reason: 'AWAITING_PURCHASE_REVIEW',
      pendingReviewOrderCount: 2,
    })
    const awaitingWhere = awaiting.salesOrder.count.mock.calls[0]?.[0] as {
      where: { id?: { in?: readonly string[] } }
    }
    expect(awaitingWhere.where.id).toEqual({ in: [SALES_ORDER_ID] })
    // 分类只读取一次；另外两次是 TWD/MYR 标准价汇总。
    expect(awaiting.queryRaw).toHaveBeenCalledTimes(3)

    const purchasable = createListFixture()
    purchasable.setAwaitingReviewRows([{
      salesOrderId: SALES_ORDER_ID,
      pendingReviewOrderCount: 1,
    }])

    await purchasable.service.list({
      page: 1,
      pageSize: 20,
      purchaseHold: 'EXCLUDE_AWAITING_PURCHASE_REVIEW',
    })

    // 待采购必须排除审核中订单，两个分类互斥。
    const purchasableWhere = purchasable.salesOrder.count.mock.calls[0]?.[0] as {
      where: { id?: { notIn?: readonly string[] } }
    }
    expect(purchasableWhere.where.id).toEqual({ notIn: [SALES_ORDER_ID] })
  })

  it('omits currencies that have no orders in the filtered result', async () => {
    const fixture = createListFixture()
    fixture.salesOrder.aggregate
      .mockReset()
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: {
          agreedTotalAmount: decimal('1200.00'),
          depositDueAmount: decimal('200.00'),
          balanceDueAmount: decimal('1000.00'),
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
      .mockResolvedValueOnce({ _sum: { amount: decimal('200.00') } })
      .mockResolvedValueOnce({ _sum: { amount: null } })

    const result = await fixture.service.list({ currencyCode: 'TWD' })

    expect(result.summariesByCurrency).toEqual([{
      currencyCode: 'TWD',
      orderCount: 1,
      standardSubtotalAmount: '1200.00',
      agreedTotalAmount: '1200.00',
      depositDueAmount: '200.00',
      balanceDueAmount: '1000.00',
      receivedAmount: '200.00',
      outstandingAmount: '1000.00',
    }])
  })

  it('returns every product line preview so the client can fold additional images', async () => {
    const fixture = createListFixture()
    const additionalLines = [1, 2, 3].map(index => ({
      id: `99999999-9999-4999-8999-99999999999${index}`,
      lineType: 'CATALOG',
      productId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
      productNameSnapshot: `追加产品 ${index}`,
      standardUnitPriceAmount: decimal(`${index}.00`),
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

describe('SalesOrderQueryService issuer options', () => {
  it('reads active and disabled users directly from the user database', async () => {
    const users = [{
      id: ISSUER_ID,
      displayName: 'SilnoGM',
      status: 'ACTIVE',
    }, {
      id: '99999999-9999-4999-8999-999999999999',
      displayName: '历史出单人',
      status: 'DISABLED',
    }]
    const user = { findMany: jest.fn().mockResolvedValue(users) }
    const service = new SalesOrderQueryService({ user } as unknown as PrismaService)

    await expect(service.issuerOptions()).resolves.toEqual({ items: users })
    expect(user.findMany).toHaveBeenCalledWith({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, status: true },
    })
  })
})

describe('SalesOrderQueryService status counts', () => {
  function createStatusCountsFixture() {
    const salesOrder = {
      count: jest.fn(),
      groupBy: jest.fn(),
    }
    const queryRaw = jest.fn().mockResolvedValue([])
    const transaction = jest.fn(async (
      operation: (client: { salesOrder: typeof salesOrder, $queryRaw: typeof queryRaw }) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options
      return operation({ salesOrder, $queryRaw: queryRaw })
    })
    const service = new SalesOrderQueryService({
      salesOrder,
      $queryRaw: queryRaw,
      $transaction: transaction,
    } as unknown as PrismaService)
    return { salesOrder, queryRaw, service, transaction }
  }

  it('counts only formal order statuses for the all view and fills missing groups with zero', async () => {
    const fixture = createStatusCountsFixture()
    fixture.salesOrder.groupBy.mockResolvedValueOnce([{
      orderStatus: 'CONFIRMED',
      _count: { _all: 7 },
    }, {
      orderStatus: 'COMPLETED',
      _count: { _all: 2 },
    }])

    await expect(fixture.service.statusCounts({
      view: 'all',
      keyword: '  客户甲  ',
      currencyCode: 'TWD',
      issuerUserId: ISSUER_ID,
      paymentStatus: 'PAID',
      orderDateFrom: '2026-08-01',
      orderDateTo: '2026-08-31',
    })).resolves.toEqual({
      view: 'all',
      items: [
        { value: 'ALL', count: 9 },
        { value: 'CONFIRMED', count: 7 },
        { value: 'PENDING_RECONCILIATION', count: 0 },
        { value: 'CANCELLED', count: 0 },
        { value: 'COMPLETED', count: 2 },
      ],
    })

    expect(fixture.salesOrder.groupBy).toHaveBeenCalledWith({
      by: ['orderStatus'],
      where: {
        AND: [
          expect.objectContaining({
            currencyCode: 'TWD',
            issuerUserId: ISSUER_ID,
            paymentStatus: 'PAID',
            orderDate: {
              gte: new Date('2026-08-01T00:00:00.000Z'),
              lte: new Date('2026-08-31T00:00:00.000Z'),
            },
            OR: [
              { orderNo: { contains: '客户甲', mode: 'insensitive' } },
              { customerName: { contains: '客户甲', mode: 'insensitive' } },
              { customerPhone: { contains: '客户甲' } },
            ],
          }),
          {
            orderStatus: {
              in: ['CONFIRMED', 'PENDING_RECONCILIATION', 'CANCELLED', 'COMPLETED'],
            },
          },
        ],
      },
      _count: { _all: true },
    })
  })

  it('counts overlapping pending categories and uses a repeatable-read snapshot for unique ALL', async () => {
    const fixture = createStatusCountsFixture()
    fixture.salesOrder.groupBy
      .mockResolvedValueOnce([
        { fulfillmentStatus: 'PENDING', _count: { _all: 4 } },
        { fulfillmentStatus: 'PREPARING', _count: { _all: 3 } },
        { fulfillmentStatus: 'SEA_TRANSIT', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { paymentStatus: 'UNPAID', _count: { _all: 5 } },
        { paymentStatus: 'PARTIALLY_PAID', _count: { _all: 1 } },
      ])
    fixture.salesOrder.count.mockResolvedValueOnce(11)

    await expect(fixture.service.statusCounts({ view: 'pending' })).resolves.toEqual({
      view: 'pending',
      items: [
        { value: 'ALL', count: 11 },
        { value: 'PENDING', count: 4 },
        { value: 'AWAITING_PURCHASE_REVIEW', count: 0 },
        { value: 'PREPARING', count: 3 },
        { value: 'LAND_TRANSIT', count: 0 },
        { value: 'WAREHOUSE_ARRIVED', count: 0 },
        { value: 'SEA_TRANSIT', count: 2 },
        { value: 'WAITING_PAYMENT', count: 6 },
      ],
    })

    const pendingBaseWhere = {
      AND: [
        expect.objectContaining({
          currencyCode: undefined,
          issuerUserId: undefined,
          orderDate: undefined,
          paymentStatus: undefined,
        }),
        { orderStatus: 'CONFIRMED' },
      ],
    }
    expect(fixture.salesOrder.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['fulfillmentStatus'],
      where: pendingBaseWhere,
      _count: { _all: true },
    })
    expect(fixture.salesOrder.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['paymentStatus'],
      where: pendingBaseWhere,
      _count: { _all: true },
    })
    expect(fixture.salesOrder.count).toHaveBeenCalledWith({
      where: {
        AND: [
          pendingBaseWhere,
          { OR: [
            { fulfillmentStatus: { in: [
              'PENDING',
              'PREPARING',
              'LAND_TRANSIT',
              'WAREHOUSE_ARRIVED',
              'SEA_TRANSIT',
            ] } },
            { paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
          ] },
        ],
      },
    })
    expect(fixture.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' },
    )
  })

  it('moves awaiting-review orders out of the pending count into their own bucket', async () => {
    const fixture = createStatusCountsFixture()
    fixture.salesOrder.groupBy
      .mockResolvedValueOnce([
        { fulfillmentStatus: 'PENDING', _count: { _all: 4 } },
        { fulfillmentStatus: 'PREPARING', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([{ paymentStatus: 'UNPAID', _count: { _all: 2 } }])
    fixture.queryRaw.mockResolvedValue([{
      salesOrderId: SALES_ORDER_ID,
      pendingReviewOrderCount: 1,
    }])
    fixture.salesOrder.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)

    const counts = await fixture.service.statusCounts({ view: 'pending' })
    const countByValue = new Map(counts.items.map(item => [item.value, item.count]))

    expect(countByValue.get('PENDING')).toBe(1)
    expect(countByValue.get('AWAITING_PURCHASE_REVIEW')).toBe(3)
    // 分类计数必须和列表共用同一份覆盖判定，避免角标与列表条数漂移。
    expect(fixture.salesOrder.count).toHaveBeenNthCalledWith(2, {
      where: {
        AND: [
          expect.any(Object),
          { fulfillmentStatus: 'PENDING', id: { in: [SALES_ORDER_ID] } },
        ],
      },
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
        categoryName: '收纳包',
        productHeadName: '城市旅行',
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [{ key: 'color', value: 'green' }],
        standardUnitPriceAmount: '1234.50',
        currencyCode: 'TWD',
        mainImage: {
          id: PRODUCT_MEDIA_ID,
          contentUrl: `/api/sales-orders/product-options/${PRODUCT_ID}/main-image/${PRODUCT_MEDIA_ID}/content?currencyCode=TWD`,
        },
      }],
      categories: [
        { name: '收纳包', count: 4, productHeads: [{ name: '城市旅行', count: 4 }] },
        { name: '空分类', count: 0, productHeads: [] },
      ],
      unclassifiedCount: 1,
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
    expect(fixture.productCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierValue: 'SUPPLIER_TW_01' },
        orderBy: [
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
      }),
    )
    expect(fixture.product.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { category: { name: 'asc' } },
        { productHead: { sortOrder: 'asc' } },
        { productHead: { name: 'asc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
        { id: 'asc' },
      ],
      skip: 2,
      take: 2,
      select: {
        id: true,
        productNo: true,
        name: true,
        category: { select: { name: true } },
        productHead: { select: { name: true } },
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
      supplierValue: 'SUPPLIER_TW_01',
    })).resolves.toEqual({
      items: [{
        id: PRODUCT_ID,
        productNo: 'SKU-TW-001',
        name: '城市旅行收纳包',
        categoryName: '收纳包',
        productHeadName: '城市旅行',
        supplierValue: 'SUPPLIER_TW_01',
        attributes: [{ key: 'color', value: 'green' }],
        standardUnitPriceAmount: null,
        currencyCode: 'TWD',
        mainImage: null,
      }],
      categories: [
        { name: '收纳包', count: 4, productHeads: [{ name: '城市旅行', count: 4 }] },
        { name: '空分类', count: 0, productHeads: [] },
      ],
      unclassifiedCount: 1,
      page: 1,
      pageSize: 20,
      total: 5,
    })

    expect(fixture.product.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', supplierValue: 'SUPPLIER_TW_01' },
    })
  })

  it('fails closed when persisted state exposes more than one qualified main image', async () => {
    const fixture = createFixture([
      { id: PRODUCT_MEDIA_ID },
      { id: '33333333-3333-4333-8333-333333333333' },
    ])

    await expect(fixture.service.productOptions({
      currencyCode: 'MYR',
      supplierValue: 'SUPPLIER_TW_01',
    })).rejects.toMatchObject({
      code: 'SALES_ORDER_STATE_CHANGED',
    })
  })

  it('returns 404 for a SELF-scoped order owned by another issuer', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const service = new SalesOrderQueryService(
      { salesOrder: { findFirst } } as unknown as PrismaService,
      { resolve: jest.fn().mockResolvedValue('SELF') } as never,
    )

    await expect(service.getById(SALES_ORDER_ID, ISSUER_ID)).rejects.toMatchObject({
      code: 'SALES_ORDER_NOT_FOUND',
      status: 404,
    })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: SALES_ORDER_ID, issuerUserId: ISSUER_ID },
    }))
  })
})
