import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import {
  SalesOrderListQueryDto,
  SalesOrderProductOptionsQueryDto,
  SalesOrderStatusCountsQueryDto,
} from './sales-order-query.dto'

const ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('SalesOrderListQueryDto', () => {
  it('accepts a canonical issuer user id', async () => {
    const dto = plainToInstance(SalesOrderListQueryDto, {
      issuerUserId: ISSUER_ID,
    })

    await expect(validate(dto)).resolves.toEqual([])
    expect(dto.issuerUserId).toBe(ISSUER_ID)
  })

  it('rejects a malformed issuer user id', async () => {
    const dto = plainToInstance(SalesOrderListQueryDto, {
      issuerUserId: 'not-a-user-id',
    })

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })

  it.each(['PENDING_RECONCILIATION', 'COMPLETED'])(
    'accepts the persisted %s order status filter',
    async (orderStatus) => {
      const dto = plainToInstance(SalesOrderListQueryDto, { orderStatus })

      await expect(validate(dto)).resolves.toEqual([])
      expect(dto.orderStatus).toBe(orderStatus)
    },
  )
})

describe('SalesOrderStatusCountsQueryDto', () => {
  it('accepts a view and the shared non-toolbar filters', async () => {
    const dto = plainToInstance(SalesOrderStatusCountsQueryDto, {
      view: 'all',
      keyword: '  SO-001  ',
      currencyCode: 'TWD',
      issuerUserId: ISSUER_ID,
      paymentStatus: 'PARTIALLY_PAID',
      orderDateFrom: '2026-08-01',
      orderDateTo: '2026-08-31',
    })

    await expect(validate(dto)).resolves.toEqual([])
    expect(dto).toMatchObject({
      view: 'all',
      currencyCode: 'TWD',
      issuerUserId: ISSUER_ID,
      paymentStatus: 'PARTIALLY_PAID',
    })
    expect('page' in dto).toBe(false)
    expect('orderStatus' in dto).toBe(false)
    expect('fulfillmentStatus' in dto).toBe(false)
  })

  it.each([
    { view: 'unknown' },
    { view: 'all', issuerUserId: 'not-a-user-id' },
    { view: 'pending', currencyCode: 'USD' },
    { view: 'pending', paymentStatus: 'UNKNOWN' },
    { view: 'all', orderDateFrom: '2026/08/01' },
  ])('rejects invalid status-count filters %j', async input => {
    const dto = plainToInstance(SalesOrderStatusCountsQueryDto, input)

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})

describe('SalesOrderProductOptionsQueryDto', () => {
  it('accepts fixed currency, exact supplier value and transformed pagination', async () => {
    const dto = plainToInstance(SalesOrderProductOptionsQueryDto, {
      currencyCode: 'TWD',
      keyword: '旅行',
      supplierValue: 'SUPPLIER_TW_01',
      page: '2',
      pageSize: '20',
    })

    await expect(validate(dto)).resolves.toEqual([])
    expect(dto).toMatchObject({
      currencyCode: 'TWD',
      keyword: '旅行',
      supplierValue: 'SUPPLIER_TW_01',
      page: 2,
      pageSize: 20,
    })
  })

  it.each([
    { page: '0' },
    { pageSize: '0' },
    { pageSize: '51' },
    { supplierValue: '' },
    { supplierValue: '供'.repeat(65) },
  ])('rejects invalid selector query %j', async partial => {
    const dto = plainToInstance(SalesOrderProductOptionsQueryDto, {
      currencyCode: 'MYR',
      ...partial,
    })

    await expect(validate(dto)).resolves.not.toHaveLength(0)
  })
})
