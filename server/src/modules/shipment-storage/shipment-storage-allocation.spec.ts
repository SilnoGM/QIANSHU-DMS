import { readShipmentStorageAllocations } from './shipment-storage-allocation'

describe('readShipmentStorageAllocations', () => {
  it('keeps only entries that can locate a purchase line', () => {
    expect(readShipmentStorageAllocations([
      {
        purchaseOrderLineId: 'line-1',
        lineNumber: 2,
        productName: '产品甲',
        quantity: 3,
      },
      { lineNumber: 3, productName: '缺少行 ID', quantity: 1 },
      null,
      'invalid',
    ])).toEqual([{
      lineId: 'line-1',
      lineNumber: 2,
      productName: '产品甲',
      quantity: 3,
    }])
  })

  it('keeps optional snapshot fields empty without dropping a valid line id', () => {
    expect(readShipmentStorageAllocations([
      { purchaseOrderLineId: 'line-1', quantity: '2' },
    ])).toEqual([{
      lineId: 'line-1',
      lineNumber: null,
      productName: null,
      quantity: 0,
    }])
  })

  it('returns an empty array for a non-array snapshot', () => {
    expect(readShipmentStorageAllocations({ purchaseOrderLineId: 'line-1' })).toEqual([])
  })
})
