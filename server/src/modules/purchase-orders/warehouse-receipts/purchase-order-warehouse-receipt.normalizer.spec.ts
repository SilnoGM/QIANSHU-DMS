import { normalizeWarehouseReceiptRequest } from './purchase-order-warehouse-receipt.normalizer'

const partId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('warehouse receipt request normalization', () => {
  it('normalizes explicit instants and remarks while keeping default time distinct for request replay', () => {
    expect(normalizeWarehouseReceiptRequest({ expectedVersion: 3, partIds: [partId], receivedAt: '2026-09-15T10:00:00+08:00', remark: '  到仓  ' })).toEqual({ expectedVersion: 3, partIds: [partId], receivedAt: '2026-09-15T02:00:00.000Z', remark: '到仓' })
    expect(normalizeWarehouseReceiptRequest({ expectedVersion: 3, partIds: [partId] }).receivedAt).toBeNull()
  })

  it.each([
    { expectedVersion: 0 }, { partIds: [] }, { partIds: [partId, partId] }, { partIds: ['invalid'] },
    { receivedAt: '2026-02-30T00:00:00Z' }, { receivedAt: '2026-09-15' }, { receivedAt: '2026-09-15T00:00:00' },
    { receivedAt: null }, { remark: 'x'.repeat(501) }, { warehouseReceivedById: partId },
  ])('rejects malformed input before persistence: %j', override => {
    expect(() => normalizeWarehouseReceiptRequest({ expectedVersion: 3, partIds: [partId], ...override })).toThrow()
  })
})
