import { normalizeLoadGroupMembership, shipmentLoadGroupPayloadHash, validateLoadGroupMembers, type ShipmentLoadGroupMemberFacts } from './shipment-load-group.logic'

function member(overrides: Partial<ShipmentLoadGroupMemberFacts> = {}): ShipmentLoadGroupMemberFacts {
  return {
    id: 'shipment-a',
    status: 'ACTIVE',
    purchaseOrderId: 'order-a',
    shippingMarkText: 'MARK/货件-01',
    destinationWarehouseValue: 'MAINLAND_WAREHOUSE',
    warehouseReceivedAt: new Date('2026-11-01T00:00:00Z'),
    loadedAt: null,
    deliveredAt: null,
    ownerType: 'SALES_ORDER',
    ownerSalesOrderId: 'sales-a',
    ownershipState: 'ACTIVE',
    activeStorageStatus: null,
    packagingStatus: null,
    activeLoadGroupId: null,
    activeSettlementId: null,
    ...overrides,
  }
}

describe('shipment load group logic', () => {
  it('normalizes unique members and keeps the primary shipment inside the group', () => {
    expect(normalizeLoadGroupMembership(['b', 'a'], 'a')).toEqual({ shipmentIds: ['a', 'b'], primaryShipmentId: 'a' })
    expect(normalizeLoadGroupMembership(['a', 'a'], 'a')).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(normalizeLoadGroupMembership(['a'], 'a')).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(normalizeLoadGroupMembership(['a', 'b'], 'c')).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('accepts eligible members that share order, sales order, warehouse and base mark', () => {
    expect(validateLoadGroupMembers([member(), member({ id: 'shipment-b' })])).toEqual({
      ok: true,
      ownerSalesOrderId: 'sales-a',
    })
    expect(validateLoadGroupMembers([
      member({ shippingMarkText: 'MARK/货件-01' }),
      member({ id: 'shipment-b', shippingMarkText: 'MARK/货件-02' }),
    ])).toEqual({ ok: true, ownerSalesOrderId: 'sales-a' })
  })

  it.each([
    ['not active', member({ status: 'CANCELLED' }), '只有有效货件可以合并装柜'],
    ['loaded', member({ loadedAt: new Date() }), '已装柜或已签收的货件不能合并装柜'],
    ['not received', member({ warehouseReceivedAt: null }), '货件尚未到仓，不能合并装柜'],
    ['no warehouse', member({ destinationWarehouseValue: null }), '货件缺少目的地仓库，不能合并装柜'],
    ['no mark', member({ shippingMarkText: null }), '货件缺少唛头，不能合并装柜'],
    ['no owner', member({ ownerSalesOrderId: null }), '货件没有当前销售归属，不能合并装柜'],
    ['in storage', member({ activeStorageStatus: 'IN_STORAGE' }), '寄仓中的货件不能合并装柜'],
    ['packaging', member({ packagingStatus: 'PENDING_PAYMENT' }), '货件仍有包装费记录，不能合并装柜'],
    ['already grouped', member({ activeLoadGroupId: 'group-a' }), '货件已属于另一个装柜合并组'],
    ['settled', member({ activeSettlementId: 'settlement-a' }), '货件已有对账结算记录，不能合并装柜'],
  ])('rejects %s members', (_label, first, message) => {
    expect(validateLoadGroupMembers([first, member({ id: 'shipment-b' })])).toMatchObject({ ok: false, message })
  })

  it('rejects members that do not share the same order facts', () => {
    expect(validateLoadGroupMembers([member(), member({ id: 'shipment-b', purchaseOrderId: 'order-b' })])).toMatchObject({ ok: false })
    expect(validateLoadGroupMembers([member(), member({ id: 'shipment-b', ownerSalesOrderId: 'sales-b' })])).toMatchObject({ ok: false })
    expect(validateLoadGroupMembers([member(), member({ id: 'shipment-b', destinationWarehouseValue: 'OTHER' })])).toMatchObject({ ok: false })
    expect(validateLoadGroupMembers([member(), member({ id: 'shipment-b', shippingMarkText: 'OTHER/货件-01' })])).toMatchObject({ ok: false })
  })

  it('hashes the same membership independent of input order', () => {
    const first = shipmentLoadGroupPayloadHash({ purchaseOrderId: 'order-a', ownerSalesOrderId: 'sales-a', primaryShipmentId: 'a', shipmentIds: ['b', 'a'] })
    const second = shipmentLoadGroupPayloadHash({ purchaseOrderId: 'order-a', ownerSalesOrderId: 'sales-a', primaryShipmentId: 'a', shipmentIds: ['a', 'b'] })
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/u)
  })
})
