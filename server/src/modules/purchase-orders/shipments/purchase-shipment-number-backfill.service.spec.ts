import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import type { PurchaseShipmentNumberingService } from './purchase-shipment-numbering.service'
import { PurchaseShipmentNumberBackfillService } from './purchase-shipment-number-backfill.service'

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const part = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', purchaseOrderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', shipmentNo: null, numberingIssuanceId: null }

function setup() {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }]), purchaseOrderPart: { update: jest.fn().mockResolvedValue({}) } }
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    numberingRule: { findUnique: jest.fn().mockResolvedValue({ purpose: 'BUSINESS', status: 'ENABLED', versions: [{ id: 'active-version' }] }) },
    purchaseOrderPart: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([{ id: part.id }]) },
    $queryRaw: jest.fn().mockResolvedValue([{ invalid: false }]),
    $transaction: jest.fn().mockImplementation((run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
  }
  const numbering = { issue: jest.fn().mockResolvedValue([{ shipmentNo: 'SHIP/0001', numberingIssuanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', issuedAt: '2026-09-14T00:00:00.000Z' }]) }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  return { tx, prisma, numbering, audit, service: new PurchaseShipmentNumberBackfillService(prisma as unknown as PrismaService, numbering as unknown as PurchaseShipmentNumberingService, audit) }
}

describe('PurchaseShipmentNumberBackfillService', () => {
  it('defaults to dry-run and never opens a write transaction or consumes numbers', async () => {
    const fixture = setup()
    expect(await fixture.service.run({ actorUserId: actor })).toMatchObject({ mode: 'DRY_RUN', selected: 1, assigned: 0, remaining: 1 })
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
    expect(fixture.numbering.issue).not.toHaveBeenCalled()
    expect(fixture.audit.record).not.toHaveBeenCalled()
  })

  it('fails closed for an inactive actor before inspecting or changing shipments', async () => {
    const fixture = setup()
    fixture.prisma.user.findUnique.mockResolvedValue({ status: 'DISABLED' })
    await expect(fixture.service.run({ actorUserId: actor, apply: true })).rejects.toMatchObject({ code: 'SHIPMENT_BACKFILL_ACTOR_UNAVAILABLE' })
    expect(fixture.prisma.purchaseOrderPart.findMany).not.toHaveBeenCalled()
    expect(fixture.numbering.issue).not.toHaveBeenCalled()
  })

  it('does not silently skip an existing pair with an invalid ledger binding', async () => {
    const fixture = setup()
    fixture.prisma.$queryRaw.mockResolvedValue([{ invalid: true }])
    await expect(fixture.service.run({ actorUserId: actor })).rejects.toMatchObject({ code: 'PURCHASE_SHIPMENT_NUMBER_CONFLICT' })
    expect(fixture.numbering.issue).not.toHaveBeenCalled()
  })

  it('updates only the number pair and atomically audits the real issuance time', async () => {
    const fixture = setup()
    fixture.tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'ACTIVE' }]).mockResolvedValueOnce([part])
    expect(await fixture.service.run({ actorUserId: actor, apply: true })).toMatchObject({ mode: 'APPLY', assigned: 1, failed: 0 })
    expect(fixture.tx.purchaseOrderPart.update).toHaveBeenCalledWith({ where: { id: part.id }, data: { shipmentNo: 'SHIP/0001', numberingIssuanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } })
    expect(fixture.audit.record).toHaveBeenCalledWith(fixture.tx, expect.objectContaining({ actorUserId: actor, targetId: part.id, reasonCode: 'BACKFILL', metadata: expect.objectContaining({ issuedAt: '2026-09-14T00:00:00.000Z' }) as unknown }))
  })
})
