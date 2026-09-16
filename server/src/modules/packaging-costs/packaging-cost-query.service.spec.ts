import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { PackagingCostQueryService } from './packaging-cost-query.service'

const shipmentId = '00000000-0000-4000-8000-000000000001'
const shipment = {
  shipmentNo: 'PKG/1', shippingMarkText: 'MARK/1', status: 'ACTIVE', shippedAt: new Date(), warehouseReceivedAt: new Date(),
  purchaseOrder: { orderNo: 'PO/1', orderStatus: 'CONFIRMED', salesOrder: { orderNo: 'SO/1', issuer: { id: 'issuer', displayName: '销售出单人' } } },
}
function query(row: unknown) {
  const prisma = { purchaseOrderPart: { findUnique: jest.fn().mockResolvedValue(row) } } as unknown as PrismaService
  return new PackagingCostQueryService(prisma)
}
describe('PackagingCostQueryService shipment context', () => {
  it('returns only the minimal shipment identity and true sales issuer', async () => {
    await expect(query(shipment).shipmentContext(shipmentId)).resolves.toEqual({ shipmentId, shipmentNo: 'PKG/1', shippingMarkText: 'MARK/1', purchaseOrderNo: 'PO/1', salesOrderNo: 'SO/1', owner: { id: 'issuer', name: '销售出单人' }, eligible: true, unavailableReason: null })
  })
  it('preserves identity but makes no-source received shipments unavailable', async () => {
    await expect(query({ ...shipment, purchaseOrder: { ...shipment.purchaseOrder, salesOrder: null } }).shipmentContext(shipmentId)).resolves.toMatchObject({ shipmentNo: 'PKG/1', owner: null, salesOrderNo: null, eligible: false, unavailableReason: 'noSalesSource' })
  })
  it.each([null, { ...shipment, warehouseReceivedAt: null }, { ...shipment, status: 'CANCELLED' }])('prevents missing, pending and cancelled shipment submission %j', async row => {
    await expect(query(row).shipmentContext(shipmentId)).resolves.toMatchObject({ eligible: false, unavailableReason: 'invalidShipment' })
  })
})
