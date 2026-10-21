import type { PaymentRecipientService } from '../payment-recipients/payment-recipient.service'
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
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER_A',
    customSupplierName: null,
    orderDate: new Date('2026-08-27T00:00:00.000Z'),
    currencyCode: 'CNY',
    shippingMarkText: 'MARK',
    parts: [],
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
    amountRevisions: [],
    _count: { parts: 0, payments: 0, statusHistory: 0, amountRevisions: 0 },
    createdBy: { id: 'actor-id', displayName: '采购员' },
    ...overrides,
  }
}

function setup() {
  const prisma = {
    purchaseOrder: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        _count: { _all: 1 },
        _sum: {
          balanceDueAmount: decimal('70'),
          depositDueAmount: decimal('30'),
          purchaseTotalAmount: decimal('100'),
        },
      }),
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1),
      findMany: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([orderRow({ lines: listLines, payments: [{ paymentType: 'DEPOSIT', amount: decimal('30'), voidedAt: null }] })]),
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
            referencePurchaseUnitPriceAmount: decimal('12.3456'),
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
    purchaseOrderStatusHistory: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([]),
    },
    purchaseOrderLine: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        quantity: 2,
        referencePurchaseUnitPriceAmount: decimal('15'),
      }, {
        quantity: 1,
        referencePurchaseUnitPriceAmount: decimal('10'),
      }]),
    },
    purchaseOrderPayment: {
      aggregate: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        _sum: { amount: decimal('30') },
      }),
      groupBy: jest.fn<Promise<unknown[]>, [unknown]>()
        .mockResolvedValue([{
          purchaseOrderId: 'order-id',
          _sum: { amount: decimal('30') },
        }]),
    },
    $transaction: jest.fn().mockImplementation(
      (operations: readonly Promise<unknown>[] | ((client: unknown) => Promise<unknown>)) =>
        typeof operations === 'function' ? operations(prisma) : Promise.all(operations),
    ),
  }
  ;(prisma.purchaseOrder as Record<string, unknown>).findFirst = prisma.purchaseOrder.findUnique
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
    { getForOrder: jest.fn().mockResolvedValue(null) } as unknown as PaymentRecipientService,
  )
  return { dictionaryLookup, prisma, service }
}

