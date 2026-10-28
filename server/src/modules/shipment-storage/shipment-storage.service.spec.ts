import type { Prisma } from '../../generated/prisma/client'
import type { AuditService } from '../audit/audit.service'
import type { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { ShipmentOwnershipService } from '../shipment-ownership/shipment-ownership.service'
import { ShipmentStorageService } from './shipment-storage.service'

const ACTOR_ID = '00000000-0000-4000-8000-000000000501'
const RECORD_ID = '00000000-0000-4000-8000-000000000502'
const REQUEST_KEY = '00000000-0000-4000-8000-000000000503'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000504'
const context = { actorUserId: ACTOR_ID, requestId: 'request-1' }

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
})
