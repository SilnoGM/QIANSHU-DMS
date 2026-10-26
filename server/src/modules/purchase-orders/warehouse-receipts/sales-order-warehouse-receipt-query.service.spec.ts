import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { DictionaryLookupService } from '../../dictionaries/dictionary-lookup.service'
import { SalesOrderWarehouseReceiptQueryService } from './sales-order-warehouse-receipt-query.service'

const SALES_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FIRST_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECOND_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const THIRD_ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const RECEIVED_PART_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const PENDING_PART_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_PENDING_PART_ID = '22222222-2222-4222-8222-222222222222'

function part(id: string, partNumber: number, warehouseReceivedAt: Date | null) {
  return {
    id,
    shipmentNo: `SHIP-${partNumber}`,
    partNumber,
    status: 'ACTIVE',
    shippingMarkText: `MARK-${partNumber}`,
    shippedAt: new Date('2026-09-10T02:00:00.000Z'),
    shippedById: null,
    shippedBy: null,
    shipmentRecordedAt: new Date('2026-09-10T02:00:01.000Z'),
    shipmentRemark: null,
    trackingNo: 'SF123',
    destinationWarehouseValue: 'MAINLAND.WAREHOUSE',
    warehouseReceivedAt,
    warehouseReceivedById: warehouseReceivedAt === null ? null : '33333333-3333-4333-8333-333333333333',
    warehouseRecordedAt: warehouseReceivedAt,
    warehouseRemark: null,
    warehouseReceivedBy: null,
    items: [{ purchaseOrderLineId: LINE_ID, quantity: 1, line: { lineNumber: 1 } }],
  }
}

function line() {
  return {
    id: LINE_ID,
    productId: '44444444-4444-4444-8444-444444444444',
    productNoSnapshot: 'P-001',
    productNameSnapshot: '产品甲',
    descriptionSnapshot: '备注甲',
    quantity: 2,
    product: { media: [{ id: '55555555-5555-4555-8555-555555555555' }] },
  }
}

function order(id: string, orderNo: string, orderDate: string, parts: unknown[], supplierValue: string | null = null, customSupplierName: string | null = null) {
  return {
    id,
    orderNo,
    orderDate: new Date(orderDate),
    productMode: 'CATALOG',
    supplierValue,
    customSupplierName,
    fulfillmentStatus: 'SHIPPED',
    version: 3,
    shippingMarkText: 'BASE-MARK',
    parts,
    lines: [line()],
  }
}

function setup() {
  const prisma = {
    salesOrder: {
      findFirst: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        customerName: '客户甲',
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'LAND_TRANSIT',
        version: 4,
      }),
    },
    purchaseOrder: {
      findMany: jest.fn<Promise<unknown[]>, [unknown]>().mockResolvedValue([
        order(FIRST_ORDER_ID, 'PO/20260910-00001', '2026-09-10T00:00:00.000Z', [
          part(RECEIVED_PART_ID, 1, new Date('2026-09-11T02:00:00.000Z')),
          part(PENDING_PART_ID, 2, null),
        ], 'SUPPLIER_A'),
        order(SECOND_ORDER_ID, 'PO/20260911-00002', '2026-09-11T00:00:00.000Z', [
          part(SECOND_PENDING_PART_ID, 1, new Date('2026-09-12T02:00:00.000Z')),
        ]),
        order(THIRD_ORDER_ID, 'PO/20260912-00003', '2026-09-12T00:00:00.000Z', [
          part('66666666-6666-4666-8666-666666666666', 1, null),
        ], null, '临时加工厂'),
      ]),
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
  const service = new SalesOrderWarehouseReceiptQueryService(
    prisma as unknown as PrismaService,
    dictionary as unknown as DictionaryLookupService,
  )
  return { dictionary, prisma, service }
}

describe('SalesOrderWarehouseReceiptQueryService', () => {
  it('returns only purchase orders with pending receipts and maps receipt-ready parts', async () => {
    const fixture = setup()
    const context = await fixture.service.getContext(SALES_ORDER_ID)
    expect(context).toMatchObject({
      salesOrder: {
        id: SALES_ORDER_ID,
        orderNo: 'SO/20260904-00001',
        customerName: '客户甲',
        fulfillmentStatus: 'LAND_TRANSIT',
      },
      pendingReceiptPartCount: 2,
      purchaseOrders: [{
        id: FIRST_ORDER_ID,
        orderNo: 'PO/20260910-00001',
        supplier: { source: 'DICTIONARY', value: 'SUPPLIER_A', label: '供应商 A' },
        version: 3,
        receivedPartCount: 1,
        parts: [{
          id: PENDING_PART_ID,
          partNumber: 2,
          shippedAt: '2026-09-10T02:00:00.000Z',
          warehouseReceivedAt: null,
        }],
        lineSummary: {
          lineCount: 1,
          totalQuantity: 2,
          previews: [{
            lineId: LINE_ID,
            productNo: 'P-001',
            productName: '产品甲',
            description: '备注甲',
            quantity: 2,
            mainImage: { id: '55555555-5555-4555-8555-555555555555' },
          }],
        },
      }, {
        id: THIRD_ORDER_ID,
        supplier: { source: 'CUSTOM_TEXT', value: null, label: '临时加工厂' },
        receivedPartCount: 0,
      }],
    })
    // 已全部入仓的采购单不进入待入仓上下文。
    expect(context.purchaseOrders.map(order => order.id)).toEqual([FIRST_ORDER_ID, THIRD_ORDER_ID])
    expect(fixture.dictionary.resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      values: ['SUPPLIER_A'],
    })
  })

  it('rejects an order that is not waiting for warehouse receipt', async () => {
    const fixture = setup()
    ;(fixture.prisma.salesOrder.findFirst as jest.Mock).mockResolvedValue({
      id: SALES_ORDER_ID,
      orderNo: 'SO/20260904-00001',
      customerName: '客户甲',
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'WAREHOUSE_ARRIVED',
      version: 5,
    })
    await expect(fixture.service.getContext(SALES_ORDER_ID)).rejects.toMatchObject({
      code: 'SALES_WAREHOUSE_RECEIPT_NOT_ALLOWED',
    })
  })

  it('returns not found for an invisible or missing sales order', async () => {
    const fixture = setup()
    ;(fixture.prisma.salesOrder.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(fixture.service.getContext(SALES_ORDER_ID)).rejects.toMatchObject({
      code: 'SALES_ORDER_NOT_FOUND',
    })
  })
})
