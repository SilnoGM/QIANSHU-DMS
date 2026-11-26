import {
  autoReviewRetryDelayMs,
  classifyAutoReviewFailure,
  classifyAutoReviewOrder,
  type AutoReviewOrderState,
} from './purchase-auto-review.logic'

function order(overrides: Partial<AutoReviewOrderState> = {}): AutoReviewOrderState {
  return {
    orderStatus: 'PENDING_REVIEW',
    fulfillmentStatus: 'ORDERED',
    purchaseType: 'SALES_LINKED',
    productMode: 'CATALOG',
    shippingMarkText: null,
    shippingMarkIssuanceId: null,
    partCount: 1,
    salesOrderStatus: 'CONFIRMED',
    hasVoucher: false,
    ...overrides,
  }
}

describe('classifyAutoReviewFailure', () => {
  it.each([
    'PURCHASE_ORDER_NOT_FOUND',
    'PURCHASE_ORDER_IMAGE_TOO_LARGE',
    'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS',
    'PURCHASE_ORDER_IMAGE_MARKS_REQUIRED',
    'PURCHASE_ORDER_IMAGE_NOT_ALLOWED',
    'VALIDATION_FAILED',
    'FORBIDDEN',
  ])('treats %s as terminal', code => {
    expect(classifyAutoReviewFailure(code)).toBe('TERMINAL')
  })

  it.each([
    'PURCHASE_ORDER_STATE_CHANGED',
    'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE',
    'PURCHASE_ORDER_IMAGE_STALE',
    'PURCHASE_ORDER_IMAGE_UNAVAILABLE',
    'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE',
    'MEDIA_STORAGE_UNAVAILABLE',
    'SOMETHING_NEW',
    null,
    undefined,
  ])('treats %s as retryable', code => {
    expect(classifyAutoReviewFailure(code)).toBe('RETRYABLE')
  })
})

describe('autoReviewRetryDelayMs', () => {
  it('returns the configured delays and stops after the last attempt', () => {
    expect(autoReviewRetryDelayMs(1)).toBe(60_000)
    expect(autoReviewRetryDelayMs(2)).toBe(300_000)
    expect(autoReviewRetryDelayMs(3)).toBe(900_000)
    expect(autoReviewRetryDelayMs(4)).toBeNull()
  })

  it('returns null for invalid attempt counts', () => {
    expect(autoReviewRetryDelayMs(0)).toBeNull()
    expect(autoReviewRetryDelayMs(-1)).toBeNull()
    expect(autoReviewRetryDelayMs(1.5)).toBeNull()
  })
})

describe('classifyAutoReviewOrder', () => {
  it('proceeds for a normal pending order', () => {
    expect(classifyAutoReviewOrder(order())).toEqual({ action: 'PROCEED' })
  })

  it('skips STOCK orders without a sales source check', () => {
    expect(classifyAutoReviewOrder(order({
      purchaseType: 'STOCK',
      salesOrderStatus: null,
    }))).toEqual({ action: 'PROCEED' })
  })

  it('treats an already reviewed order as done', () => {
    expect(classifyAutoReviewOrder(order({ orderStatus: 'CONFIRMED' }))).toEqual({ action: 'DONE' })
    expect(classifyAutoReviewOrder(order({ orderStatus: 'COMPLETED' }))).toEqual({ action: 'DONE' })
  })

  it('treats a cancelled order as cancelled', () => {
    expect(classifyAutoReviewOrder(order({ orderStatus: 'CANCELLED' }))).toEqual({ action: 'CANCELLED' })
  })

  it('blocks a cancelled or terminated sales source permanently', () => {
    for (const status of ['CANCELLED', 'TERMINATED', 'COMPLETED', 'PENDING_RECONCILIATION']) {
      expect(classifyAutoReviewOrder(order({ salesOrderStatus: status }))).toMatchObject({
        action: 'BLOCKED',
        retryable: false,
        code: 'PURCHASE_ORDER_SOURCE_ORDER_INVALID',
      })
    }
  })

  it('waits for a draft sales source', () => {
    expect(classifyAutoReviewOrder(order({ salesOrderStatus: 'DRAFT' }))).toMatchObject({
      action: 'BLOCKED',
      retryable: true,
    })
  })

  it('blocks orders that can never be reviewed automatically', () => {
    expect(classifyAutoReviewOrder(order({ productMode: 'MIXED' }))).toMatchObject({
      action: 'BLOCKED',
      retryable: false,
    })
    expect(classifyAutoReviewOrder(order({ partCount: 0 }))).toMatchObject({
      action: 'BLOCKED',
      retryable: false,
    })
    expect(classifyAutoReviewOrder(order({
      shippingMarkText: 'TEST/1',
      shippingMarkIssuanceId: null,
    }))).toMatchObject({ action: 'BLOCKED', retryable: false })
    expect(classifyAutoReviewOrder(order({ hasVoucher: true }))).toMatchObject({
      action: 'BLOCKED',
      retryable: false,
      code: 'PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS',
    })
  })

  it('proceeds when the shipping marks were already issued', () => {
    expect(classifyAutoReviewOrder(order({
      shippingMarkText: 'TEST/1',
      shippingMarkIssuanceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }))).toEqual({ action: 'PROCEED' })
  })
})
