import { SalesOrderTerminationService } from './sales-order-termination.service'

const ORDER_ID = '00000000-0000-4000-8000-000000000701'
const SHIPMENT_ID = '00000000-0000-4000-8000-000000000702'
const LOADED_ID = '00000000-0000-4000-8000-000000000703'
const context = { actorUserId: '00000000-0000-4000-8000-000000000704', requestId: 'request-1' }

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    id: SHIPMENT_ID,
    shipmentNo: 'PKG/0001',
    partNumber: 1,
    shippingMarkText: null,
    status: 'ACTIVE',
    viewStatus: 'CONTAINER_LOADED',
    loaded: false,
    pending: true,
    releasable: true,
    blockedReason: null,
    storageStatus: null,
    ownerType: 'SALES_ORDER',
    deliveredAt: null,
    ...overrides,
  }
}

function terminationContext(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SEA_TRANSIT',
    pendingReceiptCount: 0,
    pendingShipmentCount: 1,
    processedShipmentCount: 0,
    allShipmentsProcessed: false,
    canTerminate: true,
    blockedReason: null,
    shipments: [shipment()],
    ...overrides,
  }
}

function service() {
  const storage = { release: jest.fn().mockResolvedValue([]) }
  const mutations = { updateOrderStatus: jest.fn().mockResolvedValue({ id: ORDER_ID }) }
  const instance = new SalesOrderTerminationService(
    {} as never,
    {} as never,
    storage as never,
    mutations as never,
  )
  return { instance, storage, mutations }
}

describe('SalesOrderTerminationService', () => {
  it('requires an overseas warehouse when releasing loaded shipments', async () => {
    const f = service()
    jest.spyOn(f.instance, 'getContext').mockResolvedValue(terminationContext({
      shipments: [shipment({ loaded: true })],
    }))

    await expect(f.instance.terminate(context, ORDER_ID, {
      reason: '客户取消',
      shipmentIds: [SHIPMENT_ID],
    })).rejects.toMatchObject({ code: 'SALES_ORDER_TERMINATION_WAREHOUSE_REQUIRED' })
    expect(f.storage.release).not.toHaveBeenCalled()
  })

  it('releases loaded and unloaded shipments then terminates the order', async () => {
    const f = service()
    jest.spyOn(f.instance, 'getContext').mockResolvedValue(terminationContext({
      pendingShipmentCount: 2,
      shipments: [
        shipment({ id: SHIPMENT_ID, loaded: false }),
        shipment({ id: LOADED_ID, loaded: true, partNumber: 2 }),
      ],
    }))

    await f.instance.terminate(context, ORDER_ID, {
      reason: '客户取消',
      shipmentIds: [SHIPMENT_ID, LOADED_ID],
      overseasWarehouseValue: 'RF_TZ',
    })

    expect(f.storage.release).toHaveBeenCalledTimes(2)
    expect(f.storage.release).toHaveBeenNthCalledWith(1, context, expect.objectContaining({
      shipmentIds: [SHIPMENT_ID],
      locationScope: 'MAINLAND',
    }))
    expect(f.storage.release).toHaveBeenNthCalledWith(2, context, expect.objectContaining({
      shipmentIds: [LOADED_ID],
      locationScope: 'OVERSEAS',
      overseasWarehouseValue: 'RF_TZ',
    }))
    expect(f.mutations.updateOrderStatus).toHaveBeenCalledWith(context, ORDER_ID, {
      toStatus: 'TERMINATED',
      reason: '客户取消',
    })
  })

  it('blocks termination when a pending shipment cannot be released', async () => {
    const f = service()
    jest.spyOn(f.instance, 'getContext').mockResolvedValue(terminationContext({
      canTerminate: false,
      blockedReason: '采购单未付清',
      shipments: [shipment({ releasable: false, blockedReason: '采购单未付清' })],
    }))

    await expect(f.instance.terminate(context, ORDER_ID, {
      reason: '客户取消',
      shipmentIds: [SHIPMENT_ID],
    })).rejects.toMatchObject({ code: 'SALES_ORDER_TERMINATION_SHIPMENT_NOT_RELEASABLE' })
    expect(f.mutations.updateOrderStatus).not.toHaveBeenCalled()
  })

  it('terminates directly when every shipment is already processed', async () => {
    const f = service()
    jest.spyOn(f.instance, 'getContext').mockResolvedValue(terminationContext({
      pendingShipmentCount: 0,
      processedShipmentCount: 1,
      allShipmentsProcessed: true,
      shipments: [shipment({ pending: false, storageStatus: 'IN_STORAGE' })],
    }))

    await f.instance.terminate(context, ORDER_ID, { reason: '客户取消' })

    expect(f.storage.release).not.toHaveBeenCalled()
    expect(f.mutations.updateOrderStatus).toHaveBeenCalledWith(context, ORDER_ID, {
      toStatus: 'TERMINATED',
      reason: '客户取消',
    })
  })
})
