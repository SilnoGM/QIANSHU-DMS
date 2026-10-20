import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { PurchaseOrderFactoryShipmentQueryService } from './purchase-order-factory-shipment-query.service'

const SALES_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function setup() {
  const prisma = {
    salesOrder: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        customerName: '客户甲',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        version: 4,
      }),
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        customerName: '客户甲',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'PREPARING',
        version: 4,
      }),
    },
    purchaseOrder: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orderNo: 'PO/20260904-00002',
        orderDate: new Date('2026-09-04T00:00:00.000Z'),
        productMode: 'CUSTOM',
        supplierValue: null,
        customSupplierName: '临时加工厂',
        fulfillmentStatus: 'SHIPPED',
        version: 3,
        shippingMarkText: 'MARK',
        parts: [],
        lines: [{
          id: 'line-b',
          productId: null,
          productNameSnapshot: '临时服务',
          quantity: 1,
          product: null,
        }],
      }, {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        orderNo: 'PO/20260903-00001',
        orderDate: new Date('2026-09-03T00:00:00.000Z'),
        productMode: 'MIXED',
        supplierValue: 'SUPPLIER_A',
        customSupplierName: null,
        fulfillmentStatus: 'PREPARING',
        version: 2,
        shippingMarkText: 'MARK',
        parts: [],
        lines: [{
          id: 'line-a',
          productId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          productNameSnapshot: '产品甲',
          quantity: 2,
          product: { media: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] },
        }],
      }]),
    },
  }
  const dictionary = {
    resolveStoredValues: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([{
      known: true,
      label: '供应商 A',
      tone: 'DEFAULT',
      effectiveEnabled: true,
    }]),
  }
  const service = new PurchaseOrderFactoryShipmentQueryService(
    prisma as unknown as PrismaService,
    dictionary as unknown as DictionaryLookupService,
  )
  ;(prisma.salesOrder as Record<string, unknown>).findFirst = prisma.salesOrder.findUnique
  return { dictionary, prisma, service }
}

