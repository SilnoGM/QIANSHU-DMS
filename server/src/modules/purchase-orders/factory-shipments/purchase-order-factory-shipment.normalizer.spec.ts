import {
  normalizePurchaseOrderFactoryShipmentRequest,
  normalizeSalesOrderFactoryShipmentRequest,
} from './purchase-order-factory-shipment.normalizer'

const PURCHASE_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_PART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('purchase order factory shipment normalizer', () => {
  it('requires a destination warehouse for each selected shipment', () => {
    expect(() => normalizePurchaseOrderFactoryShipmentRequest({
      partIds: [PURCHASE_ORDER_ID], expectedVersion: 1,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], expectedVersion: 1 }],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it.each([
    undefined, null, [], {},
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: null }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: '' }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: '   ' }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'a'.repeat(65) }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: '仓库' }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN/A' }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A', extra: true }],
    [{ partId: SECOND_PART_ID, warehouseValue: 'CN-A' }],
    [{ partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A' }, { partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-B' }],
  ])('rejects missing, malformed or unmatched warehouse assignments %#', destinationWarehouses => {
    const input = { partIds: [PURCHASE_ORDER_ID], expectedVersion: 1, destinationWarehouses }
    expect(() => normalizePurchaseOrderFactoryShipmentRequest(input))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizeSalesOrderFactoryShipmentRequest({ mode: 'SELECTED', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, ...input }] }))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it('requires unique assignment identities and normalizes stable dictionary values', () => {
    const input = { partIds: [PURCHASE_ORDER_ID, SECOND_PART_ID], expectedVersion: 1, destinationWarehouses: [
      { partId: PURCHASE_ORDER_ID, warehouseValue: 'cn-a' }, { partId: PURCHASE_ORDER_ID, warehouseValue: 'cn-b' },
    ] }
    expect(() => normalizePurchaseOrderFactoryShipmentRequest(input))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    input.destinationWarehouses[1].partId = SECOND_PART_ID
    expect(normalizePurchaseOrderFactoryShipmentRequest(input)).toMatchObject({ destinationWarehouses: [
      { partId: PURCHASE_ORDER_ID, warehouseValue: 'CN-A' }, { partId: SECOND_PART_ID, warehouseValue: 'CN-B' },
    ] })
  })

  it('normalizes purchase shipment reason and version', () => {
    expect(normalizePurchaseOrderFactoryShipmentRequest({
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3,
      reason: '  Ａ区  ',
    })).toEqual({ partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 3, reason: 'A区' })
    expect(normalizePurchaseOrderFactoryShipmentRequest({
      partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1,
      reason: '   ',
    })).toEqual({ partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1, reason: null })
  })

  it('normalizes a stable selected sales shipment target set', () => {
    expect(normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED',
      targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 2 }],
      reason: null,
    })).toEqual({
      mode: 'SELECTED',
      targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 2 }],
      reason: null,
    })
  })

  it('trims optional tracking numbers without changing the carrier identifier', () => {
    const trackingNumbers = [
      { partId: PURCHASE_ORDER_ID, trackingNo: '  ＳＦ-123  ' },
      { partId: SECOND_PART_ID, trackingNo: '   ' },
    ]
    const expected = [
      { partId: PURCHASE_ORDER_ID, trackingNo: 'ＳＦ-123' },
      { partId: SECOND_PART_ID, trackingNo: null },
    ]
    const input = { partIds: [PURCHASE_ORDER_ID, SECOND_PART_ID], destinationWarehouses: [PURCHASE_ORDER_ID, SECOND_PART_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1, trackingNumbers }
    expect(normalizePurchaseOrderFactoryShipmentRequest(input)).toMatchObject({ trackingNumbers: expected })
    expect(normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, ...input }],
    })).toMatchObject({ targets: [{ trackingNumbers: expected }] })
    expect(normalizePurchaseOrderFactoryShipmentRequest({
      ...input, trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo: null }],
    })).toMatchObject({ trackingNumbers: [{ partId: PURCHASE_ORDER_ID, trackingNo: null }] })
  })

  it.each([
    null,
    {},
    [{ partId: SECOND_PART_ID, trackingNo: 'SF-123' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 'SF-123' }, { partId: PURCHASE_ORDER_ID, trackingNo: 'SF-456' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 'a'.repeat(101) }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 'SF\n123' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: '\tSF123' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 'SF\u0085123' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 123 }],
    [{ partId: PURCHASE_ORDER_ID }],
    [{ partId: 'invalid', trackingNo: 'SF123' }],
    [{ partId: PURCHASE_ORDER_ID, trackingNo: 'SF123', unknown: true }],
    Array(1001).fill({ partId: PURCHASE_ORDER_ID, trackingNo: null }),
  ])('rejects malformed, repeated or unselected tracking numbers %#', (trackingNumbers) => {
    const input = { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1, trackingNumbers }
    expect(() => normalizePurchaseOrderFactoryShipmentRequest(input))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED', targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, ...input }],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })

  it.each([
    {},
    { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 0 },
    { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1, unknown: true },
    { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1, reason: 'x'.repeat(501) },
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
        { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1 },
        { purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1 },
      ],
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))

    expect(() => normalizeSalesOrderFactoryShipmentRequest({
      mode: 'SELECTED',
      targets: Array.from({ length: 101 }, (_, index) => ({
        purchaseOrderId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 1,
      })),
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
