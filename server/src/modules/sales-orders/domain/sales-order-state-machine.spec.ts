import {
  assertSalesOrderFulfillmentTransition,
  assertSalesOrderStatusTransition,
} from './sales-order-state-machine'
import type {
  SalesOrderFulfillmentStatus,
  SalesOrderPaymentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'

function orderStatus(value: string): SalesOrderStatus {
  return value as SalesOrderStatus
}

function orderContext(overrides: {
  readonly activeReceivedAmount?: string
  readonly fulfillmentStatus?: SalesOrderFulfillmentStatus
  readonly paymentStatus?: SalesOrderPaymentStatus
} = {}) {
  return {
    activeReceivedAmount: overrides.activeReceivedAmount ?? '0',
    fulfillmentStatus: overrides.fulfillmentStatus ?? 'PENDING',
    paymentStatus: overrides.paymentStatus ?? 'UNPAID',
  }
}

describe('sales order state machine', () => {
  it.each([
    ['DRAFT', 'CONFIRMED'],
    ['DRAFT', 'CANCELLED'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('allows order transition %s -> %s', (from, to) => {
    expect(() => assertSalesOrderStatusTransition(
      orderStatus(from),
      orderStatus(to),
      orderContext(),
    )).not.toThrow()
  })

  it('allows confirmed orders to enter reconciliation only after signed and paid', () => {
    expect(() => assertSalesOrderStatusTransition(
      orderStatus('CONFIRMED'),
      orderStatus('PENDING_RECONCILIATION'),
      orderContext({ fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' }),
    )).not.toThrow()
  })

  it('allows only eligible reconciliation orders to complete', () => {
    expect(() => assertSalesOrderStatusTransition(
      orderStatus('PENDING_RECONCILIATION'),
      orderStatus('COMPLETED'),
      orderContext({ fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' }),
    )).not.toThrow()
  })

  it.each([
    ['PREPARING', 'PAID'],
    ['SIGNED', 'PARTIALLY_PAID'],
  ] as const)(
    'blocks reconciliation when fulfillment=%s and payment=%s',
    (fulfillmentStatus, paymentStatus) => {
      expect(() => assertSalesOrderStatusTransition(
        orderStatus('CONFIRMED'),
        orderStatus('PENDING_RECONCILIATION'),
        orderContext({ fulfillmentStatus, paymentStatus }),
      )).toThrow(expect.objectContaining({
        code: 'SALES_ORDER_RECONCILIATION_CONDITIONS_NOT_MET',
      }))
    },
  )

  it.each([
    ['SIGNED', 'UNPAID'],
    ['SEA_TRANSIT', 'PAID'],
  ] as const)(
    'rechecks completion when fulfillment=%s and payment=%s',
    (fulfillmentStatus, paymentStatus) => {
      expect(() => assertSalesOrderStatusTransition(
        orderStatus('PENDING_RECONCILIATION'),
        orderStatus('COMPLETED'),
        orderContext({ fulfillmentStatus, paymentStatus }),
      )).toThrow(expect.objectContaining({
        code: 'SALES_ORDER_COMPLETION_CONDITIONS_NOT_MET',
      }))
    },
  )

  it('blocks cancellation after any effective payment', () => {
    expect(() => assertSalesOrderStatusTransition(
      orderStatus('CONFIRMED'),
      orderStatus('CANCELLED'),
      orderContext({ activeReceivedAmount: '0.0001' }),
    )).toThrow(expect.objectContaining({
      code: 'SALES_ORDER_CANCEL_HAS_PAYMENTS',
    }))
  })

  it.each([
    ['CONFIRMED', 'DRAFT'],
    ['CONFIRMED', 'COMPLETED'],
    ['PENDING_RECONCILIATION', 'CANCELLED'],
    ['PENDING_RECONCILIATION', 'CONFIRMED'],
    ['COMPLETED', 'PENDING_RECONCILIATION'],
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'DRAFT'],
    ['DRAFT', 'DRAFT'],
  ] as const)('blocks order transition %s -> %s', (from, to) => {
    expect(() => assertSalesOrderStatusTransition(
      orderStatus(from),
      orderStatus(to),
      orderContext({ fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' }),
    )).toThrow(expect.objectContaining({
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
