import {
  assertSalesOrderFulfillmentTransition,
  assertSalesOrderStatusTransition,
} from './sales-order-state-machine'

describe('sales order state machine', () => {
  it.each([
    ['DRAFT', 'CONFIRMED'],
    ['DRAFT', 'CANCELLED'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('allows order transition %s -> %s', (from, to) => {
    expect(() => assertSalesOrderStatusTransition(from, to, {
      activeReceivedAmount: '0',
    })).not.toThrow()
  })

  it('blocks cancellation after any effective payment', () => {
    expect(() => assertSalesOrderStatusTransition('CONFIRMED', 'CANCELLED', {
      activeReceivedAmount: '0.0001',
    })).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_CANCEL_HAS_PAYMENTS',
    }))
  })

  it.each([
    ['CONFIRMED', 'DRAFT'],
    ['CANCELLED', 'DRAFT'],
    ['DRAFT', 'DRAFT'],
  ] as const)('blocks order transition %s -> %s', (from, to) => {
    expect(() => assertSalesOrderStatusTransition(from, to, {
      activeReceivedAmount: '0',
    })).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_STATUS_TRANSITION_INVALID',
    }))
  })

  it.each([
    ['PENDING', 'PREPARING'],
    ['PREPARING', 'LAND_TRANSIT'],
    ['LAND_TRANSIT', 'WAREHOUSE_ARRIVED'],
    ['WAREHOUSE_ARRIVED', 'SEA_TRANSIT'],
    ['SEA_TRANSIT', 'SIGNED'],
  ] as const)('allows fulfillment transition %s -> %s', (from, to) => {
    expect(() => assertSalesOrderFulfillmentTransition(from, to, {
      hasActiveDeliveryReceipt: to === 'SIGNED',
    })).not.toThrow()
  })

  it('requires a delivery receipt before SIGNED', () => {
    expect(() => assertSalesOrderFulfillmentTransition('SEA_TRANSIT', 'SIGNED', {
      hasActiveDeliveryReceipt: false,
    })).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
    }))
  })

  it('blocks skipped or backward fulfillment transitions', () => {
    for (const [from, to] of [
      ['PENDING', 'LAND_TRANSIT'],
      ['SEA_TRANSIT', 'WAREHOUSE_ARRIVED'],
      ['LAND_TRANSIT', 'LAND_TRANSIT'],
      ['SIGNED', 'SEA_TRANSIT'],
    ] as const) {
      expect(() => assertSalesOrderFulfillmentTransition(from, to, {
        hasActiveDeliveryReceipt: false,
      })).toThrow(expect.objectContaining({
        code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID',
      }))
    }
  })
})
