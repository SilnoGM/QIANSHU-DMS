import { ProductStatus } from '../../generated/prisma/enums'
import {
  buildProductUpdateTarget,
  normalizeProductUpdatePatch,
} from './product-update.normalizer'

const current = {
  name: '原产品',
  status: ProductStatus.DRAFT,
  supplierValue: 'HISTORICAL',
  twdSalePrice: { amount: '10.0000', currency: 'TWD' },
  myrSalePrice: { amount: null, currency: 'MYR' },
  purchaseCost: { amount: '5.5000', currency: 'CNY' },
  attributes: [{ title: '颜色', value: '红色' }],
}

describe('product update normalizer', () => {
  it('normalizes a partial patch and builds one complete immutable target', () => {
    const patch = normalizeProductUpdatePatch({
      name: '  新产品  ',
      attributes: [{ title: ' 尺寸 ', value: ' XL ' }],
      expectedVersion: 3,
    })
    const target = buildProductUpdateTarget(current, patch)

    expect(patch.expectedVersion).toBe(3)
    expect(target.command).toMatchObject({
      name: '新产品',
      status: ProductStatus.DRAFT,
      supplierValue: 'HISTORICAL',
      attributes: [{ title: '尺寸', value: 'XL' }],
    })
    expect(target.changedFields).toEqual(['attributes', 'name'])
    expect(Object.isFrozen(patch)).toBe(true)
    expect(Object.isFrozen(target.command.attributes)).toBe(true)
  })

  it('checks expectedVersion before treating a normalized request as no-op', () => {
    const patch = normalizeProductUpdatePatch({
      name: ' 原产品 ',
      expectedVersion: 2,
    })
    expect(buildProductUpdateTarget(current, patch).changedFields).toEqual([])
    expect(patch.expectedVersion).toBe(2)
  })

  it.each([
    null,
    { expectedVersion: 1 },
    { name: '产品' },
    { name: '产品', expectedVersion: 0 },
    { name: '产品', expectedVersion: 1, productNo: 'P001' },
  ])('rejects invalid or forbidden update input: %j', (input) => {
    expect(() => normalizeProductUpdatePatch(input)).toThrow(expect.objectContaining({
      code: 'VALIDATION_FAILED',
    }))
  })

  it('rejects an Active target without a supplier after merging the patch', () => {
    const patch = normalizeProductUpdatePatch({
      status: ProductStatus.ACTIVE,
      supplierValue: null,
      expectedVersion: 1,
    })
    expect(() => buildProductUpdateTarget(current, patch)).toThrow(
      expect.objectContaining({ code: 'PRODUCT_SUPPLIER_REQUIRED' }),
    )
  })
})
