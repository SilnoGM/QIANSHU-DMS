import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'

function fixture() {
  const part = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) }
  const order = { findMany: jest.fn().mockResolvedValue([]) }
  const user = { findMany: jest.fn().mockResolvedValue([]) }
  const transaction = { purchaseOrderPart: part, purchaseOrder: order, user }
  const prisma = { ...transaction, $transaction: jest.fn(async (run: (tx: typeof transaction) => Promise<unknown>) => run(transaction)) }
  const lookup = { resolveStoredValues: jest.fn().mockResolvedValue([]) }
  return { part, order, user, prisma, lookup, service: new PurchaseShipmentQueryService(prisma as unknown as PrismaService, lookup as unknown as DictionaryLookupService) }
}

function row() {
  return {
    id: 'part-1', partNumber: 2, status: 'ACTIVE', shippingMarkText: 'MARK/02', createdAt: new Date('2026-09-14T00:00:00Z'),
    shippedAt: null, shippedBy: null, shipmentRecordedAt: null, shipmentRemark: null,
    purchaseOrder: {
      id: 'order-1', orderNo: 'PO/01', orderDate: new Date('2026-09-14'), purchaseType: 'STOCK', productMode: 'CUSTOM', orderStatus: 'CONFIRMED',
      shippingMarkText: 'MARK', supplierValue: null, customSupplierName: '临时工厂', createdBy: { id: 'buyer-1', displayName: '采购员' }, salesOrder: null,
    },
    items: [{ purchaseOrderLineId: 'line-1', quantity: 2, line: {
      lineNumber: 1, lineType: 'CUSTOM', productId: null, productNoSnapshot: null, productNameSnapshot: '无图产品', productAttributesSnapshot: [], descriptionSnapshot: '临时规格', product: null,
    } }],
  }
}

describe('PurchaseShipmentQueryService', () => {
  it('defaults to unshipped active parts and paginates parts, not their parent orders', async () => {
    const f = fixture()
    f.part.findMany.mockResolvedValue([row()]); f.part.count.mockResolvedValue(3)
    const page = await f.service.list({ page: 2, pageSize: 1 })
    expect(f.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.any(Object) as unknown, { status: 'ACTIVE', shippedAt: null }] }, skip: 1, take: 1 }))
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 3, items: [{ viewStatus: 'AWAITING_SHIPMENT', supplier: { source: 'CUSTOM_TEXT', label: '临时工厂' }, salesSource: null, lineSummary: { lineCount: 1, totalQuantity: 2, previews: [{ quantity: 2, mainImage: null }] } }] })
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
  })

  it('uses each shipment product quantity and authorized preview URL; resolves dictionary suppliers once', async () => {
    const f = fixture(), value = row()
    const catalog = { ...value, purchaseOrder: { ...value.purchaseOrder, supplierValue: 'OLD', customSupplierName: null }, items: [{ ...value.items[0], line: { ...value.items[0].line, lineType: 'CATALOG', productId: 'product-1', product: { media: [{ id: 'image-1' }] } } }] }
    f.part.findMany.mockResolvedValue([catalog, { ...catalog, id: 'part-2' }])
    f.lookup.resolveStoredValues.mockResolvedValue([{ known: true, label: '历史供应商', tone: 'BLUE', effectiveEnabled: false }])
    const page = await f.service.list({ view: 'ALL' })
    expect(f.lookup.resolveStoredValues).toHaveBeenCalledTimes(1)
    expect(f.lookup.resolveStoredValues).toHaveBeenCalledWith({ dictionaryCode: 'service_provider.supplier', values: ['OLD'] })
    expect(page.items[1].supplier).toMatchObject({ label: '历史供应商', effectiveEnabled: false })
    expect(page.items[0].lineSummary.previews[0]).toMatchObject({ quantity: 2, mainImage: { contentUrl: '/api/purchase-orders/order-1/lines/line-1/main-image/image-1/content' } })
  })

  it('derives exclusive status counts with cancellation taking precedence over shippedAt', async () => {
    const f = fixture()
    f.part.groupBy.mockResolvedValue([
      { status: 'PENDING_REVIEW', _count: { _all: 2, shippedAt: 0 } },
      { status: 'ACTIVE', _count: { _all: 5, shippedAt: 3 } },
      { status: 'CANCELLED', _count: { _all: 4, shippedAt: 2 } },
    ])
    f.user.findMany.mockResolvedValue([{ id: 'buyer-1', displayName: '采购员' }])
    const result = await f.service.statusCounts({ keyword: '厂', supplierSource: 'CUSTOM_TEXT' })
    expect(result).toEqual({ items: [{ value: 'ALL', count: 11 }, { value: 'PENDING_REVIEW', count: 2 }, { value: 'AWAITING_SHIPMENT', count: 2 }, { value: 'SHIPPED', count: 3 }, { value: 'CANCELLED', count: 4 }], buyerOptions: [{ id: 'buyer-1', displayName: '采购员' }] })
    expect(f.user.findMany).toHaveBeenCalledWith({ where: { purchaseOrdersCreated: { some: { parts: { some: {} } } } }, select: { id: true, displayName: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }] })
    expect(f.order.findMany).not.toHaveBeenCalled()
  })

  it('applies identical base filters to list/counts and matches only products in that shipment', async () => {
    const f = fixture()
    const filters = { keyword: '  配件  ', orderDateFrom: '2026-09-01', orderDateTo: '2026-09-14', purchaseType: 'STOCK' as const, createdByUserId: 'buyer-1', supplierValue: 'SUPPLIER_A', supplierSource: 'DICTIONARY' as const }
    await f.service.list({ ...filters, view: 'SHIPPED' }); await f.service.statusCounts(filters)
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: unknown[] } }]
    const countCall = f.part.groupBy.mock.calls[0] as [{ where: unknown }]
    const listWhere = listCall[0].where.AND[0]
    expect(countCall[0].where).toEqual(listWhere)
    expect(listWhere).toMatchObject({ purchaseOrder: { is: { purchaseType: 'STOCK', createdByUserId: 'buyer-1', supplierValue: 'SUPPLIER_A', orderDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-14') } } } })
    expect(listWhere).toMatchObject({ OR: expect.arrayContaining([{ items: { some: { line: { is: { productNameSnapshot: { contains: '配件', mode: 'insensitive' } } } } } }]) as unknown })
  })

  it('returns cancelled detail with historical shipment facts and all products intact', async () => {
    const f = fixture(), value = row()
    f.part.findUnique.mockResolvedValue({ ...value, status: 'CANCELLED', shippedAt: new Date('2026-09-13T01:00:00Z'), shipmentRemark: '原发货说明' })
    expect(await f.service.getById('part-1')).toMatchObject({ status: 'CANCELLED', viewStatus: 'CANCELLED', shippedAt: '2026-09-13T01:00:00.000Z', shipmentRemark: '原发货说明', items: [{ purchaseOrderLineId: 'line-1', quantity: 2, productAttributes: [], description: '临时规格' }] })
  })

  it('returns explicit 404 and validates impossible/reversed date ranges before querying', async () => {
    const f = fixture(); f.part.findUnique.mockResolvedValue(null)
    await expect(f.service.getById('missing')).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PART_NOT_FOUND' })
    await expect(f.service.list({ orderDateFrom: '2026-02-30' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(f.service.statusCounts({ orderDateFrom: '2026-09-14', orderDateTo: '2026-09-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(f.service.list({ supplierSource: 'CUSTOM_TEXT', supplierValue: 'SUPPLIER_A' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(f.part.findMany).not.toHaveBeenCalled()
  })
})
