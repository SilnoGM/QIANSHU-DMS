import {
  deriveProductEditFulfillmentStatus,
  productEditFulfillmentSteps,
  type ProductEditFulfillmentFacts,
} from './sales-order-product-edit-fulfillment'

function facts(
  overrides: Partial<ProductEditFulfillmentFacts> = {},
): ProductEditFulfillmentFacts {
  return {
    currentStatus: 'PENDING',
    remainingQuantity: 0,
    approvedPurchaseOrderCount: 1,
    activePurchaseOrderCount: 1,
    allPurchaseOrdersApproved: true,
    hasPendingReviewParts: false,
    activePartCount: 1,
    shippedPartCount: 1,
    receivedPartCount: 1,
    loadedPartCount: 1,
    hasShippedPurchaseOrder: true,
    ...overrides,
  }
}

describe('deriveProductEditFulfillmentStatus', () => {
  it('keeps PENDING or returns to PENDING while coverage is incomplete and nothing shipped', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'PENDING',
      remainingQuantity: 1,
      shippedPartCount: 0,
      receivedPartCount: 0,
      loadedPartCount: 0,
      hasShippedPurchaseOrder: false,
    }))).toBe('PENDING')
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'PREPARING',
      remainingQuantity: 1,
      shippedPartCount: 0,
      receivedPartCount: 0,
      loadedPartCount: 0,
      hasShippedPurchaseOrder: false,
    }))).toBe('PENDING')
  })

  it('never moves an order with physical progress back to PENDING', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'PREPARING',
      remainingQuantity: 1,
    }))).toBe('PREPARING')
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'LAND_TRANSIT',
      remainingQuantity: 1,
      shippedPartCount: 0,
      receivedPartCount: 0,
      loadedPartCount: 0,
      hasShippedPurchaseOrder: false,
    }))).toBe('LAND_TRANSIT')
  })

  it('keeps the current stage when no approved purchase exists', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'PENDING',
      approvedPurchaseOrderCount: 0,
      activePurchaseOrderCount: 0,
      activePartCount: 0,
      shippedPartCount: 0,
      receivedPartCount: 0,
      loadedPartCount: 0,
      hasShippedPurchaseOrder: false,
    }))).toBe('PENDING')
  })

  it('derives each forward stage from shipped, received and loaded parts', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      receivedPartCount: 0,
      loadedPartCount: 0,
    }))).toBe('LAND_TRANSIT')
    expect(deriveProductEditFulfillmentStatus(facts({
      loadedPartCount: 0,
    }))).toBe('WAREHOUSE_ARRIVED')
    expect(deriveProductEditFulfillmentStatus(facts())).toBe('SEA_TRANSIT')
  })

  it('does not advance past PREPARING while parts are pending review or purchases are unapproved', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      hasPendingReviewParts: true,
    }))).toBe('PREPARING')
    expect(deriveProductEditFulfillmentStatus(facts({
      allPurchaseOrdersApproved: false,
    }))).toBe('PREPARING')
  })

  it('keeps a later current stage when the derived stage would be behind it', () => {
    expect(deriveProductEditFulfillmentStatus(facts({
      currentStatus: 'WAREHOUSE_ARRIVED',
      loadedPartCount: 0,
    }))).toBe('WAREHOUSE_ARRIVED')
  })
})

describe('productEditFulfillmentSteps', () => {
  it('expands a multi-stage forward derivation into ordered edges', () => {
    expect(productEditFulfillmentSteps('PENDING', 'SEA_TRANSIT')).toEqual([
      { fromStatus: 'PENDING', toStatus: 'PREPARING' },
      { fromStatus: 'PREPARING', toStatus: 'LAND_TRANSIT' },
      { fromStatus: 'LAND_TRANSIT', toStatus: 'WAREHOUSE_ARRIVED' },
      { fromStatus: 'WAREHOUSE_ARRIVED', toStatus: 'SEA_TRANSIT' },
    ])
  })

  it('returns the single backward edge used before shipment', () => {
    expect(productEditFulfillmentSteps('PREPARING', 'PENDING')).toEqual([
      { fromStatus: 'PREPARING', toStatus: 'PENDING' },
    ])
    expect(productEditFulfillmentSteps('PREPARING', 'PREPARING')).toEqual([])
  })
})
