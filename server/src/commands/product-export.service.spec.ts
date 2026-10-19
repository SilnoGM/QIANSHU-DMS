import { ProductExportService } from './product-export.service'

function decimal(value: string): { toFixed(places: number): string } {
  return {
    toFixed(places: number): string {
      const [whole, fraction = ''] = value.split('.')
      return `${whole}.${fraction.padEnd(places, '0').slice(0, places)}`
    },
  }
}

function createPrisma() {
  return {
    dictionaryType: {
      findUnique: jest.fn().mockResolvedValue({ id: 'supplier-type' }),
    },
    currency: {
      findMany: jest.fn().mockResolvedValue([
        { code: 'TWD', minorUnit: 2 },
        { code: 'MYR', minorUnit: 2 },
        { code: 'CNY', minorUnit: 2 },
      ]),
    },
    dictionaryItem: {
      findMany: jest.fn().mockResolvedValue([
        { value: 'QUANLIJIXIE', label: '全利机械' },
        { value: 'UNUSED', label: '未使用供应商' },
      ]),
    },
    productCategory: {
      findMany: jest.fn().mockResolvedValue([
        { supplierValue: 'QUANLIJIXIE', name: '微耕机', sortOrder: 10 },
        { supplierValue: 'QUANLIJIXIE', name: '配件', sortOrder: 20 },
      ]),
    },
    productHead: {
      findMany: jest.fn().mockResolvedValue([
        {
          name: '旱地履带',
          sortOrder: 10,
          category: { supplierValue: 'QUANLIJIXIE', name: '微耕机' },
        },
        {
          name: '刀片',
          sortOrder: 10,
          category: { supplierValue: 'QUANLIJIXIE', name: '配件' },
        },
      ]),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        {
          productNo: 'PROD/00002',
          name: '刀片-65Mn',
          status: 'ACTIVE',
          supplierValue: 'QUANLIJIXIE',
          sortOrder: 10,
          twdSalePriceAmount: null,
          twdSalePriceCurrency: 'TWD',
          myrSalePriceAmount: decimal('12.5'),
          myrSalePriceCurrency: 'MYR',
          purchaseCostAmount: decimal('3'),
          purchaseCostCurrency: 'CNY',
          attributes: [],
          remark: null,
          category: { supplierValue: 'QUANLIJIXIE', name: '配件' },
          productHead: { name: '刀片' },
        },
        {
          productNo: 'PROD/00001',
          name: '旱地履带-25马力',
          status: 'ACTIVE',
          supplierValue: 'QUANLIJIXIE',
          sortOrder: 10,
          twdSalePriceAmount: decimal('113000'),
          twdSalePriceCurrency: 'TWD',
          myrSalePriceAmount: decimal('13500'),
          myrSalePriceCurrency: 'MYR',
          purchaseCostAmount: decimal('9300'),
          purchaseCostCurrency: 'CNY',
          attributes: [{ title: '马力', value: '25' }],
          remark: '双油缸推土铲',
          category: { supplierValue: 'QUANLIJIXIE', name: '微耕机' },
          productHead: { name: '旱地履带' },
        },
        {
          productNo: 'PROD/00003',
          name: '历史无分类产品',
          status: 'INACTIVE',
          supplierValue: 'QUANLIJIXIE',
          sortOrder: 0,
          twdSalePriceAmount: null,
          twdSalePriceCurrency: 'TWD',
          myrSalePriceAmount: null,
          myrSalePriceCurrency: 'MYR',
          purchaseCostAmount: null,
          purchaseCostCurrency: 'CNY',
          attributes: [],
          remark: null,
          category: null,
          productHead: null,
        },
      ]),
    },
  }
}

describe('ProductExportService', () => {
  it('exports the referenced catalog in deterministic order and separates incomplete products', async () => {
    const prisma = createPrisma()
    const service = new ProductExportService(prisma as never)

    const manifest = await service.buildManifest({
      env: 'test',
      release: 'v0.8.3',
      now: new Date('2026-10-19T00:00:00.000Z'),
    })

    expect(manifest.source).toEqual({
      env: 'test',
      release: 'v0.8.3',
      exportedAt: '2026-10-19T00:00:00.000Z',
    })
    expect(manifest.suppliers).toEqual([{ value: 'QUANLIJIXIE', label: '全利机械' }])
    expect(manifest.categories.map(category => category.name)).toEqual(['微耕机', '配件'])
    expect(manifest.heads.map(head => head.name)).toEqual(['旱地履带', '刀片'])
    expect(manifest.products.map(product => product.name)).toEqual([
      '旱地履带-25马力',
      '刀片-65Mn',
    ])
    expect(manifest.products[0]).toEqual(expect.objectContaining({
      twdSalePriceAmount: '113000.00',
      myrSalePriceAmount: '13500.00',
      purchaseCostAmount: '9300.00',
    }))
    expect(manifest.products[1]).toEqual(expect.objectContaining({
      twdSalePriceAmount: null,
      myrSalePriceAmount: '12.50',
      purchaseCostAmount: '3.00',
    }))
    expect(manifest.products[0]?.sourceProductNo).toBe('PROD/00001')
    expect(manifest.incompleteProducts).toEqual([{
      supplierValue: 'QUANLIJIXIE',
      name: '历史无分类产品',
      sourceProductNo: 'PROD/00003',
      reason: 'MISSING_CATEGORY_OR_HEAD',
    }])
    expect(manifest.dataChecksum).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })

  it('fails when a referenced supplier dictionary item is missing', async () => {
    const prisma = createPrisma()
    prisma.dictionaryItem.findMany.mockResolvedValue([])
    const service = new ProductExportService(prisma as never)

    await expect(service.buildManifest({
      env: 'test',
      release: 'v0.8.3',
      now: new Date('2026-10-19T00:00:00.000Z'),
    })).rejects.toEqual(expect.objectContaining({ code: 'SUPPLIER_DICTIONARY_ENTRY_MISSING' }))
  })
})
