import type { Prisma } from '../../generated/prisma/client'
import { ShipmentOwnershipService } from './shipment-ownership.service'

const SHIPMENT_ID = '00000000-0000-4000-8000-000000000201'
const ACTOR_ID = '00000000-0000-4000-8000-000000000202'
const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000203'

function transactionFixture(maxSequence: number | null) {
  const create = jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000204' })
  const aggregate = jest.fn().mockResolvedValue({ _max: { sequence: maxSequence } })
  const queryRaw = jest.fn().mockResolvedValue([{ id: SHIPMENT_ID }])
  const findUnique = jest.fn()
  const findMany = jest.fn()
  const transaction = {
    $queryRaw: queryRaw,
    shipmentOwnershipEvent: { aggregate, create },
    shipmentOwnershipCurrent: { findUnique, findMany },
  } as unknown as Prisma.TransactionClient
  return { transaction, create, aggregate, queryRaw, findUnique, findMany }
}

describe('ShipmentOwnershipService', () => {
  it('locks the shipment and appends the next sequence with a hashed payload', async () => {
    const fixture = transactionFixture(1)
    const service = new ShipmentOwnershipService()

    const result = await service.recordMany(fixture.transaction, [{
      shipmentId: SHIPMENT_ID,
      ownerType: 'SALES_ORDER',
      ownerSalesOrderId: SALES_ORDER_ID,
      reason: 'PURCHASE_CREATED',
      actorUserId: ACTOR_ID,
      payload: { format: 'test' },
    }])

    expect(fixture.queryRaw).toHaveBeenCalledTimes(1)
    expect(fixture.aggregate).toHaveBeenCalledWith({
      where: { shipmentId: SHIPMENT_ID },
      _max: { sequence: true },
    })
    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shipmentId: SHIPMENT_ID,
        sequence: 2,
        ownerType: 'SALES_ORDER',
        ownerSalesOrderId: SALES_ORDER_ID,
        state: 'ACTIVE',
        reason: 'PURCHASE_CREATED',
        actorUserId: ACTOR_ID,
        payloadHash: expect.any(Buffer) as unknown,
      }) as unknown,
    }))
    expect(result).toEqual([{ id: '00000000-0000-4000-8000-000000000204', shipmentId: SHIPMENT_ID, sequence: 2 }])
  })

  it('starts at sequence 1 and keeps an explicit request key', async () => {
    const fixture = transactionFixture(null)
    const service = new ShipmentOwnershipService()
    const requestKey = '00000000-0000-4000-8000-000000000205'

    await service.recordMany(fixture.transaction, [{
      shipmentId: SHIPMENT_ID,
      ownerType: 'COMPANY',
      ownerSalesOrderId: null,
      reason: 'ORDER_CANCELLED',
      state: 'VOIDED',
      actorUserId: ACTOR_ID,
      requestKey,
    }])

    expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sequence: 1,
        ownerType: 'COMPANY',
        ownerSalesOrderId: null,
        state: 'VOIDED',
        requestKey,
      }) as unknown,
    }))
  })

  it('reads current ownership through the projection table', async () => {
    const fixture = transactionFixture(null)
    const service = new ShipmentOwnershipService()

    await service.findCurrent(fixture.transaction, SHIPMENT_ID)

    expect(fixture.findUnique).toHaveBeenCalledWith({
      where: { shipmentId: SHIPMENT_ID },
      select: expect.objectContaining({ ownerType: true, ownerSalesOrderId: true }) as unknown,
    })
  })
})
