import { ProductStatus } from '../../generated/prisma/enums'
import { DictionaryTone } from '../../generated/prisma/enums'
import {
  ProductDataIntegrityError,
  mapProductListItem,
  type ProductQueryRow,
} from './product-query.mapper'

const EMPTY_MEDIA = { mainImage: null, images: [], videos: [] } as const

function createRow(
  overrides: Partial<ProductQueryRow> = {},
): ProductQueryRow {
  return {
    id: 'fd830f03-2b45-4e75-9857-06beea6513ba',
    name: '山茶精华',
    category: { id: 'category-1', name: '护肤品' },
    productHead: { id: 'head-1', name: '精华' },
    productNo: 'P202608120001',
    status: ProductStatus.INACTIVE,
    supplierValue: 'SUPPLIER_A',
    sortOrder: 10,
    twdSalePriceAmount: { toString: () => '1280.50' },
    twdSalePriceCurrency: 'TWD',
    myrSalePriceAmount: null,
    myrSalePriceCurrency: 'MYR',
    purchaseCostAmount: { toString: () => '88.13' },
    purchaseCostCurrency: 'CNY',
    attributes: [
      { title: '容量', value: '30ml', internal: 'must-not-leak' },
      { title: '产地', value: '中国台湾' },
    ],
    remark: null,
    createdBy: {
      id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      displayName: '系统管理员',
      profile: null,
    },
    updatedBy: null,
    version: 1,
    createdAt: new Date('2026-08-12T01:00:00.000Z'),
    updatedAt: new Date('2026-08-12T02:00:00.000Z'),
    ...overrides,
  }
}

describe('mapProductListItem', () => {
  it('serializes a maximum Product decimal without scientific notation', () => {
    const maximumDecimal = {
      toFixed: () => '99999999999999999999999999.12',
      toString: () => '9.999999999999999999999999912e+25',
    }

    expect(mapProductListItem(createRow({
      twdSalePriceAmount: maximumDecimal,
    }), {
      known: false,
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
    }, EMPTY_MEDIA).twdSalePrice.amount).toBe('99999999999999999999999999.12')
  })

  it('returns strict money strings, ordered attributes and whitelisted actors', () => {
    expect(mapProductListItem(createRow(), {
      known: true,
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: DictionaryTone.SUCCESS,
      typeEnabled: true,
      itemEnabled: true,
      effectiveEnabled: true,
    }, EMPTY_MEDIA)).toEqual({
      id: 'fd830f03-2b45-4e75-9857-06beea6513ba',
      name: '山茶精华',
      categoryId: 'category-1',
      categoryName: '护肤品',
      productHeadId: 'head-1',
      productHeadName: '精华',
      productNo: 'P202608120001',
      status: 'INACTIVE',
      supplier: {
        value: 'SUPPLIER_A',
        label: '供应商 A',
        tone: 'SUCCESS',
        state: 'EFFECTIVE',
      },
      sortOrder: 10,
      media: EMPTY_MEDIA,
      twdSalePrice: { amount: '1280.5', currency: 'TWD' },
      myrSalePrice: { amount: null, currency: 'MYR' },
      purchaseCost: { amount: '88.13', currency: 'CNY' },
      attributes: [
        { title: '容量', value: '30ml' },
        { title: '产地', value: '中国台湾' },
      ],
      remark: null,
      createdBy: {
        id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        displayName: '系统管理员',
        avatarUrl: null,
      },
      updatedBy: null,
      version: 1,
      createdAt: '2026-08-12T01:00:00.000Z',
      updatedAt: '2026-08-12T02:00:00.000Z',
    })
  })

  it('maps a non-null product remark', () => {
    expect(mapProductListItem(createRow({
      remark: '需加宽机身到 1.2 米',
    }), {
      known: false,
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
    }, EMPTY_MEDIA).remark).toBe('需加宽机身到 1.2 米')
  })

  it('maps disabled and unknown supplier history without changing raw values', () => {    expect(mapProductListItem(createRow(), {
      known: true,
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: DictionaryTone.DEFAULT,
      typeEnabled: true,
      itemEnabled: false,
      effectiveEnabled: false,
    }, EMPTY_MEDIA).supplier).toEqual({
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: 'DEFAULT',
      state: 'DISABLED',
    })
    expect(mapProductListItem(createRow({ supplierValue: ' raw ' }), {
      known: false,
      dictionaryCode: 'service_provider.supplier',
      value: ' raw ',
    }, EMPTY_MEDIA).supplier).toEqual({
      value: ' raw ',
      label: null,
      tone: null,
      state: 'UNKNOWN',
    })
  })

  it.each([
    null,
    {},
    [{ title: '', value: '30ml' }],
    [{ title: '容量', value: '   ' }],
    [{ title: 1, value: '30ml' }],
  ])('fails closed for invalid persisted attributes: %j', (attributes) => {
    expect(() => mapProductListItem(
      createRow({ attributes }),
      null,
      EMPTY_MEDIA,
    )).toThrow(ProductDataIntegrityError)
  })
})
