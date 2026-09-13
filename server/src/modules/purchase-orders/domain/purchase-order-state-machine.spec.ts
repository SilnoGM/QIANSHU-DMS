import {
  assertPurchaseOrderFulfillmentTransition,
  assertPurchaseOrderStatusTransition,
  derivePurchaseOrderStatus,
  isPendingPurchaseOrder,
} from './purchase-order-state-machine'

describe('purchase order state machine', () => {
  it('preserves pending review and reserves approval for the dedicated review operation', () => {
    expect(derivePurchaseOrderStatus({
      orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID',
    })).toBe('PENDING_REVIEW')
    expect(() => assertPurchaseOrderStatusTransition('PENDING_REVIEW', 'CANCELLED', {
      activePaidAmount: '0',
    })).not.toThrow()
    expect(() => assertPurchaseOrderStatusTransition('PENDING_REVIEW', 'CONFIRMED', {
      activePaidAmount: '0',
    })).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' }))
    expect(() => assertPurchaseOrderFulfillmentTransition('ORDERED', 'PREPARING', {
      orderStatus: 'PENDING_REVIEW',
    })).toThrow(expect.objectContaining({ code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID' }))
    expect(isPendingPurchaseOrder({
      orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED', paymentStatus: 'UNPAID',
    })).toBe(true)
  })
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
    ['COMPLETED', 'CONFIRMED'],
    ['COMPLETED', 'COMPLETED'],
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'COMPLETED'],
    ['CANCELLED', 'CANCELLED'],
  ] as const)('blocks order transition %s -> %s', (from, to) => {
    expect(() => assertPurchaseOrderStatusTransition(from, to, {
      activePaidAmount: '0',
    })).toThrow(expect.objectContaining({
      code: 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
    }))
  })

  it.each([
    ['ORDERED', 'PREPARING'],
    ['PREPARING', 'SHIPPED'],
    ['PREPARING', 'PARTIALLY_SHIPPED'],
    ['PARTIALLY_SHIPPED', 'SHIPPED'],
    ['SHIPPED', 'SIGNED'],
  ] as const)('allows fulfillment transition %s -> %s', (from, to) => {
    expect(() => assertPurchaseOrderFulfillmentTransition(from, to, {
      orderStatus: 'CONFIRMED',
    })).not.toThrow()
  })

  it('blocks skipped, backward, repeated, or cancelled fulfillment transitions', () => {
    for (const [from, to, orderStatus] of [
      ['ORDERED', 'SHIPPED', 'CONFIRMED'],
      ['SHIPPED', 'PREPARING', 'CONFIRMED'],
      ['ORDERED', 'ORDERED', 'CONFIRMED'],
      ['SIGNED', 'SHIPPED', 'CONFIRMED'],
      ['ORDERED', 'PREPARING', 'CANCELLED'],
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
    ['CONFIRMED', 'ORDERED', 'UNPAID', true],
    ['CONFIRMED', 'SIGNED', 'UNPAID', true],
    ['CONFIRMED', 'ORDERED', 'PAID', true],
    ['CONFIRMED', 'SIGNED', 'PAID', false],
    ['COMPLETED', 'SIGNED', 'PAID', false],
    ['CANCELLED', 'ORDERED', 'UNPAID', false],
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

  it.each([
    ['CONFIRMED', 'SIGNED', 'PAID', 'COMPLETED'],
    ['CONFIRMED', 'SIGNED', 'PARTIALLY_PAID', 'CONFIRMED'],
    ['CONFIRMED', 'SHIPPED', 'PAID', 'CONFIRMED'],
    ['COMPLETED', 'SIGNED', 'PARTIALLY_PAID', 'CONFIRMED'],
    ['COMPLETED', 'SIGNED', 'PAID', 'COMPLETED'],
    ['CANCELLED', 'SIGNED', 'PAID', 'CANCELLED'],
  ] as const)(
    'derives order status for %s/%s/%s as %s',
    (orderStatus, fulfillmentStatus, paymentStatus, expected) => {
      expect(derivePurchaseOrderStatus({
        orderStatus,
        fulfillmentStatus,
        paymentStatus,
      })).toBe(expected)
    },
  )
})
