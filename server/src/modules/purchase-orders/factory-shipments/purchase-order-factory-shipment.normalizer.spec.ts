import {
  normalizePurchaseOrderFactoryShipmentRequest,
  normalizeSalesOrderFactoryShipmentRequest,
} from './purchase-order-factory-shipment.normalizer'

const PURCHASE_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('purchase order factory shipment normalizer', () => {
  it('normalizes purchase shipment reason and version', () => {
    expect(normalizePurchaseOrderFactoryShipmentRequest({
      partIds: [PURCHASE_ORDER_ID], expectedVersion: 3,
      reason: '  Ａ区  ',
    })).toEqual({ partIds: [PURCHASE_ORDER_ID], expectedVersion: 3, reason: 'A区' })
    expect(normalizePurchaseOrderFactoryShipmentRequest({
      partIds: [PURCHASE_ORDER_ID], expectedVersion: 1,
      reason: '   ',
    })).toEqual({ partIds: [PURCHASE_ORDER_ID], expectedVersion: 1, reason: null })
  })

  it('normalizes a stable selected sales shipment target set', () => {
    expect(normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED',
      targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], expectedVersion: 2 }],
      reason: null,
    })).toEqual({
      mode: 'SELECTED',
      targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], expectedVersion: 2 }],
      reason: null,
    })
  })

  it.each([
    {},
    { partIds: [PURCHASE_ORDER_ID], expectedVersion: 0 },
    { partIds: [PURCHASE_ORDER_ID], expectedVersion: 1, unknown: true },
    { partIds: [PURCHASE_ORDER_ID], expectedVersion: 1, reason: 'x'.repeat(501) },
  ])('rejects invalid purchase shipment input %#', (input) => {
    expect(() => normalizePurchaseOrderFactoryShipmentRequest(input))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it.each([undefined, [], [PURCHASE_ORDER_ID, PURCHASE_ORDER_ID], ['bad'], Array(1001).fill(PURCHASE_ORDER_ID)])('rejects invalid part selection %#', (partIds) => {
    expect(() => normalizePurchaseOrderFactoryShipmentRequest({ expectedVersion: 1, partIds }))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, expectedVersion: 1, partIds }],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('rejects empty, duplicate and oversized sales shipment targets', () => {
    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED', targets: [],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))

    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'ALL_PENDING',
      targets: [
        { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], expectedVersion: 1 },
        { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], expectedVersion: 1 },
      ],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))

    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED',
      targets: Array.from({ length: 101 }, (_, index) => ({
        purchaseOrderId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        partIds: [PURCHASE_ORDER_ID], expectedVersion: 1,
      })),
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
