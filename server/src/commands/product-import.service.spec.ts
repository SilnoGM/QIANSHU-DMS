import {
  parseProductImportManifest,
  ProductImportOperationError,
} from './product-import.service'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplierValue: 'QUANLIJIXIE',
    supplierLabel: ' 全利机械 ',
    categoryName: ' 微耕机 ',
    productHeadName: ' 旱地履带 ',
    name: ' 旱地履带-常州单缸-25马力微耕机 ',
    purchaseCostAmount: '9300',
    twdSalePriceAmount: '113000',
    myrSalePriceAmount: '13500',
    remark: ' 双油缸推土铲 ',
    ...overrides,
  }
}

describe('parseProductImportManifest', () => {
  it('trims NFC text and preserves zero prices and optional remark', () => {
    const parsed = parseProductImportManifest([
      row(),
      row({
        name: '0号炉-顶盖',
        purchaseCostAmount: '0',
        twdSalePriceAmount: '0',
        myrSalePriceAmount: '0',
        remark: null,
      }),
    ])

    expect(parsed[0]).toEqual({
      supplierValue: 'QUANLIJIXIE',
      supplierLabel: '全利机械',
      categoryName: '微耕机',
      productHeadName: '旱地履带',
      name: '旱地履带-常州单缸-25马力微耕机',
      purchaseCostAmount: '9300',
      twdSalePriceAmount: '113000',
      myrSalePriceAmount: '13500',
      remark: '双油缸推土铲',
    })
    expect(parsed[1]?.remark).toBeNull()
    expect(parsed[1]?.twdSalePriceAmount).toBe('0')
  })

  it.each([
    [{ supplierValue: '全利机械' }, 'MANIFEST_SUPPLIERVALUE_INVALID'],
    [{ purchaseCostAmount: '1.00001' }, 'MANIFEST_PURCHASECOSTAMOUNT_INVALID'],
    [{ name: '   ' }, 'MANIFEST_NAME_INVALID'],
    [{ unexpected: 'x' }, 'MANIFEST_ROW_UNKNOWN_FIELD'],
  ])('rejects invalid rows with a stable code', (overrides, code) => {
    expect(() => parseProductImportManifest([row(overrides)]))
      .toThrow(expect.objectContaining({ code }))
  })

  it('rejects a non-array manifest', () => {
    expect(() => parseProductImportManifest({}))
      .toThrow(ProductImportOperationError)
  })
})