describe('PurchaseOrderQueryService', () => {
  it('returns a batched approval summary without replacing the latest status change', async () => {
    const fixture = setup()
    const reviewedAt = new Date('2026-09-13T03:00:00.000Z')
    const laterChangedAt = new Date('2026-09-14T03:00:00.000Z')
    const reviewedBy = { id: 'reviewer-id', displayName: '采购主管', avatarUrl: null }
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([
      orderRow({
        id: 'approved-order',
        statusHistory: [{ id: 'shipment', changedAt: laterChangedAt, reason: '货件已发出' }],
        _count: { parts: 0, payments: 0, statusHistory: 3, amountRevisions: 0 },
      }),
      orderRow({ id: 'pending-order', orderStatus: 'PENDING_REVIEW' }),
      orderRow({ id: 'legacy-order', orderStatus: 'CONFIRMED' }),
    ])
    fixture.prisma.purchaseOrderStatusHistory.findMany.mockResolvedValue([{
      purchaseOrderId: 'approved-order', changedAt: reviewedAt,
      changedBy: reviewedBy, reason: '价格和货件核对通过',
    }])

    const page = await fixture.service.list({ view: 'all' })

    expect(page.items[0]).toMatchObject({
      reviewSummary: { reviewedAt: reviewedAt.toISOString(), reviewedBy, reason: '价格和货件核对通过' },
      changeSummary: { latest: { kind: 'STATUS', changedAt: laterChangedAt.toISOString(), reason: '货件已发出' } },
    })
    expect(page.items[1]).toHaveProperty('reviewSummary', null)
    expect(page.items[2]).toHaveProperty('reviewSummary', null)
    expect(fixture.prisma.purchaseOrderStatusHistory.findMany).toHaveBeenCalledTimes(1)
    expect(fixture.prisma.purchaseOrderStatusHistory.findMany).toHaveBeenCalledWith({
      where: {
        purchaseOrderId: { in: ['approved-order', 'pending-order', 'legacy-order'] },
        dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED',
      },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      distinct: ['purchaseOrderId'],
      select: {
        purchaseOrderId: true, changedAt: true, reason: true,
        changedBy: { select: { id: true, displayName: true, profile: { select: { avatarUrl: true } } } },
      },
    })
    expect(fixture.prisma.purchaseOrder.findUnique).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
  })

  it('skips the review-history lookup for an empty page', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([])
    expect((await fixture.service.list({ view: 'all' })).items).toEqual([])
    expect(fixture.prisma.purchaseOrderStatusHistory.findMany).not.toHaveBeenCalled()
  })

  it('derives detail review facts only from the exact persisted approval transition', async () => {
    const fixture = setup()
    const reviewedAt = new Date('2026-09-13T03:00:00.000Z')
    const reviewedBy = { id: 'reviewer-id', displayName: '采购主管', avatarUrl: null }
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      statusHistory: [
        { id: 'cancel', dimension: 'ORDER', fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', changedAt: new Date('2026-09-14T03:00:00Z'), changedBy: reviewedBy, reason: '后续取消' },
        { id: 'wrong-dimension', dimension: 'FULFILLMENT', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', changedAt: reviewedAt, changedBy: reviewedBy, reason: '其他维度' },
        { id: 'wrong-from', dimension: 'ORDER', fromStatus: null, toStatus: 'CONFIRMED', changedAt: reviewedAt, changedBy: reviewedBy, reason: '历史初始化' },
        { id: 'approval', dimension: 'ORDER', fromStatus: 'PENDING_REVIEW', toStatus: 'CONFIRMED', changedAt: reviewedAt, changedBy: reviewedBy, reason: null },
      ],
    }))
    const detail = await fixture.service.getById('order-id')
    expect(detail).toHaveProperty('reviewSummary', { reviewedAt: reviewedAt.toISOString(), reviewedBy, reason: null })
    expect(fixture.prisma.purchaseOrderStatusHistory.findMany).not.toHaveBeenCalled()

    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({ orderStatus: 'CONFIRMED', updatedAt: reviewedAt }))
    expect(await fixture.service.getById('order-id')).toHaveProperty('reviewSummary', null)
  })

  it.each(['PKG/20260914-00001', null])('keeps pending shipment number %s independent from unissued marks', async shipmentNo => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      shippingMarkText: null, orderStatus: 'PENDING_REVIEW',
      parts: [{ id: 'part-1', shipmentNo, partNumber: 1, status: 'PENDING_REVIEW', shippingMarkText: null, items: [] }],
    }))
    const detail = await fixture.service.getById('order-id')
    expect(detail.shippingMarkText).toBeNull()
    expect(detail.shippingMarks).toEqual([])
    expect(detail.parts).toEqual([{ id: 'part-1', shipmentNo, partNumber: 1, status: 'PENDING_REVIEW', shippingMarkText: null, trackingNo: null, destinationWarehouseValue: null, shippedAt: null, shippedById: null, shippedBy: null, shipmentRecordedAt: null, shipmentRemark: null, warehouseReceivedAt: null, warehouseReceivedById: null, warehouseRecordedAt: null, warehouseRemark: null, warehouseReceivedBy: null, items: [] }])
  })

  it.each(['CN-A', null])('returns destination warehouse %s in order details', async destinationWarehouseValue => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      parts: [{ id: 'part-1', shipmentNo: 'PKG/01', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'MARK/01', destinationWarehouseValue, items: [] }],
    }))
    expect((await fixture.service.getById('order-id')).parts[0]).toHaveProperty('destinationWarehouseValue', destinationWarehouseValue)
    expect(fixture.prisma.purchaseOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ parts: expect.objectContaining({ select: expect.objectContaining({ destinationWarehouseValue: true }) as unknown }) as unknown }) as unknown,
    }))
  })

  it.each(['SF1234567890', null])('returns shipment tracking number %s in order details', async trackingNo => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      parts: [{ id: 'part-1', shipmentNo: 'PKG/01', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'MARK/01', trackingNo, items: [] }],
    }))
    expect((await fixture.service.getById('order-id')).parts[0]).toHaveProperty('trackingNo', trackingNo)
    expect(fixture.prisma.purchaseOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ parts: expect.objectContaining({ select: expect.objectContaining({ trackingNo: true }) as unknown }) as unknown }) as unknown,
    }))
  })
  it('returns empty record summaries without inventing records or latest changes', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      _count: { parts: 0, payments: 0, statusHistory: 0, amountRevisions: 0 },
    })])
    const page = await fixture.service.list({ view: 'all' })
    expect(page.items[0]).toMatchObject({
      paidAmount: '0.00',
      paymentRecordSummary: { totalCount: 0, count: 0, byType: [
        { paymentType: 'DEPOSIT', count: 0, amount: '0.00' },
        { paymentType: 'BALANCE', count: 0, amount: '0.00' },
        { paymentType: 'OTHER', count: 0, amount: '0.00' },
      ] },
      documentSummary: { count: 0, byType: [
        { documentType: 'ORDER_ISSUANCE_VOUCHER', count: 0 },
        { documentType: 'PAYMENT_VOUCHER', count: 0 },
        { documentType: 'DELIVERY_RECEIPT', count: 0 },
      ] },
      changeSummary: { statusCount: 0, amountCount: 0, latest: null },
    })
  })

  it('summarizes all active payment types exactly and merges the latest stored change', async () => {
    const fixture = setup()
    const changedAt = new Date('2026-09-06T03:00:00.000Z')
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      purchaseTotalAmount: { toFixed: () => '9007199254740993.99' },
      payments: [
        { paymentType: 'DEPOSIT', amount: { toFixed: () => '9007199254740993.01' }, voidedAt: null },
        { paymentType: 'BALANCE', amount: { toFixed: () => '0.02' }, voidedAt: null },
        { paymentType: 'OTHER', amount: { toFixed: () => '0.03' }, voidedAt: null },
        { paymentType: 'OTHER', amount: { toFixed: () => '0.04' }, voidedAt: null },
        { paymentType: 'DEPOSIT', amount: decimal('100'), voidedAt: changedAt },
      ],
      documents: [
        { documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null },
        { documentType: 'PAYMENT_VOUCHER', detachedAt: null },
        { documentType: 'DELIVERY_RECEIPT', detachedAt: null },
        { documentType: 'DELIVERY_RECEIPT', detachedAt: null },
        { documentType: 'PAYMENT_VOUCHER', detachedAt: changedAt },
      ],
      statusHistory: [{ id: 'status-1', changedAt: new Date('2026-09-05T03:00:00Z'), reason: null }],
      amountRevisions: [{ id: 'amount-1', changedAt, reason: '调整采购约定' }],
      _count: { parts: 0, payments: 5, statusHistory: 3, amountRevisions: 2 },
    })])
    const page = await fixture.service.list({ view: 'all', page: 2, pageSize: 5 })
    expect(page.items[0]).toMatchObject({
      paidAmount: '9007199254740993.10', outstandingAmount: '0.89',
      paymentRecordSummary: { totalCount: 5, count: 4, byType: [
        { paymentType: 'DEPOSIT', count: 1, amount: '9007199254740993.01' },
        { paymentType: 'BALANCE', count: 1, amount: '0.02' },
        { paymentType: 'OTHER', count: 2, amount: '0.07' },
      ] },
      documentSummary: { count: 4, byType: [
        { documentType: 'ORDER_ISSUANCE_VOUCHER', count: 1 },
        { documentType: 'PAYMENT_VOUCHER', count: 1 },
        { documentType: 'DELIVERY_RECEIPT', count: 2 },
      ] },
      changeSummary: { statusCount: 3, amountCount: 2, latest: {
        kind: 'AMOUNT', changedAt: changedAt.toISOString(), reason: '调整采购约定',
      } },
    })
    expect(fixture.prisma.purchaseOrder.findMany).toHaveBeenCalledTimes(1)
    expect(fixture.prisma.purchaseOrder.findUnique).not.toHaveBeenCalled()
    expect(fixture.prisma.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 5, take: 5,
      select: expect.objectContaining({
        payments: { where: { voidedAt: null }, select: { paymentType: true, amount: true, voidedAt: true } },
        documents: { where: { detachedAt: null }, select: { documentType: true, detachedAt: true } },
        statusHistory: expect.objectContaining({ take: 1, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }] }) as unknown,
        amountRevisions: expect.objectContaining({ take: 1, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }] }) as unknown,
        _count: { select: { payments: true, statusHistory: true, amountRevisions: true, parts: true } },
      }) as unknown,
    }))
    expect(fixture.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
  })

  it('uses a stable kind-qualified key for equal change times and preserves a missing historical reason', async () => {
    const fixture = setup()
    const changedAt = new Date('2026-09-06T03:00:00Z')
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      _count: { parts: 0, payments: 0, statusHistory: 1, amountRevisions: 1 },
      statusHistory: [{ id: 'same-id', changedAt, reason: null }],
      amountRevisions: [{ id: 'same-id', changedAt, reason: '金额调整' }],
    })])
    const page = await fixture.service.list({ view: 'all' })
    expect(page.items[0]).toMatchObject({ changeSummary: {
      statusCount: 1, amountCount: 1, latest: { kind: 'STATUS', changedAt: changedAt.toISOString(), reason: null },
    } })
  })

  it('counts voided-only payment history while keeping active totals zero', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      // 列表仍只加载有效付款；历史总数独立来自数据库关系计数。
      payments: [], _count: { parts: 0, payments: 2, statusHistory: 0, amountRevisions: 0 },
    })])
    const page = await fixture.service.list({ view: 'all' })
    expect(page.items[0]).toMatchObject({
      paidAmount: '0.00', outstandingAmount: '100.00',
      paymentRecordSummary: { totalCount: 2, count: 0 },
    })
  })

  it('returns exact amount snapshots and standalone documents without fabricating history', async () => {
    const fixture = setup()
    const changedAt = new Date('2026-09-06T03:00:00.000Z')
    const actor = { id: 'actor-id', displayName: '采购员' }
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      amountRevisions: [{
        id: 'revision-id', reason: '调整付款约定', changedAt, changedBy: actor,
        oldLineSubtotalAmount: decimal('100'), oldPurchaseTotalAmount: decimal('100'),
        oldDepositDueAmount: decimal('30'), oldBalanceDueAmount: decimal('70'),
        newLineSubtotalAmount: decimal('100'), newPurchaseTotalAmount: decimal('100'),
        newDepositDueAmount: decimal('20'), newBalanceDueAmount: decimal('80'),
      }],
      lines: [],
      documents: [{
        id: 'doc-id', mediaAssetId: 'asset-id', paymentId: null, documentType: 'DELIVERY_RECEIPT',
        title: '签收单', remark: null, createdAt: changedAt, detachedAt: null,
        createdBy: actor, detachedBy: null,
        mediaAsset: { originalFilename: 'receipt.png', mediaType: 'IMAGE', mimeType: 'image/png', sizeBytes: 100n },
      }],
    }))
    await expect(fixture.service.getById('order-id')).resolves.toMatchObject({
      statusHistory: [],
      documents: [expect.objectContaining({ paymentId: null, documentType: 'DELIVERY_RECEIPT' })],
      amountRevisions: [{
        id: 'revision-id', reason: '调整付款约定', changedAt: changedAt.toISOString(), changedBy: actor,
        oldLineSubtotalAmount: '100.0000', oldPurchaseTotalAmount: '100.0000',
        oldDepositDueAmount: '30.0000', oldBalanceDueAmount: '70.0000',
        newLineSubtotalAmount: '100.0000', newPurchaseTotalAmount: '100.0000',
        newDepositDueAmount: '20.0000', newBalanceDueAmount: '80.0000',
      }],
    })
  })
  it('preserves historical payment voucher titles and original filenames on read', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      documents: [{
        id: 'doc-id', mediaAssetId: 'asset-id', paymentId: 'payment-id',
        documentType: 'PAYMENT_VOUCHER', title: '付款凭证-DEPOSIT', remark: null,
        createdAt: new Date('2026-09-06T03:00:00.000Z'), detachedAt: null,
        createdBy: { id: 'actor-id', displayName: '采购员' }, detachedBy: null,
        mediaAsset: { originalFilename: 'original.png', mediaType: 'IMAGE', mimeType: 'image/png', sizeBytes: 100n },
      }],
    }))
    await expect(fixture.service.getById('order-id')).resolves.toMatchObject({
      documents: [{ title: '付款凭证-DEPOSIT', originalFilename: 'original.png' }],
    })
  })

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
      summariesByCurrency: [{
        balanceDueAmount: '70.00',
        currencyCode: 'CNY',
        depositDueAmount: '30.00',
        orderCount: 1,
        outstandingAmount: '70.00',
        paidAmount: '30.00',
        purchaseTotalAmount: '100.00',
        referenceSubtotalAmount: '40.0000',
      }],
      total: 1,
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'order-id',
      orderNo: 'PO-001',
      productMode: 'CATALOG',
      salesOrderNo: 'SO-001',
      customerName: '客户甲',
      shippingMarkText: 'MARK',
      supplier: {
        source: 'DICTIONARY',
        value: 'SUPPLIER_A',
        label: '供应商 A',
        known: true,
      },
      createdBy: { id: 'actor-id', displayName: '采购员' },
      purchaseTotalAmount: '100.00',
      paidAmount: '30.00',
      outstandingAmount: '70.00',
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
      AND: [{ OR: [
        { orderStatus: 'PENDING_REVIEW' },
        { orderStatus: 'CONFIRMED', OR: [
          { fulfillmentStatus: { not: 'SIGNED' } },
          { paymentStatus: { not: 'PAID' } },
        ] },
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
        { parts: { some: { shippingMarkText: { contains: 'PO', mode: 'insensitive' } } } },
        { customSupplierName: { contains: 'PO', mode: 'insensitive' } },
      ],
    })
    expect(where?.orderBy).toEqual([{ orderDate: 'desc' }, { id: 'desc' }])
    expect(where?.select).toMatchObject({
      createdBy: { select: { id: true, displayName: true } },
      shippingMarkText: true,
    })
    expect(fixture.prisma.purchaseOrderLine.findMany).toHaveBeenCalledWith({
      where: { purchaseOrder: { is: where?.where } },
      select: { quantity: true, referencePurchaseUnitPriceAmount: true },
    })
    expect(fixture.prisma.purchaseOrderPayment.aggregate).toHaveBeenCalledWith({
      where: { purchaseOrder: { is: where?.where }, voidedAt: null },
      _sum: { amount: true },
    })
  })

  it('returns an empty summary collection when the filtered result has no orders', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.count.mockResolvedValue(0)
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([])
    fixture.prisma.purchaseOrder.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: {
        balanceDueAmount: null,
        depositDueAmount: null,
        purchaseTotalAmount: null,
      },
    })
    fixture.prisma.purchaseOrderLine.findMany.mockResolvedValue([])
    fixture.prisma.purchaseOrderPayment.aggregate.mockResolvedValue({
      _sum: { amount: null },
    })

    await expect(fixture.service.list({ view: 'all' })).resolves.toMatchObject({
      items: [],
      summariesByCurrency: [],
      total: 0,
    })
  })

  it.each([
    ['AWAITING_REVIEW', { orderStatus: 'PENDING_REVIEW' }],
    ['AWAITING_SHIPMENT', { orderStatus: 'CONFIRMED', fulfillmentStatus: { in: ['ORDERED', 'PREPARING', 'PARTIALLY_SHIPPED'] } }],
    ['AWAITING_WAREHOUSE', { orderStatus: 'CONFIRMED', parts: { some: { status: 'ACTIVE', shippedAt: { not: null }, warehouseReceivedAt: null } } }],
    ['AWAITING_PAYMENT', { orderStatus: 'CONFIRMED', paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } }],
  ] as const)('builds the %s pending task predicate', async (pendingTask, taskClause) => {
    const fixture = setup()

    await fixture.service.list({ view: 'pending', pendingTask })

    const query = fixture.prisma.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where?: { orderStatus?: unknown, AND?: unknown[] }
    }
    expect(query.where).toMatchObject({
      AND: [taskClause],
    })
  })

  it('keeps an explicit status filter intersected with the review task', async () => {
    const fixture = setup()
    await fixture.service.list({
      view: 'pending', pendingTask: 'AWAITING_REVIEW', orderStatus: 'CANCELLED',
    })
    const query = fixture.prisma.purchaseOrder.count.mock.calls[0]?.[0] as { where: unknown }
    expect(query.where).toMatchObject({
      orderStatus: 'CANCELLED', AND: [{ orderStatus: 'PENDING_REVIEW' }],
    })
  })

  it.each([
    ['PENDING_REVIEW', { orderStatus: 'PENDING_REVIEW' }],
    ['APPROVED', { orderStatus: { in: ['CONFIRMED', 'COMPLETED'] } }],
    ['CANCELLED', { orderStatus: 'CANCELLED' }],
  ] as const)('paginates the %s review view with shared filters', async (reviewView, clause) => {
    const fixture = setup()
    await fixture.service.list({ view: 'all', reviewView, page: 2, pageSize: 10, supplierValue: 'SUPPLIER_A', orderStatus: 'CANCELLED' })
    const query = fixture.prisma.purchaseOrder.findMany.mock.calls[0]?.[0] as { where: unknown }
    expect(query).toMatchObject({ skip: 10, take: 10, where: {
      supplierValue: 'SUPPLIER_A', orderStatus: 'CANCELLED', AND: [clause],
    } })
    expect(fixture.prisma.purchaseOrder.count).toHaveBeenCalledWith({ where: query.where })
    expect(fixture.prisma.purchaseOrder.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: query.where }))
  })

  it('returns the part count independently of issued shipping marks', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      parts: [{ shippingMarkText: null }, { shippingMarkText: null }],
      _count: { parts: 2, payments: 0, statusHistory: 0, amountRevisions: 0 },
    })])
    const result = await fixture.service.list({ view: 'all' })
    expect(result.items[0]).toMatchObject({ partCount: 2, shippingMarks: [] })
  })

  it('counts warehouse receipt facts separately from shipping and excludes cancelled parts', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      parts: [
        { status: 'ACTIVE', shippedAt: new Date(), warehouseReceivedAt: new Date() },
        { status: 'ACTIVE', shippedAt: new Date(), warehouseReceivedAt: null },
        { status: 'ACTIVE', shippedAt: null, warehouseReceivedAt: null },
        { status: 'CANCELLED', shippedAt: new Date(), warehouseReceivedAt: new Date() },
      ], _count: { parts: 4, payments: 0, statusHistory: 0, amountRevisions: 0 },
    })])
    const result = await fixture.service.list({ view: 'all' })
    expect(result.items[0]).toMatchObject({ partCount: 4, pendingPartCount: 1, warehouseReceivedPartCount: 1, pendingWarehousePartCount: 1 })
  })

  it('returns receipt actor and both receipt timestamps in purchase order detail', async () => {
    const fixture = setup()
    const warehouseReceivedAt = new Date('2026-09-15T02:00:00.000Z')
    const warehouseRecordedAt = new Date('2026-09-15T03:00:00.000Z')
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      lines: [], payments: [], parts: [{
        id: 'part-received', partNumber: 1, shipmentNo: 'PKG/001', status: 'ACTIVE', shippingMarkText: 'MARK/1',
        shippedAt: new Date('2026-09-15T01:00:00.000Z'), warehouseReceivedAt, warehouseRecordedAt,
        warehouseReceivedById: 'receiver-1', warehouseReceivedBy: { id: 'receiver-1', displayName: '仓库确认人' },
        warehouseRemark: '包装完好', items: [],
      }], _count: { parts: 1, payments: 0, statusHistory: 0, amountRevisions: 0 },
    }))
    const result = await fixture.service.getById('order-id')
    expect(result).toMatchObject({ warehouseReceivedPartCount: 1, pendingWarehousePartCount: 0, parts: [{
      warehouseReceivedAt: warehouseReceivedAt.toISOString(), warehouseRecordedAt: warehouseRecordedAt.toISOString(),
      warehouseReceivedById: 'receiver-1', warehouseReceivedBy: { id: 'receiver-1', displayName: '仓库确认人' }, warehouseRemark: '包装完好',
    }] })
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
        lineSubtotalAmount: '100.00',
        purchaseTotalAmount: '100.00',
        paidAmount: '30.00',
        outstandingAmount: '70.00',
      },
      lines: [expect.objectContaining({
        referencePurchaseUnitPriceAmount: '12.3456',
        actualPurchaseUnitPriceAmount: '10.00',
      })],
      payments: [expect.objectContaining({ amount: '30.00' })],
      paymentRecordSummary: { count: 1, byType: [
        { paymentType: 'DEPOSIT', count: 1, amount: '30.00' },
        { paymentType: 'BALANCE', count: 0, amount: '0.00' },
        { paymentType: 'OTHER', count: 0, amount: '0.00' },
      ] },
    })
  })

  it('maps a custom-text supplier without asking the dictionary to resolve it', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([orderRow({
      productMode: 'CUSTOM',
      supplierValue: null,
      customSupplierName: '临时加工厂',
      lines: listLines.filter(line => line.lineType === 'CUSTOM'),
    })])
    fixture.dictionaryLookup.resolveStoredValues.mockResolvedValue([])

    const page = await fixture.service.list({ view: 'all', keyword: '加工厂' })

    expect(page.items[0]).toMatchObject({
      productMode: 'CUSTOM',
      supplier: {
        source: 'CUSTOM_TEXT',
        value: null,
        label: '临时加工厂',
        tone: null,
        known: null,
        effectiveEnabled: null,
      },
    })
    expect(fixture.dictionaryLookup.resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      values: [],
    })
    const query = fixture.prisma.purchaseOrder.findMany.mock.calls[0]?.[0] as {
      where?: { OR?: unknown[] }
      select?: Record<string, unknown>
    }
    expect(query.select).toMatchObject({
      productMode: true,
      supplierValue: true,
      customSupplierName: true,
    })
    expect(query.where?.OR).toContainEqual({
      customSupplierName: { contains: '加工厂', mode: 'insensitive' },
    })
  })

  it('keeps historical MIXED orders readable with their dictionary supplier', async () => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findUnique.mockResolvedValue(orderRow({
      productMode: 'MIXED',
      customSupplierName: null,
    }))

    await expect(fixture.service.getById('order-id')).resolves.toMatchObject({
      productMode: 'MIXED',
      supplier: {
        source: 'DICTIONARY',
        value: 'SUPPLIER_A',
        label: '供应商 A',
      },
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
      count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(3),
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
    } as unknown as DictionaryLookupService, { getForOrder: jest.fn().mockResolvedValue(null) } as unknown as PaymentRecipientService)
    return { purchaseOrder, service, transaction }
  }

  it('counts all order statuses under the shared base filters and fills missing groups with zero', async () => {
    const fixture = createStatusCountsFixture()
    fixture.purchaseOrder.groupBy.mockResolvedValueOnce([{
      orderStatus: 'PENDING_REVIEW',
      _count: { _all: 3 },
    }, {
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
        { value: 'ALL', count: 10 },
        { value: 'PENDING_REVIEW', count: 3 },
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
          { parts: { some: { shippingMarkText: { contains: '客户甲', mode: 'insensitive' } } } },
          { customSupplierName: { contains: '客户甲', mode: 'insensitive' } },
        ],
    })
    expect(query._count).toEqual({ _all: true })
  })

  it('counts overlapping pending categories in one repeatable-read snapshot', async () => {
    const fixture = createStatusCountsFixture()
    fixture.purchaseOrder.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    fixture.purchaseOrder.groupBy
      .mockResolvedValueOnce([
        { fulfillmentStatus: 'ORDERED', _count: { _all: 4 } },
        { fulfillmentStatus: 'PREPARING', _count: { _all: 3 } },
        { fulfillmentStatus: 'PARTIALLY_SHIPPED', _count: { _all: 2 } },
        { fulfillmentStatus: 'SHIPPED', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { paymentStatus: 'UNPAID', _count: { _all: 5 } },
        { paymentStatus: 'PARTIALLY_PAID', _count: { _all: 1 } },
      ])

    await expect(fixture.service.statusCounts({ view: 'pending' })).resolves.toEqual({
      view: 'pending',
      items: [
        { value: 'AWAITING_REVIEW', count: 3 },
        { value: 'AWAITING_SHIPMENT', count: 9 },
        { value: 'AWAITING_WAREHOUSE', count: 1 },
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
    expect(fixture.purchaseOrder.count).toHaveBeenCalledWith({
      where: {
        AND: [pendingBaseWhere.AND[0], { orderStatus: 'PENDING_REVIEW' }],
      },
    })
    expect(fixture.purchaseOrder.count).toHaveBeenCalledWith({
      where: { AND: [pendingBaseWhere.AND[0], { orderStatus: 'CONFIRMED', parts: { some: {
        status: 'ACTIVE', shippedAt: { not: null }, warehouseReceivedAt: null,
      } } }] },
    })
    expect(fixture.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' },
    )
  })

  it('returns 404 for a SELF-scoped purchase order outside the sales owner chain', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const service = new PurchaseOrderQueryService(
      { purchaseOrder: { findFirst } } as unknown as PrismaService,
      {} as DictionaryLookupService,
      { getForOrder: jest.fn() } as unknown as PaymentRecipientService,
      { resolve: jest.fn().mockResolvedValue('SELF') } as never,
    )

    await expect(service.getById('order-id', 'actor-id')).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_NOT_FOUND',
      status: 404,
    })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'order-id',
        salesOrder: { is: { issuerUserId: 'actor-id' } },
      },
    }))
  })
})
