import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { SalesOrderProductOptionsQueryDto } from './sales-order-query.dto'

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
