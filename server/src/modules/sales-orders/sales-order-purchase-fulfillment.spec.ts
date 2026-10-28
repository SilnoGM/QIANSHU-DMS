import type { Prisma } from '../../generated/prisma/client'
import { assertSalesOrderPurchaseFulfillment } from './sales-order-purchase-fulfillment'

const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_LINE_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SALES_LINE_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

interface PurchaseFact {
  readonly fulfillmentStatus: 'ORDERED' | 'PREPARING' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'SIGNED'
  readonly orderStatus: 'PENDING_REVIEW' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  readonly lines: readonly {
    readonly sourceSalesOrderLineId: string | null
    readonly quantity: number
  }[]
}

function setup(overrides: {
  readonly claimedRows?: readonly { readonly salesOrderLineId: string, readonly quantity: number }[]
  readonly purchases?: readonly PurchaseFact[]
  readonly unownedRows?: readonly {
    readonly quantity: number
    readonly line: { readonly sourceSalesOrderLineId: string | null }
  }[]
} = {}) {
  const transaction = {
    salesOrderLine: {
      findMany: jest.fn().mockResolvedValue([
        { id: SALES_LINE_A_ID, quantity: 2 },
        { id: SALES_LINE_B_ID, quantity: 1 },
      ]),
    },
    purchaseOrder: {
      findMany: jest.fn().mockResolvedValue([...(overrides.purchases ?? [])]),
    },
    purchaseOrderPartItem: {
      findMany: jest.fn().mockResolvedValue([...(overrides.unownedRows ?? [])]),
    },
    shipmentClaimLine: {
      findMany: jest.fn().mockResolvedValue([...(overrides.claimedRows ?? [])]),
    },
  } as unknown as Prisma.TransactionClient
  return { transaction }
}

describe('assertSalesOrderPurchaseFulfillment', () => {
  it('accepts a claim-only order as covered and already shipped', async () => {
    const { transaction } = setup({
      claimedRows: [
        { salesOrderLineId: SALES_LINE_A_ID, quantity: 2 },
        { salesOrderLineId: SALES_LINE_B_ID, quantity: 1 },
      ],
    })

    await expect(assertSalesOrderPurchaseFulfillment(
      transaction,
      SALES_ORDER_ID,
      'LAND_TRANSIT',
    )).resolves.toBeUndefined()
  })

  it('rejects an order whose claimed quantities leave a sales line uncovered', async () => {
    const { transaction } = setup({
      claimedRows: [{ salesOrderLineId: SALES_LINE_B_ID, quantity: 1 }],
    })

    await expect(assertSalesOrderPurchaseFulfillment(
      transaction,
      SALES_ORDER_ID,
      'PREPARING',
    )).rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
  })

  it('merges approved purchases with claimed quantities before checking coverage', async () => {
    const { transaction } = setup({
      claimedRows: [{ salesOrderLineId: SALES_LINE_B_ID, quantity: 1 }],
      purchases: [{
        fulfillmentStatus: 'SHIPPED',
        orderStatus: 'CONFIRMED',
        lines: [{ sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2 }],
      }],
    })

    await expect(assertSalesOrderPurchaseFulfillment(
      transaction,
      SALES_ORDER_ID,
      'LAND_TRANSIT',
    )).resolves.toBeUndefined()
  })

  it('rejects coverage whose shipments were released to storage', async () => {
    const { transaction } = setup({
      claimedRows: [{ salesOrderLineId: SALES_LINE_B_ID, quantity: 1 }],
      purchases: [{
        fulfillmentStatus: 'SHIPPED',
        orderStatus: 'CONFIRMED',
        lines: [{ sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2 }],
      }],
      unownedRows: [{
        line: { sourceSalesOrderLineId: SALES_LINE_A_ID },
        quantity: 2,
      }],
    })

    await expect(assertSalesOrderPurchaseFulfillment(
      transaction,
      SALES_ORDER_ID,
      'PREPARING',
    )).rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
  })

  it('still requires every active purchase to ship', async () => {
    const { transaction } = setup({
      claimedRows: [{ salesOrderLineId: SALES_LINE_B_ID, quantity: 1 }],
      purchases: [{
        fulfillmentStatus: 'PREPARING',
        orderStatus: 'CONFIRMED',
        lines: [{ sourceSalesOrderLineId: SALES_LINE_A_ID, quantity: 2 }],
      }],
    })

    await expect(assertSalesOrderPurchaseFulfillment(
      transaction,
      SALES_ORDER_ID,
      'LAND_TRANSIT',
    )).rejects.toMatchObject({ code: 'SALES_ORDER_FULFILLMENT_TRANSITION_INVALID' })
  })
})
