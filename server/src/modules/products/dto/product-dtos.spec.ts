import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { ProductListQueryDto } from './product-list-query.dto'

describe('ProductListQueryDto', () => {
  it('coerces pagination defaults and preserves exact supplier raw value', async () => {
    const defaults = plainToInstance(ProductListQueryDto, {})
    const complete = plainToInstance(ProductListQueryDto, {
      page: '2',
      pageSize: '100',
      supplierValue: ' raw-value ',
    })

    expect(defaults).toMatchObject({ page: 1, pageSize: 20 })
    expect(complete).toMatchObject({
      page: 2,
      pageSize: 100,
      supplierValue: ' raw-value ',
    })
    expect(await validate(defaults)).toEqual([])
    expect(await validate(complete)).toEqual([])
  })

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { supplierValue: '' },
    { supplierValue: '   ' },
    { supplierValue: '😀'.repeat(65) },
  ])('rejects invalid public query input: %j', async (input) => {
    expect(await validate(plainToInstance(ProductListQueryDto, input)))
      .not.toHaveLength(0)
  })
})
