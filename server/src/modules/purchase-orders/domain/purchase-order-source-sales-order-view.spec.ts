import type {
  SalesOrderFulfillmentStatus,
  SalesOrderStatus,
} from '../../../generated/prisma/enums'
import * as sourceView from './purchase-order-source-sales-order-view'

interface SalesOrderPurchaseFacts {
  readonly orderStatus: SalesOrderStatus
  readonly fulfillmentStatus: SalesOrderFulfillmentStatus
  readonly activePurchaseOrderCount: number
  readonly purchasedQuantity: number
  readonly remainingQuantity: number
}

type TrustedSourceView =
  | 'UNPURCHASED'
  | 'PARTIALLY_PURCHASED'
  | 'COMPLETED_PURCHASE_ADD_ON'

function classify(facts: SalesOrderPurchaseFacts): TrustedSourceView | null {
  const classifier = (
    sourceView as unknown as {
      classifyPurchaseSourceView?: (
        input: SalesOrderPurchaseFacts,
      ) => TrustedSourceView | null
    }
  ).classifyPurchaseSourceView

  if (classifier === undefined) {
    throw new Error('classifyPurchaseSourceView is not implemented')
  }
  return classifier(facts)
}

function facts(
  overrides: Partial<SalesOrderPurchaseFacts> = {},
): SalesOrderPurchaseFacts {
  return {
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    activePurchaseOrderCount: 0,
    purchasedQuantity: 0,
    remainingQuantity: 3,
    ...overrides,
  }
}

describe('classifyPurchaseSourceView', () => {
  it('classifies a confirmed pending order without an active purchase as unpurchased', () => {
    expect(classify(facts())).toBe('UNPURCHASED')
  })

  it.each([
    'PENDING',
    'PREPARING',
    'LAND_TRANSIT',
    'WAREHOUSE_ARRIVED',
  ] as const)(
    'classifies purchased orders with remaining quantity before sea transit as partial in %s',
    (fulfillmentStatus) => {
      expect(classify(facts({
        fulfillmentStatus,
        activePurchaseOrderCount: 1,
        purchasedQuantity: 2,
        remainingQuantity: 1,
      }))).toBe('PARTIALLY_PURCHASED')
    },
  )

  it.each([
    'PENDING',
    'PREPARING',
    'LAND_TRANSIT',
    'WAREHOUSE_ARRIVED',
  ] as const)(
    'classifies fully purchased orders before sea transit as completed-purchase add-on in %s',
    (fulfillmentStatus) => {
      expect(classify(facts({
        fulfillmentStatus,
        activePurchaseOrderCount: 1,
        purchasedQuantity: 3,
        remainingQuantity: 0,
      }))).toBe('COMPLETED_PURCHASE_ADD_ON')
    },
  )

  it.each([
    facts({ orderStatus: 'DRAFT' }),
    facts({ orderStatus: 'CANCELLED' }),
    facts({ fulfillmentStatus: 'SEA_TRANSIT' }),
    facts({ fulfillmentStatus: 'SIGNED' }),
    facts({ activePurchaseOrderCount: 0, purchasedQuantity: 1, remainingQuantity: 2 }),
    facts({ activePurchaseOrderCount: 1, purchasedQuantity: 0, remainingQuantity: 2 }),
    facts({ activePurchaseOrderCount: 0, purchasedQuantity: 0, remainingQuantity: 0 }),
  ])('rejects an unavailable or internally inconsistent fact set %#', (input) => {
    expect(classify(input)).toBeNull()
  })

  it('keeps all view codes unique and ordered by the user workflow', () => {
    expect(sourceView.PURCHASE_ORDER_SOURCE_SALES_ORDER_VIEWS).toEqual([
      'UNPURCHASED',
      'PARTIALLY_PURCHASED',
      'COMPLETED_PURCHASE_ADD_ON',
    ])
  })
})
