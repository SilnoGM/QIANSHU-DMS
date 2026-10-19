import {
  calculateProductCatalogChecksum,
  parseProductCatalogManifest,
  PRODUCT_CATALOG_MANIFEST_VERSION,
  ProductCatalogManifestError,
  type ProductCatalogChecksumPayload,
} from './product-catalog.manifest'
import { parseProductImportFile } from './product-import.service'

function payload(): ProductCatalogChecksumPayload {
  return {
    suppliers: [{ value: 'QUANLIJIXIE', label: '全利机械' }],
    categories: [{ supplierValue: 'QUANLIJIXIE', name: '微耕机', sortOrder: 10 }],
    heads: [{
      supplierValue: 'QUANLIJIXIE',
      categoryName: '微耕机',
      name: '旱地履带',
      sortOrder: 10,
    }],
    products: [{
      supplierValue: 'QUANLIJIXIE',
      categoryName: '微耕机',
      productHeadName: '旱地履带',
      name: '旱地履带-25马力',
      status: 'ACTIVE',
      sortOrder: 10,
      twdSalePriceAmount: '113000.00',
      myrSalePriceAmount: '13500.00',
      purchaseCostAmount: '9300.00',
      attributes: [{ title: '马力', value: '25' }],
      remark: '双油缸推土铲',
    }],
  }
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = payload()
  return {
    version: PRODUCT_CATALOG_MANIFEST_VERSION,
    source: { env: 'test', release: 'v0.8.3', exportedAt: '2026-10-19T00:00:00.000Z' },
    suppliers: base.suppliers,
    categories: base.categories,
    heads: base.heads,
    products: base.products.map(product => ({ ...product, sourceProductNo: 'PROD/00001' })),
    incompleteProducts: [],
    dataChecksum: calculateProductCatalogChecksum(base),
    ...overrides,
  }
}

describe('product catalog manifest', () => {
  it('parses v2 and verifies the checksum', () => {
    const parsed = parseProductCatalogManifest(manifest())

    expect(parsed.version).toBe(2)
    expect(parsed.products).toHaveLength(1)
    expect(parsed.products[0]).toEqual({
      supplierValue: 'QUANLIJIXIE',
      categoryName: '微耕机',
      productHeadName: '旱地履带',
      name: '旱地履带-25马力',
      status: 'ACTIVE',
      sortOrder: 10,
      twdSalePriceAmount: '113000.00',
      myrSalePriceAmount: '13500.00',
      purchaseCostAmount: '9300.00',
      attributes: [{ title: '马力', value: '25' }],
      remark: '双油缸推土铲',
      sourceProductNo: 'PROD/00001',
    })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('rejects a tampered checksum', () => {
    expect(() => parseProductCatalogManifest(manifest({ dataChecksum: 'sha256:00' })))
      .toThrow(expect.objectContaining({ code: 'MANIFEST_CHECKSUM_MISMATCH' }))
  })

  it('rejects amounts with more decimals than the currency minor unit', () => {
    const base = payload()
    const overPrecise = {
      ...base,
      products: [{
        ...base.products[0],
        twdSalePriceAmount: '113000.0000',
      }],
    }
    expect(() => parseProductCatalogManifest(manifest({
      products: overPrecise.products.map(product => ({ ...product, sourceProductNo: 'PROD/00001' })),
      dataChecksum: calculateProductCatalogChecksum(overPrecise),
    }))).toThrow(expect.objectContaining({ code: 'MANIFEST_PRODUCT_TWD_SALE_PRICE_INVALID' }))
  })

  it('rejects duplicate product business keys', () => {
    const base = payload()
    const duplicated = {
      ...base,
      products: [base.products[0], base.products[0]],
    }
    expect(() => parseProductCatalogManifest(manifest({
      products: duplicated.products.map(product => ({ ...product, sourceProductNo: 'PROD/00001' })),
      dataChecksum: calculateProductCatalogChecksum(duplicated),
    }))).toThrow(expect.objectContaining({ code: 'MANIFEST_DUPLICATE_PRODUCT' }))
  })

  it('rejects products without category or product head', () => {
    expect(() => parseProductCatalogManifest(manifest({
      products: [{
        ...payload().products[0],
        categoryName: null,
        sourceProductNo: 'PROD/00001',
      }],
    }))).toThrow(expect.objectContaining({ code: 'MANIFEST_PRODUCT_SCOPE_INVALID' }))
  })

  it('accepts a legacy v1 array through the file parser', () => {
    const parsed = parseProductImportFile([{
      supplierValue: 'QUANLIJIXIE',
      supplierLabel: '全利机械',
      categoryName: '微耕机',
      productHeadName: '旱地履带',
      name: '旱地履带-25马力',
      purchaseCostAmount: '9300',
      twdSalePriceAmount: '113000',
      myrSalePriceAmount: '13500',
      remark: null,
    }])

    expect(parsed.kind).toBe('v1')
  })

  it('routes a v2 object through the file parser', () => {
    expect(parseProductImportFile(manifest()).kind).toBe('v2')
  })

  it('rejects unknown manifest fields with a stable error', () => {
    expect(() => parseProductCatalogManifest(manifest({ unexpected: true })))
      .toThrow(ProductCatalogManifestError)
  })
})