describe('PurchaseOrderFactoryShipmentQueryService', () => {
  it('returns pending purchases first and keeps satisfied purchases read only', async () => {
    const fixture = setup()
    const context = await fixture.service.getSalesOrderContext(SALES_ORDER_ID)
    expect(context).toMatchObject({
        salesOrder: {
          id: SALES_ORDER_ID,
          fulfillmentStatus: 'PREPARING',
        },
        pendingShipmentCount: 1,
        shipmentSatisfiedCount: 1,
        purchaseOrders: [{
          orderNo: 'PO/20260903-00001',
          productMode: 'MIXED',
          supplier: {
            source: 'DICTIONARY',
            value: 'SUPPLIER_A',
            label: '供应商 A',
          },
          fulfillmentStatus: 'PREPARING',
          lineSummary: {
            lineCount: 1,
            totalQuantity: 2,
            previews: [{
              lineId: 'line-a',
              productName: '产品甲',
              quantity: 2,
              mainImage: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
            }],
          },
        }, {
          orderNo: 'PO/20260904-00002',
          productMode: 'CUSTOM',
          supplier: {
            source: 'CUSTOM_TEXT',
            value: null,
            label: '临时加工厂',
            tone: null,
            known: null,
            effectiveEnabled: null,
          },
          fulfillmentStatus: 'SHIPPED',
        }],
      })
    expect(fixture.dictionary.resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      values: ['SUPPLIER_A'],
    })
    expect(context.purchaseOrders[0]?.lineSummary.previews[0]?.mainImage?.contentUrl)
      .toContain('/lines/line-a/main-image/')
    expect(fixture.prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {
        salesOrderId: SALES_ORDER_ID,
        purchaseType: 'SALES_LINKED',
        orderStatus: { in: ['CONFIRMED', 'COMPLETED'] },
      } }),
    )
  })

  it.each(['CN-A', null])('returns partial orders with destination warehouse %s and product allocation', async destinationWarehouseValue => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([{
      id: SALES_ORDER_ID, orderNo: 'PO/1', orderDate: new Date(), productMode: 'CUSTOM',
      supplierValue: null, customSupplierName: '工厂', fulfillmentStatus: 'PARTIALLY_SHIPPED',
      version: 4, shippingMarkText: 'TEST/1', lines: [],
      parts: [{
        id: 'part-1', shipmentNo: 'PKG/20260914-00001', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'TEST/1/01', destinationWarehouseValue,
        shippedAt: new Date('2026-09-13T00:00:00Z'), shippedById: SALES_ORDER_ID,
        shippedBy: { id: SALES_ORDER_ID, displayName: '采购员' },
        shipmentRecordedAt: new Date('2026-09-13T00:00:00Z'), shipmentRemark: '已发货',
        items: [{ purchaseOrderLineId: 'line-1', quantity: 2, line: { lineNumber: 1 } }],
      }],
    }])
    const result = await fixture.service.getSalesOrderContext(SALES_ORDER_ID)
    expect(result.pendingShipmentCount).toBe(1)
    expect(result.purchaseOrders[0]).toMatchObject({
      shippingMarkText: 'TEST/1',
      parts: [{ shipmentNo: 'PKG/20260914-00001', partNumber: 1, destinationWarehouseValue, shippedAt: '2026-09-13T00:00:00.000Z',
        shippedBy: { displayName: '采购员' },
        items: [{ purchaseOrderLineId: 'line-1', lineNumber: 1, quantity: 2 }],
      }],
    })
    expect(fixture.prisma.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ parts: expect.objectContaining({ select: expect.objectContaining({ destinationWarehouseValue: true }) as unknown }) as unknown }) as unknown,
    }))
  })

  it.each(['SF1234567890', null])('returns partial orders with shipment tracking number %s and product allocation', async trackingNo => {
    const fixture = setup()
    fixture.prisma.purchaseOrder.findMany.mockResolvedValue([{
      id: SALES_ORDER_ID, orderNo: 'PO/1', orderDate: new Date(), productMode: 'CUSTOM',
      supplierValue: null, customSupplierName: '工厂', fulfillmentStatus: 'PARTIALLY_SHIPPED',
      version: 4, shippingMarkText: 'TEST/1', lines: [],
      parts: [{
        id: 'part-1', shipmentNo: 'PKG/20260914-00001', partNumber: 1, status: 'ACTIVE', shippingMarkText: 'TEST/1/01', trackingNo,
        shippedAt: new Date('2026-09-13T00:00:00Z'), shippedById: SALES_ORDER_ID,
        shippedBy: { id: SALES_ORDER_ID, displayName: '采购员' },
        shipmentRecordedAt: new Date('2026-09-13T00:00:00Z'), shipmentRemark: '已发货',
        items: [{ purchaseOrderLineId: 'line-1', quantity: 2, line: { lineNumber: 1 } }],
      }],
    }])
    const result = await fixture.service.getSalesOrderContext(SALES_ORDER_ID)
    expect(result.pendingShipmentCount).toBe(1)
    expect(result.purchaseOrders[0]).toMatchObject({
      shippingMarkText: 'TEST/1',
      parts: [{ shipmentNo: 'PKG/20260914-00001', partNumber: 1, trackingNo, shippedAt: '2026-09-13T00:00:00.000Z',
        shippedBy: { displayName: '采购员' },
        items: [{ purchaseOrderLineId: 'line-1', lineNumber: 1, quantity: 2 }],
      }],
    })
    expect(fixture.prisma.purchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ parts: expect.objectContaining({ select: expect.objectContaining({ trackingNo: true }) as unknown }) as unknown }) as unknown,
    }))
  })

  it('rejects a sales order outside CONFIRMED and PREPARING', async () => {
    const fixture = setup()
    fixture.prisma.salesOrder.findUnique.mockResolvedValue({
      id: SALES_ORDER_ID,
      orderNo: 'SO/20260904-00001',
      customerName: '客户甲',
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'PENDING',
      version: 4,
    })
    await expect(fixture.service.getSalesOrderContext(SALES_ORDER_ID))
      .rejects.toMatchObject({ code: 'FACTORY_SHIPMENT_NOT_ALLOWED' })
  })
})
