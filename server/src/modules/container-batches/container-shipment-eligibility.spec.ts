import type { ContainerShipmentEligibilityRow } from './container-shipment-eligibility'
import { resolveContainerShipmentEligibility } from './container-shipment-eligibility'

const batchId = '11111111-1111-4111-8111-111111111111'
const otherBatchId = '22222222-2222-4222-8222-222222222222'
const warehouseValue = 'WH-A'

function shipment(overrides: Partial<ContainerShipmentEligibilityRow> = {}): ContainerShipmentEligibilityRow {
  return {
    status: 'ACTIVE',
    deliveredAt: null,
    loadedAt: null,
    warehouseReceivedAt: new Date('2026-10-01T00:00:00.000Z'),
    destinationWarehouseValue: warehouseValue,
    containerLoadingItems: [],
    ...overrides,
  }
}

function items(...batchIds: string[]) {
  return batchIds.map(containerBatchId => ({ containerBatchId }))
}

describe('resolveContainerShipmentEligibility', () => {
  it('allows an active, received shipment in the same warehouse before loading', () => {
    expect(resolveContainerShipmentEligibility(shipment(), batchId, warehouseValue)).toBeNull()
  })

  it('rejects a shipment that is not active before checking any other fact', () => {
    expect(resolveContainerShipmentEligibility(shipment({ status: 'PENDING_REVIEW', deliveredAt: new Date() }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_UNAVAILABLE', status: 422 })
    expect(resolveContainerShipmentEligibility(shipment({ status: 'CANCELLED' }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_UNAVAILABLE', status: 422 })
  })

  it('rejects a delivered shipment even when it already has rows in this batch', () => {
    expect(resolveContainerShipmentEligibility(shipment({ deliveredAt: new Date(), containerLoadingItems: items(batchId) }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_DELIVERED', status: 422 })
  })

  it('rejects a shipment loaded in another batch before reporting loaded history', () => {
    expect(resolveContainerShipmentEligibility(shipment({ loadedAt: new Date(), containerLoadingItems: items(otherBatchId) }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED', status: 409 })
    expect(resolveContainerShipmentEligibility(shipment({ loadedAt: new Date(), containerLoadingItems: items(batchId, otherBatchId) }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_ALREADY_ASSIGNED', status: 409 })
  })

  it('rejects a permanently loaded shipment whose loading rows were unlinked', () => {
    expect(resolveContainerShipmentEligibility(shipment({ loadedAt: new Date(), containerLoadingItems: [] }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_ALREADY_LOADED', status: 409 })
  })

  it('allows appending another row to the same batch for a loaded shipment', () => {
    expect(resolveContainerShipmentEligibility(shipment({ loadedAt: new Date(), containerLoadingItems: items(batchId) }), batchId, warehouseValue)).toBeNull()
  })

  it('treats a shipment row without a recorded loading fact as appendable in this batch', () => {
    expect(resolveContainerShipmentEligibility(shipment({ containerLoadingItems: items(batchId) }), batchId, warehouseValue)).toBeNull()
  })

  it('rejects a shipment that has not reached the warehouse', () => {
    expect(resolveContainerShipmentEligibility(shipment({ warehouseReceivedAt: null }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_NOT_RECEIVED', status: 422 })
    expect(resolveContainerShipmentEligibility(shipment({ warehouseReceivedAt: null, destinationWarehouseValue: 'WH-B' }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_NOT_RECEIVED', status: 422 })
  })

  it('rejects a shipment whose destination warehouse differs from the batch', () => {
    expect(resolveContainerShipmentEligibility(shipment({ destinationWarehouseValue: 'WH-B' }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH', status: 422 })
    expect(resolveContainerShipmentEligibility(shipment({ destinationWarehouseValue: null }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_WAREHOUSE_MISMATCH', status: 422 })
  })

  it('uses delivered before cross-batch state so the terminal reason is reported first', () => {
    expect(resolveContainerShipmentEligibility(shipment({ deliveredAt: new Date(), loadedAt: new Date(), containerLoadingItems: items(otherBatchId) }), batchId, warehouseValue)).toMatchObject({ code: 'CONTAINER_SHIPMENT_DELIVERED' })
  })
})
