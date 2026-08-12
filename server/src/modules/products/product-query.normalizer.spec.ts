import { ApiException } from '../../infrastructure/http/api.exception'
import { normalizeProductListQuery } from './product-query.normalizer'

describe('normalizeProductListQuery', () => {
  it('uses confirmed defaults without inventing filters', () => {
    expect(normalizeProductListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
    })
  })

  it('preserves the exact supplier raw value and calculates pagination', () => {
    expect(normalizeProductListQuery({
      keyword: '  product-001  ',
      page: 3,
      pageSize: 50,
      supplierValue: ' raw-value ',
    })).toEqual({
      keyword: 'product-001',
      page: 3,
      pageSize: 50,
      skip: 100,
      supplierValue: ' raw-value ',
    })
  })

  it('accepts 64 Unicode code points even when UTF-16 uses more units', () => {
    const supplierValue = '😀'.repeat(64)
    expect(normalizeProductListQuery({ supplierValue }).supplierValue)
      .toBe(supplierValue)
  })

  it.each([
    null,
    { page: 0 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { keyword: '' },
    { keyword: '   ' },
    { keyword: '😀'.repeat(129) },
    { keyword: 123 },
    { supplierValue: '' },
    { supplierValue: '   ' },
    { supplierValue: '😀'.repeat(65) },
    { supplierValue: 123 },
  ])('rejects invalid input with a stable 422 response: %j', (input) => {
    expect(() => normalizeProductListQuery(input)).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
      }),
    )
    try {
      normalizeProductListQuery(input)
    }
    catch (error) {
      expect((error as ApiException).getStatus()).toBe(422)
      expect((error as ApiException).publicMessage).toBe('请求参数校验失败')
    }
  })
})
