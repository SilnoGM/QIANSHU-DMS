import type { PackagingPaymentProfileService } from '../payment-recipients/packaging-payment-profile.service'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { Prisma } from '../../generated/prisma/client'
import { PackagingCostQueryService } from './packaging-cost-query.service'

const shipmentId = '00000000-0000-4000-8000-000000000001'
const shipment = {
  shipmentNo: 'PKG/1', shippingMarkText: 'MARK/1', status: 'ACTIVE', shippedAt: new Date(), warehouseReceivedAt: new Date(),
  purchaseOrder: { orderNo: 'PO/1', orderStatus: 'CONFIRMED', salesOrder: { orderNo: 'SO/1', issuer: { id: 'issuer', displayName: '销售出单人' } } },
}
const submittedAt = new Date('2026-09-18T04:00:00.000Z')
const history = {
  id: 'request-1', version: 1, packagingTypeName: '木箱', packagingVendor: 'CHENGXIN', amount: new Prisma.Decimal('280.5'),
  currencyCode: 'CNY', status: 'PENDING_PAYMENT', submittedBy: { id: 'submitter', displayName: '提报人' },
  submittedAt, paidBy: null, paidAt: null, remark: '请确认付款',
}
const summary = {
  ...history, amount: '280.50', submittedBy: { id: 'submitter', name: '提报人' }, submittedAt: submittedAt.toISOString(),
}
function setup(row: unknown, records: unknown[] = []) {
  const findMany = jest.fn().mockResolvedValue(records)
  const prisma = { purchaseOrderPart: { findUnique: jest.fn().mockResolvedValue(row) }, packagingCostRequest: { findMany } } as unknown as PrismaService
  ;(prisma as unknown as { purchaseOrderPart: Record<string, unknown> }).purchaseOrderPart.findFirst = (prisma as unknown as { purchaseOrderPart: { findUnique: jest.Mock } }).purchaseOrderPart.findUnique
  return { query: new PackagingCostQueryService(prisma, {} as PackagingPaymentProfileService), findMany }
}
describe('PackagingCostQueryService shipment context', () => {
  it('returns the minimal shipment identity, true sales issuer and an empty history for first submission', async () => {
    await expect(setup(shipment).query.shipmentContext(shipmentId)).resolves.toEqual({ shipmentId, shipmentNo: 'PKG/1', shippingMarkText: 'MARK/1', purchaseOrderNo: 'PO/1', salesOrderNo: 'SO/1', owner: { id: 'issuer', name: '销售出单人' }, eligible: true, unavailableReason: null, existingRequests: [] })
  })
  it('queries only exact shipment history with a stable newest-first order and a restricted projection', async () => {
    const { query, findMany } = setup(shipment, [history])
    await expect(query.shipmentContext(shipmentId)).resolves.toMatchObject({ existingRequests: [summary] })
    expect(findMany).toHaveBeenCalledWith({
      where: { shipmentId }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, version: true, packagingTypeName: true, packagingVendor: true, amount: true, currencyCode: true, status: true,
        submittedBy: { select: { id: true, displayName: true } }, submittedAt: true,
        paidBy: { select: { id: true, displayName: true } }, paidAt: true, remark: true },
    })
  })
  it('maps paid history without exposing receipt, voucher or source-order data', async () => {
    const row = { ...history, status: 'PAID', paidBy: { id: 'payer', displayName: '付款人' }, paidAt: submittedAt,
      recipientSnapshot: { recipientName: 'private' }, paymentVoucherId: 'private', shipmentId, purchaseOrderId: 'private' }
    const result = await setup(shipment, [row]).query.shipmentContext(shipmentId)
    expect(result).toHaveProperty('existingRequests', [{ ...summary, status: 'PAID', paidBy: { id: 'payer', name: '付款人' }, paidAt: submittedAt.toISOString() }])
  })
  it('preserves identity but makes no-source received shipments unavailable', async () => {
    await expect(setup({ ...shipment, purchaseOrder: { ...shipment.purchaseOrder, salesOrder: null } }, [history]).query.shipmentContext(shipmentId)).resolves.toMatchObject({ shipmentNo: 'PKG/1', owner: null, salesOrderNo: null, eligible: false, unavailableReason: 'noSalesSource', existingRequests: [summary] })
  })
  it.each([{ ...shipment, warehouseReceivedAt: null }, { ...shipment, status: 'CANCELLED' }])('preserves history while preventing ineligible shipment submission %j', async row => {
    await expect(setup(row, [history]).query.shipmentContext(shipmentId)).resolves.toMatchObject({ eligible: false, unavailableReason: 'invalidShipment', existingRequests: [summary] })
  })
  it('returns no history and does not query requests when the shipment is missing', async () => {
    const { query, findMany } = setup(null, [history])
    await expect(query.shipmentContext(shipmentId)).resolves.toMatchObject({ eligible: false, unavailableReason: 'invalidShipment', existingRequests: [] })
    expect(findMany).not.toHaveBeenCalled()
  })
  it('propagates a history lookup failure instead of treating it as no prior submission', async () => {
    const { query, findMany } = setup(shipment)
    findMany.mockRejectedValueOnce(new Error('lookup failed'))
    await expect(query.shipmentContext(shipmentId)).rejects.toThrow('lookup failed')
  })
})
