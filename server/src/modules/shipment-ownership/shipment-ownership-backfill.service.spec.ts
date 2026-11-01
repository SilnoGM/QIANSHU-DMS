import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ShipmentOwnershipBackfillService } from './shipment-ownership-backfill.service'

const ACTOR_ID = '00000000-0000-4000-8000-000000000302'
const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000303'

function part(id: string, status: string, purchaseType = 'SALES_LINKED', salesOrderId: string | null = SALES_ORDER_ID) {
  return {
    id,
    status,
    purchaseOrder: { purchaseType, salesOrderId, createdByUserId: ACTOR_ID },
  }
}

describe('ShipmentOwnershipBackfillService', () => {
  it('reports missing ownership without writing in dry-run mode', async () => {
    const prisma = {
      purchaseOrderPart: {
        count: jest.fn()
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(2),
        findMany: jest.fn().mockResolvedValue([
          part('00000000-0000-4000-8000-000000000304', 'ACTIVE'),
          part('00000000-0000-4000-8000-000000000305', 'CANCELLED'),
        ]),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService

    const result = await new ShipmentOwnershipBackfillService(prisma).run({ apply: false, limit: 100 })

    expect(result).toEqual({
      total: 10,
      missingCurrent: 2,
      repairedProjection: 0,
      created: 0,
      remaining: 2,
      sampleIds: [
        '00000000-0000-4000-8000-000000000304',
        '00000000-0000-4000-8000-000000000305',
      ],
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates the initial event with the purchase source and cancellation state', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'event' })
    const findFirst = jest.fn().mockResolvedValue(null)
    const transaction = {
      shipmentOwnershipEvent: { findFirst, create },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      purchaseOrderPart: {
        count: jest.fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
        findMany: jest.fn().mockResolvedValue([
          part('00000000-0000-4000-8000-000000000306', 'CANCELLED'),
        ]),
      },
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<void>) => callback(transaction)),
    } as unknown as PrismaService

    const result = await new ShipmentOwnershipBackfillService(prisma).run({ apply: true, limit: 100 })

    expect(result.created).toBe(1)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shipmentId: '00000000-0000-4000-8000-000000000306',
        sequence: 1,
        ownerType: 'SALES_ORDER',
        ownerSalesOrderId: SALES_ORDER_ID,
        state: 'VOIDED',
        reason: 'ORDER_CANCELLED',
        actorUserId: ACTOR_ID,
      }) as unknown,
    }))
  })

  it('rebuilds the projection when events already exist', async () => {
    const upsert = jest.fn().mockResolvedValue({})
    const transaction = {
      shipmentOwnershipEvent: {
        findFirst: jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000307' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ownerType: 'STORAGE_POOL',
          ownerSalesOrderId: null,
          state: 'ACTIVE',
          occurredAt: new Date('2026-10-01T00:00:00.000Z'),
        }),
        create: jest.fn(),
      },
      shipmentOwnershipCurrent: { upsert },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      purchaseOrderPart: {
        count: jest.fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0),
        findMany: jest.fn().mockResolvedValue([
          part('00000000-0000-4000-8000-000000000308', 'ACTIVE'),
        ]),
      },
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<void>) => callback(transaction)),
    } as unknown as PrismaService

    const result = await new ShipmentOwnershipBackfillService(prisma).run({ apply: true, limit: 100 })

    expect(result.repairedProjection).toBe(1)
    expect(transaction.shipmentOwnershipEvent.create).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { shipmentId: '00000000-0000-4000-8000-000000000308' },
      update: expect.objectContaining({ ownerType: 'STORAGE_POOL', ownerSalesOrderId: null }) as unknown,
    }))
  })
})
