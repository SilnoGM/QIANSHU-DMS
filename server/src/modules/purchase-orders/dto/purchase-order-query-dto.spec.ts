import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { PurchaseOrderStatusCountsQueryDto } from './purchase-order-query.dto'

describe('PurchaseOrderStatusCountsQueryDto', () => {
  it('accepts a view and the shared non-toolbar filters', async () => {
    const dto = plainToInstance(PurchaseOrderStatusCountsQueryDto, {
      view: 'all',
      keyword: '  PO-001  ',
      supplierValue: 'SUPPLIER_A',
      purchaseType: 'SALES_LINKED',
      fulfillmentStatus: 'PREPARING',
      paymentStatus: 'PARTIALLY_PAID',
      orderDateFrom: '2026-08-01',
      orderDateTo: '2026-08-31',
    })

    await expect(validate(dto)).resolves.toEqual([])
    expect(dto).toMatchObject({
      view: 'all',
      supplierValue: 'SUPPLIER_A',
      purchaseType: 'SALES_LINKED',
      fulfillmentStatus: 'PREPARING',
      paymentStatus: 'PARTIALLY_PAID',
    })
    expect('page' in dto).toBe(false)
    expect('orderStatus' in dto).toBe(false)
    expect('pendingTask' in dto).toBe(false)
  })

  it.each([
    { view: 'unknown' },
    { view: 'all', purchaseType: 'UNKNOWN' },
    { view: 'pending', fulfillmentStatus: 'UNKNOWN' },
    { view: 'pending', paymentStatus: 'UNKNOWN' },
    { view: 'all', orderDateFrom: '2026/08/01' },
    { view: 'all', supplierValue: '供'.repeat(65) },
  ])('rejects invalid status-count filters %j', async input => {
    const dto = plainToInstance(PurchaseOrderStatusCountsQueryDto, input)

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
