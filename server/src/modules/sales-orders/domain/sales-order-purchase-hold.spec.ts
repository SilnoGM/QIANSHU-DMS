import { resolveSalesOrderPurchaseHold } from './sales-order-purchase-hold'

describe('resolveSalesOrderPurchaseHold', () => {
  const pendingOrder = {
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
  } as const

  it('reports the awaiting-review hold with the purchase order count', () => {
    expect(resolveSalesOrderPurchaseHold(pendingOrder, 2)).toEqual({
      reason: 'AWAITING_PURCHASE_REVIEW',
      pendingReviewOrderCount: 2,
    })
  })

  it('omits the hold when the order is no longer waiting for purchase', () => {
    expect(resolveSalesOrderPurchaseHold({
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'PREPARING',
    }, 2)).toBeNull()
    expect(resolveSalesOrderPurchaseHold({
      orderStatus: 'PENDING_RECONCILIATION',
      fulfillmentStatus: 'PENDING',
    }, 2)).toBeNull()
  })

  it('omits the hold without a positive pending review count', () => {
    expect(resolveSalesOrderPurchaseHold(pendingOrder, undefined)).toBeNull()
    expect(resolveSalesOrderPurchaseHold(pendingOrder, 0)).toBeNull()
  })
})
