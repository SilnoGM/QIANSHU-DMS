import { operationsOceanLineSelect, serializeOperationsOceanLine } from './operations-ocean-container.service'

describe('operations ocean shipment number', () => {
  it('reads the linked shipment number without deriving it from its mark', () => {
    expect(operationsOceanLineSelect.shipment.select).toHaveProperty('shipmentNo', true)
    const row = {
      shipment: { shipmentNo: 'PKG/20260917-00007', shippingMarkText: 'TEST/货件-01', purchaseOrder: { id: 'po', orderNo: 'PO/01', salesOrder: null } },
    } as unknown as Parameters<typeof serializeOperationsOceanLine>[0]
    expect(serializeOperationsOceanLine(row)).toMatchObject({ shipmentNo: 'PKG/20260917-00007', shippingMark: 'TEST/货件-01' })
  })

  it('returns null when no shipment is linked', () => {
    const row = { shipment: null } as unknown as Parameters<typeof serializeOperationsOceanLine>[0]
    expect(serializeOperationsOceanLine(row)).toHaveProperty('shipmentNo', null)
  })
})
