import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'
import type { PurchaseShipmentFilterDto, PurchaseShipmentListQueryDto } from './purchase-shipment.dto'

function fixture() {
  const part = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() }
  const order = { findMany: jest.fn().mockResolvedValue([]) }
  const user = { findMany: jest.fn().mockResolvedValue([]) }
  const transaction = { purchaseOrderPart: part, purchaseOrder: order, user }
  const prisma = { ...transaction, $transaction: jest.fn(async (run: (tx: typeof transaction) => Promise<unknown>) => run(transaction)) }
  const lookup = { resolveStoredValues: jest.fn().mockResolvedValue([]) }
  return { part, order, user, prisma, lookup, service: new PurchaseShipmentQueryService(prisma as unknown as PrismaService, lookup as unknown as DictionaryLookupService) }
}

function row() {
  return {
    id: 'part-1', shipmentNo: 'PKG/20260914-00001', partNumber: 2, status: 'ACTIVE', shippingMarkText: 'MARK/02', createdAt: new Date('2026-09-14T00:00:00Z'),
    shippedAt: null, shippedBy: null, shipmentRecordedAt: null, shipmentRemark: null, trackingNo: null,
    warehouseReceivedAt: null, warehouseReceivedById: null, warehouseRecordedAt: null, warehouseRemark: null, warehouseReceivedBy: null,
    loadedAt: null, loadedById: null, loadedRecordedAt: null, loadedBy: null,
    purchaseOrder: {
      id: 'order-1', version: 3, orderNo: 'PO/01', orderDate: new Date('2026-09-14'), purchaseType: 'STOCK', productMode: 'CUSTOM', orderStatus: 'CONFIRMED',
      shippingMarkText: 'MARK', supplierValue: null, customSupplierName: '临时工厂', createdBy: { id: 'buyer-1', displayName: '采购员' }, salesOrder: null,
    },
    items: [{ purchaseOrderLineId: 'line-1', quantity: 2, line: {
      lineNumber: 1, lineType: 'CUSTOM', productId: null, productNoSnapshot: null, productNameSnapshot: '无图产品', productAttributesSnapshot: [], descriptionSnapshot: '临时规格', product: null,
    } }],
  }
}

