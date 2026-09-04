import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import {
  PurchaseOrderSourceSalesOrderLinesQueryDto,
  PurchaseOrderSourceSalesOrdersQueryDto,
  PurchaseOrderStatusCountsQueryDto,
} from './purchase-order-query.dto'

describe('PurchaseOrderSourceSalesOrdersQueryDto', () => {
  it.each([
    'UNPURCHASED',
    'PARTIALLY_PURCHASED',
  ])(
    'accepts the trusted source-sales-order view %s',
    async (view) => {
      const dto = plainToInstance(PurchaseOrderSourceSalesOrdersQueryDto, {
        view,
        productMode: 'CATALOG',
        supplierValue: 'SUPPLIER_A',
        keyword: 'SO-001',
        page: '2',
        pageSize: '50',
      })

      await expect(validate(dto)).resolves.toEqual([])
      expect(dto).toMatchObject({
        view,
        productMode: 'CATALOG',
        supplierValue: 'SUPPLIER_A',
        keyword: 'SO-001',
        page: 2,
        pageSize: 50,
      })
    },
  )

  it.each([
    {},
    { view: 'UNKNOWN', productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' },
    { view: 'INITIAL_PURCHASE', productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' },
    { view: 'SUPPLEMENTAL_PURCHASE', productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' },
    { view: 'COMPLETED_PURCHASE_ADD_ON', productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' },
    { view: 'UNPURCHASED', productMode: 'MIXED', supplierValue: 'SUPPLIER_A' },
    { view: 'UNPURCHASED', productMode: 'CATALOG' },
  ])('rejects a missing or unknown source-sales-order view %j', async input => {
    const dto = plainToInstance(PurchaseOrderSourceSalesOrdersQueryDto, input)

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it('rejects caller-composed sales status filters', async () => {
    const dto = plainToInstance(PurchaseOrderSourceSalesOrdersQueryDto, {
      view: 'UNPURCHASED',
      productMode: 'CUSTOM',
      orderStatus: 'CONFIRMED',
      fulfillmentStatus: 'PENDING',
    })

    await expect(validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })).resolves.not.toHaveLength(0)
  })
})

describe('PurchaseOrderSourceSalesOrderLinesQueryDto', () => {
  it.each([
    { productMode: 'CATALOG', supplierValue: 'SUPPLIER_A' },
    { productMode: 'CUSTOM' },
  ])('accepts the supported source line filter %j', async input => {
    const dto = plainToInstance(PurchaseOrderSourceSalesOrderLinesQueryDto, input)
    await expect(validate(dto)).resolves.toEqual([])
  })

  it.each([
    {},
    { productMode: 'MIXED' },
    { productMode: 'UNKNOWN' },
    { productMode: 'CATALOG' },
  ])('rejects an incomplete source line filter %j', async input => {
    const dto = plainToInstance(PurchaseOrderSourceSalesOrderLinesQueryDto, input)
    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

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
