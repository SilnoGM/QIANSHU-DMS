import { randomUUID } from 'node:crypto'

import { normalizeSalesOrderWarehouseReceiptRequest } from './sales-order-warehouse-receipt.normalizer'

function target(partCount = 1) {
  return {
    purchaseOrderId: randomUUID(),
    expectedVersion: 3,
    partIds: Array.from({ length: partCount }, () => randomUUID()),
  }
}

describe('sales order warehouse receipt request normalization', () => {
  it('sorts part ids, normalizes explicit instants and remarks, and keeps omitted time distinct', () => {
    const first = randomUUID()
    const second = randomUUID()
    const purchaseOrderId = randomUUID()
    const normalized = normalizeSalesOrderWarehouseReceiptRequest({
      targets: [{ purchaseOrderId, expectedVersion: 3, partIds: [second, first] }],
      receivedAt: '2026-09-15T10:00:00+08:00',
      remark: '  到仓  ',
    })
    expect(normalized).toEqual({
      targets: [{ purchaseOrderId, expectedVersion: 3, partIds: [first, second].sort() }],
      receivedAt: '2026-09-15T02:00:00.000Z',
      remark: '到仓',
    })
    expect(normalizeSalesOrderWarehouseReceiptRequest({ targets: [target()] }).receivedAt).toBeNull()
  })

  it('accepts multiple purchase orders and preserves the sorted target input', () => {
    const normalized = normalizeSalesOrderWarehouseReceiptRequest({
      targets: [target(2), target(1)],
    })
    expect(normalized.targets).toHaveLength(2)
    expect(normalized.targets.every(item => item.partIds.length > 0)).toBe(true)
  })

  it.each([
    {},
    { targets: [] },
    { targets: Array.from({ length: 101 }, () => target()) },
    { targets: [{ purchaseOrderId: 'invalid', expectedVersion: 1, partIds: [randomUUID()] }] },
    { targets: [{ purchaseOrderId: randomUUID(), expectedVersion: 0, partIds: [randomUUID()] }] },
    { targets: [{ purchaseOrderId: randomUUID(), expectedVersion: 1, partIds: [] }] },
    { targets: [{ purchaseOrderId: randomUUID(), expectedVersion: 1, partIds: ['invalid'] }] },
    { targets: [{ purchaseOrderId: randomUUID(), expectedVersion: 1, partIds: [randomUUID()], extra: true }] },
    { targets: [target(), target()], actorUserId: randomUUID() },
    { targets: [target()], receivedAt: null },
    { targets: [target()], receivedAt: '2026-09-15' },
    { targets: [target()], receivedAt: '2026-09-15T00:00:00' },
    { targets: [target()], receivedAt: '2026-02-30T00:00:00Z' },
    { targets: [target()], remark: 'x'.repeat(501) },
  ])('rejects malformed input before persistence: %j', override => {
    expect(() => normalizeSalesOrderWarehouseReceiptRequest(override)).toThrow()
  })

  it('rejects a duplicated purchase order and the same part across purchase orders', () => {
    const duplicatedOrder = target()
    expect(() => normalizeSalesOrderWarehouseReceiptRequest({
      targets: [duplicatedOrder, duplicatedOrder],
    })).toThrow()
    const partId = randomUUID()
    expect(() => normalizeSalesOrderWarehouseReceiptRequest({
      targets: [
        { purchaseOrderId: randomUUID(), expectedVersion: 1, partIds: [partId] },
        { purchaseOrderId: randomUUID(), expectedVersion: 1, partIds: [partId] },
      ],
    })).toThrow()
  })

  it('caps the whole request at the single-transaction part budget', () => {
    expect(() => normalizeSalesOrderWarehouseReceiptRequest({
      targets: [target(600), target(401)],
    })).toThrow()
  })
})
