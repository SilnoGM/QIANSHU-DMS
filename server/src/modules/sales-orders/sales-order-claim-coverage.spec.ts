import type { Prisma } from '../../generated/prisma/client'
import {
  mergeClaimedCoverage,
  readClaimedQuantitiesBySalesLine,
} from './sales-order-claim-coverage'

const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SALES_LINE_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SALES_LINE_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

describe('readClaimedQuantitiesBySalesLine', () => {
  it('sums claimed quantities of claimed storage records for the target order only', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { salesOrderLineId: SALES_LINE_A_ID, quantity: 1 },
      { salesOrderLineId: SALES_LINE_A_ID, quantity: 2 },
      { salesOrderLineId: SALES_LINE_B_ID, quantity: 3 },
    ])
    const transaction = { shipmentClaimLine: { findMany } } as unknown as Prisma.TransactionClient

    const result = await readClaimedQuantitiesBySalesLine(
      transaction,
      SALES_ORDER_ID,
      [SALES_LINE_A_ID, SALES_LINE_B_ID],
    )

    expect(findMany).toHaveBeenCalledWith({
      where: {
        salesOrderLineId: { in: [SALES_LINE_A_ID, SALES_LINE_B_ID] },
        storageRecord: { status: 'CLAIMED', claimedSalesOrderId: SALES_ORDER_ID },
      },
      select: { salesOrderLineId: true, quantity: true },
    })
    expect([...result]).toEqual([
      [SALES_LINE_A_ID, 3],
      [SALES_LINE_B_ID, 3],
    ])
  })

  it('returns an empty map without querying when there are no sales lines', async () => {
    const findMany = jest.fn()
    const transaction = { shipmentClaimLine: { findMany } } as unknown as Prisma.TransactionClient

    const result = await readClaimedQuantitiesBySalesLine(transaction, SALES_ORDER_ID, [])

    expect(result.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('mergeClaimedCoverage', () => {
  it('adds claimed quantities to the purchase coverage of the same line', () => {
    const merged = mergeClaimedCoverage(
      new Map([[SALES_LINE_A_ID, 1]]),
      new Map([[SALES_LINE_A_ID, 1], [SALES_LINE_B_ID, 2]]),
    )

    expect([...merged]).toEqual([
      [SALES_LINE_A_ID, 2],
      [SALES_LINE_B_ID, 2],
    ])
  })
})