describe('PurchaseShipmentQueryService', () => {
  it('preserves full-width tracking identifiers while normalizing other keyword fields for both rows and counts', async () => {
    const f = fixture(), input = { keyword: '  ＳＦ-123  ' }
    await f.service.list(input)
    await f.service.statusCounts(input)
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: unknown[] } }]
    const countCall = f.part.count.mock.calls[1] as [{ where: { AND: unknown[] } }]
    expect(listCall[0].where.AND[0]).toEqual(countCall[0].where.AND[0])
    expect(countCall[0].where.AND[0]).toMatchObject({ OR: expect.arrayContaining([
      { trackingNo: { contains: 'ＳＦ-123', mode: 'insensitive' } },
      { shipmentNo: { contains: 'SF-123', mode: 'insensitive' } },
      { purchaseOrder: { is: { orderNo: { contains: 'SF-123', mode: 'insensitive' } } } },
    ]) as unknown })
  })

  it('shares warehouse and tracking filters between rows and status counts without validating historical availability', async () => {
    const f = fixture()
    const filters = { keyword: '  SF123  ', destinationWarehouseValue: ' retired-a ', destinationWarehouseMissing: false }
    const query = { ...filters, view: 'WAREHOUSE_RECEIVED' as const, sort: 'WAREHOUSE_RECEIVED_DESC' as const }
    await f.service.list(query)
    await f.service.statusCounts(filters)
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: unknown[] } }]
    const countCall = f.part.count.mock.calls[1] as [{ where: { AND: unknown[] } }]
    expect(listCall[0].where.AND[0]).toEqual(countCall[0].where.AND[0])
    expect(countCall[0].where.AND[0]).toMatchObject({ destinationWarehouseValue: 'RETIRED-A', OR: expect.arrayContaining([
      { trackingNo: { contains: 'SF123', mode: 'insensitive' } },
    ]) as unknown })
    expect(countCall[0].where.AND[0]).not.toHaveProperty('sort')
    expect(f.lookup.resolveStoredValues).not.toHaveBeenCalled()
  })

  it.each([true, false, undefined])('applies the missing warehouse filter only when explicitly true: %s', async destinationWarehouseMissing => {
    const f = fixture()
    const filters = { keyword: 'shipment', destinationWarehouseMissing }
    await f.service.list(filters)
    await f.service.statusCounts(filters)
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: [{ destinationWarehouseValue?: unknown }] } }]
    const countCall = f.part.count.mock.calls[1] as [{ where: { AND: [{ destinationWarehouseValue?: unknown }] } }]
    expect(listCall[0].where.AND[0]).toEqual(countCall[0].where.AND[0])
    expect(listCall[0].where.AND[0].destinationWarehouseValue).toBe(destinationWarehouseMissing === true ? null : undefined)
  })

  it.each([
    { destinationWarehouseMissing: true, destinationWarehouseValue: 'CN-A' },
    { destinationWarehouseValue: '' }, { destinationWarehouseValue: 'A'.repeat(65) },
    { destinationWarehouseValue: '仓库' }, { destinationWarehouseValue: null },
    { destinationWarehouseMissing: 'false' }, { destinationWarehouseMissing: null },
  ])('rejects conflicting or invalid direct query inputs before accessing data %#', async input => {
    const f = fixture(), query = input as unknown as PurchaseShipmentFilterDto
    await expect(f.service.list(query)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(f.service.statusCounts(query)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, []],
    ['CREATED_DESC', []],
    ['SHIPPED_DESC', [{ shippedAt: { sort: 'desc', nulls: 'last' } }]],
    ['WAREHOUSE_RECEIVED_DESC', [{ warehouseReceivedAt: { sort: 'desc', nulls: 'last' } }]],
  ])('uses stable shipment ordering for %s without changing count filters', async (sort, leadingOrder) => {
    const f = fixture()
    await f.service.list({ view: 'ALL', sort } as PurchaseShipmentListQueryDto)
    expect(f.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [
      ...leadingOrder as unknown[], { createdAt: 'desc' }, { purchaseOrderId: 'desc' }, { partNumber: 'asc' }, { id: 'asc' },
    ] }))
    const first = f.part.findMany.mock.calls[0] as [{ where: unknown }]
    expect(f.part.count).toHaveBeenCalledWith({ where: first[0].where })
  })

  it('rejects unsupported direct sort values before querying', async () => {
    const f = fixture()
    await expect(f.service.list({ sort: 'SHIPPED_ASC' } as unknown as PurchaseShipmentListQueryDto)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('resolves historical warehouses once per page and preserves unknown values and null history', async () => {
    const f = fixture()
    f.part.findMany.mockResolvedValue([
      { ...row(), destinationWarehouseValue: 'CN-A' },
      { ...row(), id: 'part-2', destinationWarehouseValue: 'OLD' },
      { ...row(), id: 'part-3', destinationWarehouseValue: 'CN-A' },
      { ...row(), id: 'part-4', destinationWarehouseValue: null },
    ])
    f.lookup.resolveStoredValues.mockResolvedValue([
      { known: true, value: 'CN-A', label: '广州仓', effectiveEnabled: false },
      { known: false, value: 'OLD' },
    ])
    const page = await f.service.list({ view: 'ALL' })
    expect(f.lookup.resolveStoredValues).toHaveBeenCalledTimes(1)
    expect(f.lookup.resolveStoredValues).toHaveBeenCalledWith({ dictionaryCode: 'mainland.warehouse', values: ['CN-A', 'OLD'] })
    expect(page.items[0]).toMatchObject({ destinationWarehouseValue: 'CN-A', destinationWarehouse: { value: 'CN-A', label: '广州仓', known: true, effectiveEnabled: false } })
    expect(page.items[1]).toMatchObject({ destinationWarehouseValue: 'OLD', destinationWarehouse: { value: 'OLD', label: null, known: false, effectiveEnabled: false } })
    expect(page.items[3]).toMatchObject({ destinationWarehouseValue: null, destinationWarehouse: null })
    f.part.findUnique.mockResolvedValue({ ...row(), destinationWarehouseValue: 'CN-A' })
    expect(await f.service.getById('part-1')).toMatchObject({ destinationWarehouseValue: 'CN-A', destinationWarehouse: { label: '广州仓' } })
  })

  it.each(['SF1234567890', null])('returns tracking number %s in shipment list and detail', async trackingNo => {
    const f = fixture()
    f.part.findMany.mockResolvedValue([{ ...row(), trackingNo }])
    expect((await f.service.list({ view: 'ALL' })).items[0]).toHaveProperty('trackingNo', trackingNo)
    f.part.findUnique.mockResolvedValue({ ...row(), trackingNo })
    expect(await f.service.getById('part-1')).toHaveProperty('trackingNo', trackingNo)
    for (const query of [f.part.findMany, f.part.findUnique]) {
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ trackingNo: true }) as unknown }))
    }
  })

  it('returns the stored shipment number in list and detail, preserving unnumbered historical rows', async () => {
    const f = fixture()
    f.part.findMany.mockResolvedValue([row(), { ...row(), id: 'legacy', shipmentNo: null }])
    const page = await f.service.list({ view: 'ALL' })
    expect(page.items[0]).toHaveProperty('shipmentNo', 'PKG/20260914-00001')
    expect(page.items[1]).toHaveProperty('shipmentNo', null)
    f.part.findUnique.mockResolvedValue(row())
    expect(await f.service.getById('part-1')).toHaveProperty('shipmentNo', 'PKG/20260914-00001')
    f.part.findUnique.mockResolvedValue({ ...row(), shipmentNo: null })
    expect(await f.service.getById('part-1')).toHaveProperty('shipmentNo', null)
  })

  it('searches shipment numbers using the same normalized filter for rows and status counts', async () => {
    const f = fixture()
    await f.service.list({ keyword: '  ＰＫＧ/20260914-00001  ', view: 'ALL' })
    await f.service.statusCounts({ keyword: '  ＰＫＧ/20260914-00001  ' })
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: unknown[] } }]
    const countCall = f.part.count.mock.calls[1] as [{ where: { AND: unknown[] } }]
    expect(countCall[0].where.AND[0]).toEqual(listCall[0].where.AND[0])
    expect(countCall[0].where.AND[0]).toMatchObject({ OR: expect.arrayContaining([
      { shipmentNo: { contains: 'PKG/20260914-00001', mode: 'insensitive' } },
    ]) as unknown })
  })

  it('defaults to unshipped active parts and paginates parts, not their parent orders', async () => {
    const f = fixture()
    f.part.findMany.mockResolvedValue([row()]); f.part.count.mockResolvedValue(3)
    const page = await f.service.list({ page: 2, pageSize: 1 })
    expect(f.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.any(Object) as unknown, { status: 'ACTIVE', loadedAt: null, shippedAt: null }] }, skip: 1, take: 1 }))
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

  it('counts every view with its own exclusive predicate, cancellation taking precedence over facts', async () => {
    const f = fixture()
    // 逐视图计数，合计等于全部货件；互斥语义由谓词本身保证。
    for (const total of [11, 2, 2, 1, 2, 1, 4]) f.part.count.mockResolvedValueOnce(total)
    f.user.findMany.mockResolvedValue([{ id: 'buyer-1', displayName: '采购员' }])
    const result = await f.service.statusCounts({ keyword: '厂', supplierSource: 'CUSTOM_TEXT' })
    expect(result).toEqual({ items: [{ value: 'ALL', count: 11 }, { value: 'PENDING_REVIEW', count: 2 }, { value: 'AWAITING_SHIPMENT', count: 2 }, { value: 'SHIPPED', count: 1 }, { value: 'WAREHOUSE_RECEIVED', count: 2 }, { value: 'CONTAINER_LOADED', count: 1 }, { value: 'CANCELLED', count: 4 }], buyerOptions: [{ id: 'buyer-1', displayName: '采购员' }] })
    expect(f.part.count.mock.calls.map(call => (call as [{ where: { AND: unknown[] } }])[0].where.AND[1])).toEqual([
      {}, { status: 'PENDING_REVIEW' },
      { status: 'ACTIVE', loadedAt: null, shippedAt: null },
      { status: 'ACTIVE', loadedAt: null, shippedAt: { not: null }, warehouseReceivedAt: null },
      { status: 'ACTIVE', loadedAt: null, warehouseReceivedAt: { not: null } },
      { status: 'ACTIVE', loadedAt: { not: null } },
      { status: 'CANCELLED' },
    ])
    expect(f.user.findMany).toHaveBeenCalledWith({ where: { purchaseOrdersCreated: { some: { parts: { some: {} } } } }, select: { id: true, displayName: true }, orderBy: [{ displayName: 'asc' }, { id: 'asc' }] })
    expect(f.order.findMany).not.toHaveBeenCalled()
  })

  it('applies identical base filters to list/counts and matches only products in that shipment', async () => {
    const f = fixture()
    const filters = { keyword: '  配件  ', orderDateFrom: '2026-09-01', orderDateTo: '2026-09-14', purchaseType: 'STOCK' as const, createdByUserId: 'buyer-1', supplierValue: 'SUPPLIER_A', supplierSource: 'DICTIONARY' as const }
    await f.service.list({ ...filters, view: 'SHIPPED' }); await f.service.statusCounts(filters)
    const listCall = f.part.findMany.mock.calls[0] as [{ where: { AND: unknown[] } }]
    const countCall = f.part.count.mock.calls[1] as [{ where: { AND: unknown[] } }]
    const listWhere = listCall[0].where.AND[0]
    expect(countCall[0].where.AND[0]).toEqual(listWhere)
    expect(listWhere).toMatchObject({ purchaseOrder: { is: { purchaseType: 'STOCK', createdByUserId: 'buyer-1', supplierValue: 'SUPPLIER_A', orderDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-14') } } } })
    expect(listWhere).toMatchObject({ OR: expect.arrayContaining([{ items: { some: { line: { is: { productNameSnapshot: { contains: '配件', mode: 'insensitive' } } } } } }]) as unknown })
  })

  it('returns cancelled detail with historical shipment facts and all products intact', async () => {
    const f = fixture(), value = row()
    f.part.findUnique.mockResolvedValue({ ...value, status: 'CANCELLED', shippedAt: new Date('2026-09-13T01:00:00Z'), shipmentRemark: '原发货说明' })
    expect(await f.service.getById('part-1')).toMatchObject({ status: 'CANCELLED', viewStatus: 'CANCELLED', shippedAt: '2026-09-13T01:00:00.000Z', shipmentRemark: '原发货说明', items: [{ purchaseOrderLineId: 'line-1', quantity: 2, productAttributes: [], description: '临时规格' }] })
  })

  it('excludes received shipments from shipped view and retains all receipt facts in detail', async () => {
    const f = fixture()
    await f.service.list({ view: 'SHIPPED' })
    expect(f.part.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.any(Object) as unknown, {
      status: 'ACTIVE', loadedAt: null, shippedAt: { not: null }, warehouseReceivedAt: null,
    }] } }))
    await f.service.list({ view: 'WAREHOUSE_RECEIVED' })
    expect(f.part.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [expect.any(Object) as unknown, {
      status: 'ACTIVE', loadedAt: null, warehouseReceivedAt: { not: null },
    }] } }))
    await f.service.list({ view: 'CONTAINER_LOADED' })
    expect(f.part.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [expect.any(Object) as unknown, {
      status: 'ACTIVE', loadedAt: { not: null },
    }] } }))
    f.part.findUnique.mockResolvedValue({ ...row(), shippedAt: new Date('2026-09-14T01:00:00Z'),
      warehouseReceivedAt: new Date('2026-09-14T02:00:00Z'), warehouseRecordedAt: new Date('2026-09-14T03:00:00Z'),
      warehouseReceivedById: 'receiver-1', warehouseReceivedBy: { id: 'receiver-1', displayName: '收货员' }, warehouseRemark: '外箱完好',
    })
    expect(await f.service.getById('part-1')).toMatchObject({
      viewStatus: 'WAREHOUSE_RECEIVED', warehouseReceivedAt: '2026-09-14T02:00:00.000Z',
      warehouseRecordedAt: '2026-09-14T03:00:00.000Z', warehouseReceivedById: 'receiver-1',
      warehouseReceivedBy: { id: 'receiver-1', displayName: '收货员' }, warehouseRemark: '外箱完好', purchaseOrder: { version: 3 },
    })
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
