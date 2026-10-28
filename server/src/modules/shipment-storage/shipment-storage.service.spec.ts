import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import { ShipmentStorageService } from './shipment-storage.service'

const ACTOR_ID = '00000000-0000-4000-8000-000000000501'
const RECORD_ID = '00000000-0000-4000-8000-000000000502'
const REQUEST_KEY = '00000000-0000-4000-8000-000000000503'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000504'
const SALES_ORDER_ID = '00000000-0000-4000-8000-000000000505'
const SALES_LINE_ID = '00000000-0000-4000-8000-000000000506'
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

function claimFixture(options: {
  readonly claimedQuantity?: number
  readonly orderStatus?: 'CONFIRMED' | 'CANCELLED'
} = {}) {
  const claimedQuantity = options.claimedQuantity ?? 2
  let claimedWritten = false
  const transaction = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        fulfillmentStatus: 'PENDING',
        id: SALES_ORDER_ID,
        orderStatus: options.orderStatus ?? 'CONFIRMED',
      }]),
    purchaseOrderLine: { groupBy: jest.fn().mockResolvedValue([]) },
    purchaseOrderPartItem: { findMany: jest.fn().mockResolvedValue([]) },
    purchaseOrderPart: {
      findMany: jest.fn().mockResolvedValue([{
        id: SHIPMENT_ID,
        items: [],
        loadedAt: null,
        shippedAt: new Date('2026-10-20T00:00:00Z'),
        status: 'ACTIVE',
        warehouseReceivedAt: new Date('2026-10-21T00:00:00Z'),
      }]),
    },
    salesOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: SALES_ORDER_ID,
        orderNo: 'SO/20261028-00001',
        orderStatus: options.orderStatus ?? 'CONFIRMED',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue([{
        id: SALES_LINE_ID,
        lineNumber: 1,
        quantity: 2,
      }]),
    },
    salesOrderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    shipmentClaimLine: {
      // 认领写入前余量校验只能看到既有认领；写入后履约推进才应看到本次认领。
      createMany: jest.fn().mockImplementation(() => {
        claimedWritten = true
        return Promise.resolve({ count: 1 })
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(
        claimedWritten
          ? [{ salesOrderLineId: SALES_LINE_ID, quantity: claimedQuantity }]
          : [],
      )),
    },
    shipmentOwnershipCurrent: {
      findUnique: jest.fn().mockResolvedValue({ ownerType: 'STORAGE_POOL', state: 'ACTIVE' }),
    },
    shipmentStorageRecord: {
      findUnique: jest.fn().mockResolvedValue({
        claimedBy: null,
        claimedSalesOrderId: null,
        id: RECORD_ID,
        originAllocations: [{ quantity: 2 }],
        originSalesOrderId: '00000000-0000-4000-8000-000000000507',
        shipmentId: SHIPMENT_ID,
        status: 'IN_STORAGE',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
  }
  const audit = { record: jest.fn().mockResolvedValue({}) }
  const ownership = { recordMany: jest.fn().mockResolvedValue(undefined) }
  const instance = new ShipmentStorageService(
    prisma as never,
    audit,
    {} as DictionaryLookupService,
    ownership as unknown as ShipmentOwnershipService,
  )
  jest.spyOn(instance, 'getById').mockResolvedValue({} as never)
  return { audit, instance, ownership, transaction }
}

function service(prisma: unknown = {}) {
  return new ShipmentStorageService(
    prisma as never,
    {} as AuditService,
    {} as DictionaryLookupService,
    {} as ShipmentOwnershipService,
  )
}

describe('ShipmentStorageService', () => {
  it('requires an overseas warehouse when releasing to overseas storage', async () => {
    await expect(service().release(context, {
      shipmentIds: [SHIPMENT_ID],
      locationScope: 'OVERSEAS',
      reason: 'CUSTOMER_CANCEL',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects an overseas warehouse for mainland storage', async () => {
    await expect(service().release(context, {
      shipmentIds: [SHIPMENT_ID],
      locationScope: 'MAINLAND',
      overseasWarehouseValue: 'RF_TZ',
      reason: 'CUSTOMER_CANCEL',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects relocation after the record is claimed', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      shipmentStorageRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECORD_ID,
          status: 'CLAIMED',
          locationScope: 'OVERSEAS',
          warehouseValue: 'RF_TZ',
        }),
      },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
    }

    await expect(service(prisma).relocate(context, RECORD_ID, {
      warehouseValue: 'RF_LK',
      reason: '转运',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_STATE_CHANGED' })
  })

  it('rejects relocation from a mainland storage record', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      shipmentStorageRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECORD_ID,
          status: 'IN_STORAGE',
          locationScope: 'MAINLAND',
          warehouseValue: 'SLH.SZ.BA.SJJD.HSNP.B5',
        }),
      },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(transaction)),
    }

    await expect(service(prisma).relocate(context, RECORD_ID, {
      warehouseValue: 'RF_LK',
      reason: '转运',
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_LOCATION_INVALID' })
  })

  it('returns zero-filled status counts with an ALL total', async () => {
    const prisma = {
      shipmentStorageRecord: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'IN_STORAGE', _count: { _all: 2 } },
          { status: 'CLAIMED', _count: { _all: 1 } },
        ]),
      },
    }

    const result = await service(prisma).statusCounts({})

    expect(result.items).toEqual([
      { value: 'ALL', count: 3 },
      { value: 'IN_STORAGE', count: 2 },
      { value: 'CLAIMED', count: 1 },
      { value: 'VOIDED', count: 0 },
    ])
  })

  it('advances the claiming sales order to the stage implied by the claimed shipment', async () => {
    const fixture = claimFixture()

    await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })

    expect(fixture.transaction.salesOrder.update).toHaveBeenCalledWith({
      where: { id: SALES_ORDER_ID },
      data: { fulfillmentStatus: 'WAREHOUSE_ARRIVED', version: { increment: 1 } },
    })
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenCalledTimes(3)
    expect(fixture.transaction.salesOrderStatusHistory.create).toHaveBeenLastCalledWith({
      data: {
        salesOrderId: SALES_ORDER_ID,
        dimension: 'FULFILLMENT',
        fromStatus: 'LAND_TRANSIT',
        toStatus: 'WAREHOUSE_ARRIVED',
        reason: '认领寄仓货件后按货件事实推进',
        changedByUserId: ACTOR_ID,
      },
    })
    expect(fixture.audit.record).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        metadata: expect.objectContaining({
          storageRecordId: RECORD_ID,
          toStatus: 'WAREHOUSE_ARRIVED',
          trigger: 'SHIPMENT_CLAIM',
        }) as unknown,
      }),
    )
  })

  it('rejects a claim that would push the line beyond its remaining coverage', async () => {
    const fixture = claimFixture()
    const groupBy = fixture.transaction.purchaseOrderLine.groupBy as unknown as jest.Mock
    groupBy.mockResolvedValue([{
      _sum: { quantity: 2 },
      sourceSalesOrderLineId: SALES_LINE_ID,
    }])

    await expect(fixture.instance.claim(context, RECORD_ID, {
      lines: [{ quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })).rejects.toMatchObject({ code: 'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE' })

    expect(fixture.transaction.shipmentStorageRecord.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
  })

  it('keeps the claiming order pending when claims leave a line uncovered', async () => {
    const fixture = claimFixture({ claimedQuantity: 1 })

    await fixture.instance.claim(context, RECORD_ID, {
      lines: [{ quantity: 2, salesOrderLineId: SALES_LINE_ID }],
      requestKey: REQUEST_KEY,
      salesOrderId: SALES_ORDER_ID,
    })

    expect(fixture.transaction.salesOrder.update).not.toHaveBeenCalled()
    expect(fixture.transaction.salesOrderStatusHistory.create).not.toHaveBeenCalled()
  })

  it('scopes storageId to list and status counts', async () => {
    const groupBy = jest.fn().mockResolvedValue([])
    const prisma = {
      shipmentStorageRecord: { groupBy },
    }

    await service(prisma).statusCounts({ storageId: RECORD_ID })

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: RECORD_ID }) as unknown,
    }))
  })
})
