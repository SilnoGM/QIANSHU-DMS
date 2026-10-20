import { PrismaService } from '../../infrastructure/database/prisma.service'
import { SalesOrderPendingPurchaseQueryService } from './sales-order-pending-purchase-query.service'

function fixture(lines: object[] = []) {
  const findUnique = jest.fn().mockResolvedValue({ id: 'order', lines })
  const findMany = jest.fn().mockResolvedValue([])
  const service = new SalesOrderPendingPurchaseQueryService({
    salesOrder: { findUnique, findFirst: findUnique }, purchaseOrderLine: { findMany },
  } as unknown as PrismaService)
  return { service, findUnique, findMany }
}
function line(id: string, quantity: number, lineType = 'CATALOG') {
  return { id, quantity, lineType, productId: lineType === 'CUSTOM' ? null : 'product',
    productNameSnapshot: id, product: lineType === 'CUSTOM' ? null : { media: [{ id: 'image' }] } }
}

describe('SalesOrderPendingPurchaseQueryService', () => {
  it('retains unpurchased and partial lines independently, excluding complete and overpurchased lines', async () => {
    const f = fixture([line('new', 4), line('partial', 10), line('complete', 3), line('over', 2)])
    f.findMany.mockResolvedValue([
      { sourceSalesOrderLineId: 'partial', quantity: 2 },
      { sourceSalesOrderLineId: 'partial', quantity: 3 },
      { sourceSalesOrderLineId: 'complete', quantity: 3 },
      { sourceSalesOrderLineId: 'over', quantity: 4 },
    ])
    const result = await f.service.list('order')
    expect(result.items.map(item => [item.id, item.remainingQuantity])).toEqual([['new', 4], ['partial', 5]])
    expect(result.items[0]).toEqual({ id: 'new', productName: 'new', lineType: 'CATALOG', remainingQuantity: 4,
      mainImage: { id: 'image', contentUrl: '/api/sales-orders/order/lines/new/main-image/image/content' } })
    const orderQuery: unknown = (f.findUnique.mock.calls as unknown[][])[0]?.[0]
    expect(orderQuery).toMatchObject({ select: {
      lines: { where: { removedAt: null }, orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }] },
    } })
    const purchaseQuery: unknown = (f.findMany.mock.calls as unknown[][])[0]?.[0]
    expect(purchaseQuery).toMatchObject({ where: {
      purchaseOrder: { is: { purchaseType: 'SALES_LINKED', salesOrderId: 'order', orderStatus: { not: 'CANCELLED' } } },
    } })
  })

  it('retains custom and imageless catalog products with null previews', async () => {
    const f = fixture([line('custom', 2, 'CUSTOM'), { ...line('no-image', 1), product: { media: [] } }])
    const result = await f.service.list('order')
    expect(result.items.map(item => item.mainImage)).toEqual([null, null])
    expect(result.items[0]?.lineType).toBe('CUSTOM')
  })

  it('returns an empty list without querying purchases when no active lines exist', async () => {
    const f = fixture()
    await expect(f.service.list('order')).resolves.toEqual({ items: [] })
    expect(f.findMany).not.toHaveBeenCalled()
  })

  it('rejects an unknown order', async () => {
    const f = fixture()
    f.findUnique.mockResolvedValue(null)
    await expect(f.service.list('missing')).rejects.toMatchObject({ code: 'SALES_ORDER_NOT_FOUND', status: 404 })
  })
})
