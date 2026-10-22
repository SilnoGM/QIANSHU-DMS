import type { ImportShipment } from './container-import.shipments'
import { serializeImportCandidate, shipmentEligibility } from './container-import.shipments'

const batchId = '11111111-1111-4111-8111-111111111111'
const warehouseValue = 'WH-A'

function shipment(overrides: Partial<ImportShipment> = {}): ImportShipment {
  return {
    id: 'shipment-1',
    shipmentNo: 'PKG/20261022-00001',
    shippingMarkText: 'MARK/01',
    trackingNo: 'SF123',
    shippedAt: new Date('2026-10-01T00:00:00.000Z'),
    status: 'ACTIVE',
    deliveredAt: null,
    loadedAt: null,
    warehouseReceivedAt: new Date('2026-10-02T00:00:00.000Z'),
    destinationWarehouseValue: warehouseValue,
    purchaseOrder: {
      orderNo: 'PO/20261022-00001',
      purchaseType: 'SALES_LINKED',
      salesOrder: { orderNo: 'SO/20261022-00001', customerName: '王小明' },
    },
    items: [{ line: { productNameSnapshot: '微耕机' } }, { line: { productNameSnapshot: '微耕机' } }, { line: { productNameSnapshot: '回填轮' } }],
    containerLoadingItems: [],
    ...overrides,
  }
}

describe('serializeImportCandidate', () => {
  it('maps the matcher evidence, customer name and lifecycle facts without duplicating products', () => {
    const candidate = serializeImportCandidate(shipment(), batchId, warehouseValue, true, ['trackingNo', 'shippingMarkText', 'trackingNo'])
    expect(candidate).toMatchObject({
      id: 'shipment-1',
      goodsName: '微耕机 + 回填轮',
      salesOrderNo: 'SO/20261022-00001',
      customerName: '王小明',
      purchaseType: 'SALES_LINKED',
      viewStatus: 'WAREHOUSE_RECEIVED',
      warehouseReceivedAt: '2026-10-02T00:00:00.000Z',
      containerBatch: null,
      matchFields: ['trackingNo', 'shippingMarkText'],
      eligible: true,
      ineligibleReason: null,
    })
  })

  it('gates only the sales order number while keeping the customer name', () => {
    const candidate = serializeImportCandidate(shipment(), batchId, warehouseValue, false, [])
    expect(candidate).toMatchObject({ salesOrderNo: null, customerName: '王小明' })
  })

  it('reports a stock purchase without a customer name', () => {
    const candidate = serializeImportCandidate(shipment({ purchaseOrder: { orderNo: 'PO/1', purchaseType: 'STOCK', salesOrder: null } }), batchId, warehouseValue, true, [])
    expect(candidate).toMatchObject({ purchaseType: 'STOCK', customerName: null, salesOrderNo: null })
  })

  it('returns the current container batch and the delivered reason', () => {
    const containerBatch = { id: batchId, containerBatchNo: 'CTN/20261022-00001', containerBatchName: '1022柜' }
    const candidate = serializeImportCandidate(shipment({
      deliveredAt: new Date('2026-10-03T00:00:00.000Z'),
      loadedAt: new Date('2026-10-02T00:00:00.000Z'),
      containerLoadingItems: [{ containerBatchId: batchId, containerBatch }],
    }), batchId, warehouseValue, true, [])
    expect(candidate).toMatchObject({
      viewStatus: 'DELIVERED',
      containerBatch,
      eligible: false,
      ineligibleReason: '货件已签收，不能装柜',
    })
  })

  it('keeps the existing shipmentEligibility string API for preview and backfill', () => {
    expect(shipmentEligibility(shipment({ deliveredAt: new Date() }), batchId, warehouseValue)).toBe('货件已签收，不能装柜')
    expect(shipmentEligibility(shipment(), batchId, warehouseValue)).toBeNull()
  })
})
