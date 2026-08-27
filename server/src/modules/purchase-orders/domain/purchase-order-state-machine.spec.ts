import {
  assertPurchaseOrderFulfillmentTransition,
  assertPurchaseOrderStatusTransition,
  isPendingPurchaseOrder,
} from './purchase-order-state-machine'

describe('purchase order state machine', () => {
  it('allows CONFIRMED -> CANCELLED only without active payments', () => {
    expect(() => assertPurchaseOrderStatusTransition('CONFIRMED', 'CANCELLED', {
      activePaidAmount: '0',
    })).not.toThrow()
    expect(() => assertPurchaseOrderStatusTransition('CONFIRMED', 'CANCELLED', {
      activePaidAmount: '0.01',
    })).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_CANCEL_HAS_PAYMENTS' }))
  })

  it.each([
    ['CONFIRMED', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'CANCELLED'],
  ] as const)('blocks order transition %s -> %s', (from, to) => {
    expect(() => assertPurchaseOrderStatusTransition(from, to, {
      activePaidAmount: '0',
    })).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
    }))
  })

  it.each([
    ['PENDING_ORDER', 'ORDERED'],
    ['ORDERED', 'PREPARING'],
    ['PREPARING', 'SHIPPED'],
    ['SHIPPED', 'SIGNED'],
  ] as const)('allows fulfillment transition %s -> %s', (from, to) => {
    expect(() => assertPurchaseOrderFulfillmentTransition(from, to, {
      orderStatus: 'CONFIRMED',
    })).not.toThrow()
  })

  it('blocks skipped, backward, repeated, or cancelled fulfillment transitions', () => {
    for (const [from, to, orderStatus] of [
      ['PENDING_ORDER', 'PREPARING', 'CONFIRMED'],
      ['SHIPPED', 'PREPARING', 'CONFIRMED'],
      ['ORDERED', 'ORDERED', 'CONFIRMED'],
      ['SIGNED', 'SHIPPED', 'CONFIRMED'],
      ['PENDING_ORDER', 'ORDERED', 'CANCELLED'],
    ] as const) {
      expect(() => assertPurchaseOrderFulfillmentTransition(from, to, {
        orderStatus,
      })).toThrow(expect.objectContaining({
        code: orderStatus === 'CANCELLED'
          ? 'PURCHASE_ORDER_CANCELLED'
          : 'PURCHASE_ORDER_FULFILLMENT_TRANSITION_INVALID',
      }))
    }
  })

  it.each([
    ['CONFIRMED', 'PENDING_ORDER', 'UNPAID', true],
    ['CONFIRMED', 'SIGNED', 'UNPAID', true],
    ['CONFIRMED', 'PENDING_ORDER', 'PAID', true],
    ['CONFIRMED', 'SIGNED', 'PAID', false],
    ['CANCELLED', 'PENDING_ORDER', 'UNPAID', false],
  ] as const)(
    'derives pending for %s/%s/%s as %s',
    (orderStatus, fulfillmentStatus, paymentStatus, expected) => {
      expect(isPendingPurchaseOrder({
        orderStatus,
        fulfillmentStatus,
        paymentStatus,
      })).toBe(expected)
    },
  )
})
