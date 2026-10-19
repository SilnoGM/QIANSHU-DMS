import {
  calculateProductCatalogChecksum,
  PRODUCT_CATALOG_MANIFEST_VERSION,
  type ProductCatalogManifest,
} from './product-catalog.manifest'
import { ProductImportService } from './product-import.service'

function catalog(): ProductCatalogManifest {
  const payload = {
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
      status: 'ACTIVE' as const,
      sortOrder: 10,
      twdSalePriceAmount: '113000.00',
      myrSalePriceAmount: '13500.00',
      purchaseCostAmount: '9300.00',
      attributes: [{ title: '马力', value: '25' }],
      remark: '双油缸推土铲',
      sourceProductNo: 'PROD/00001',
    }],
  }
  return {
    version: PRODUCT_CATALOG_MANIFEST_VERSION,
    source: { env: 'test', release: 'v0.8.3', exportedAt: '2026-10-19T00:00:00.000Z' },
    ...payload,
    incompleteProducts: [],
    dataChecksum: calculateProductCatalogChecksum(payload),
  }
}

function createDependencies(existing: {
  supplier?: { id: string, value: string, label: string, enabled: boolean, version: number } | null
  product?: unknown
} = {}) {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'system-admin' }),
    },
    dictionaryType: {
      findUnique: jest.fn().mockResolvedValue({ id: 'supplier-type', enabled: true }),
    },
    dictionaryItem: {
      findMany: jest.fn().mockResolvedValue(existing.supplier === undefined || existing.supplier === null
        ? []
        : [existing.supplier]),
    },
    product: {
      findMany: jest.fn().mockResolvedValue(existing.product === undefined ? [] : [existing.product]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    productCategory: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    productHead: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const dictionaries = {
    createItem: jest.fn().mockResolvedValue({ id: 'supplier-item', version: 1 }),
    enableItem: jest.fn().mockResolvedValue({ id: 'supplier-item', version: 2 }),
    updateItem: jest.fn().mockResolvedValue({ id: 'supplier-item', version: 2 }),
  }
  const products = {
    create: jest.fn().mockResolvedValue({ id: 'product' }),
  }
  const taxonomies = {
    createCategory: jest.fn().mockResolvedValue({ id: 'category', sortOrder: 0 }),
    createHead: jest.fn().mockResolvedValue({ id: 'head', sortOrder: 0 }),
  }
  return { prisma, dictionaries, products, taxonomies }
}

function service(dependencies: ReturnType<typeof createDependencies>): ProductImportService {
  return new ProductImportService(
    dependencies.prisma as never,
    dependencies.dictionaries as never,
    dependencies.products as never,
    dependencies.taxonomies as never,
  )
}

describe('ProductImportService catalog v2', () => {
  it('previews without writing', async () => {
    const dependencies = createDependencies()
    const result = await service(dependencies).run({ apply: false, catalog: catalog() })

    expect(result).toEqual(expect.objectContaining({
      mode: 'preview',
      products: 1,
      created: 1,
      skipped: 0,
      failed: 0,
      suppliersCreated: 1,
      categoriesCreated: 1,
      headsCreated: 1,
    }))
    expect(dependencies.dictionaries.createItem).not.toHaveBeenCalled()
    expect(dependencies.products.create).not.toHaveBeenCalled()
    expect(dependencies.taxonomies.createCategory).not.toHaveBeenCalled()
    expect(dependencies.taxonomies.createHead).not.toHaveBeenCalled()
  })

  it('creates suppliers, taxonomy, products, and applies sort order', async () => {
    const dependencies = createDependencies()
    dependencies.prisma.productCategory.findFirst.mockResolvedValueOnce(null)
    dependencies.prisma.productHead.findFirst.mockResolvedValueOnce(null)
    dependencies.prisma.product.findFirst
      .mockResolvedValueOnce({ id: 'product', sortOrder: 0 })

    const result = await service(dependencies).run({ apply: true, catalog: catalog() })

    expect(result.created).toBe(1)
    expect(result.categoriesCreated).toBe(1)
    expect(result.headsCreated).toBe(1)
    expect(dependencies.dictionaries.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'system-admin' }),
      'supplier-type',
      expect.objectContaining({ value: 'QUANLIJIXIE', label: '全利机械' }),
    )
    expect(dependencies.dictionaries.enableItem).toHaveBeenCalled()
    expect(dependencies.taxonomies.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'system-admin' }),
      expect.objectContaining({ supplierValue: 'QUANLIJIXIE', name: '微耕机' }),
    )
    expect(dependencies.taxonomies.createHead).toHaveBeenCalled()
    expect(dependencies.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'system-admin' }),
      expect.objectContaining({
        name: '旱地履带-25马力',
        categoryName: '微耕机',
        productHeadName: '旱地履带',
        supplierValue: 'QUANLIJIXIE',
        status: 'ACTIVE',
        attributes: [{ title: '马力', value: '25' }],
        remark: '双油缸推土铲',
      }),
    )
    expect(dependencies.prisma.productCategory.update).toHaveBeenCalledWith({
      where: { id: 'category' },
      data: { sortOrder: 10 },
    })
    expect(dependencies.prisma.productHead.update).toHaveBeenCalledWith({
      where: { id: 'head' },
      data: { sortOrder: 10 },
    })
    expect(dependencies.prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'product' },
      data: { sortOrder: 10 },
    })
  })

  it('updates an existing supplier label instead of conflicting', async () => {
    const dependencies = createDependencies({
      supplier: {
        id: 'supplier-item',
        value: 'QUANLIJIXIE',
        label: '旧名称',
        enabled: true,
        version: 3,
      },
    })
    dependencies.prisma.productCategory.findFirst
      .mockResolvedValueOnce({ id: 'category', sortOrder: 10 })
    dependencies.prisma.productHead.findFirst
      .mockResolvedValueOnce({ id: 'head', sortOrder: 10 })
    dependencies.prisma.product.findFirst
      .mockResolvedValueOnce({ id: 'product', sortOrder: 10 })

    const result = await service(dependencies).run({ apply: true, catalog: catalog() })

    expect(result.suppliersUpdated).toBe(1)
    expect(dependencies.dictionaries.updateItem).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'system-admin' }),
      'supplier-type',
      'supplier-item',
      expect.objectContaining({ label: '全利机械', expectedVersion: 3 }),
    )
  })

  it('skips an identical existing product and does not create it again', async () => {
    const dependencies = createDependencies({
      supplier: {
        id: 'supplier-item',
        value: 'QUANLIJIXIE',
        label: '全利机械',
        enabled: true,
        version: 1,
      },
      product: {
        id: 'product',
        name: '旱地履带-25马力',
        supplierValue: 'QUANLIJIXIE',
        status: 'ACTIVE',
        sortOrder: 10,
        twdSalePriceAmount: { toFixed: () => '113000.00' },
        twdSalePriceCurrency: 'TWD',
        myrSalePriceAmount: { toFixed: () => '13500.00' },
        myrSalePriceCurrency: 'MYR',
        purchaseCostAmount: { toFixed: () => '9300.00' },
        purchaseCostCurrency: 'CNY',
        attributes: [{ title: '马力', value: '25' }],
        remark: '双油缸推土铲',
        category: { name: '微耕机' },
        productHead: { name: '旱地履带' },
      },
    })
    dependencies.prisma.productCategory.findFirst
      .mockResolvedValueOnce({ id: 'category', sortOrder: 10 })
    dependencies.prisma.productHead.findFirst
      .mockResolvedValueOnce({ id: 'head', sortOrder: 10 })
    dependencies.prisma.product.findFirst
      .mockResolvedValueOnce({ id: 'product', sortOrder: 10 })

    const result = await service(dependencies).run({ apply: true, catalog: catalog() })

    expect(result).toEqual(expect.objectContaining({
      created: 0,
      skipped: 1,
      failed: 0,
    }))
    expect(dependencies.products.create).not.toHaveBeenCalled()
  })
})
