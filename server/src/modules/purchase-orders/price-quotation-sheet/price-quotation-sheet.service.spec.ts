import { Readable } from 'node:stream'

import sharp from 'sharp'

import { PriceQuotationSheetService } from './price-quotation-sheet.service'
import { PriceQuotationSheetImageError, type PriceQuotationSheetSnapshot } from './price-quotation-sheet.snapshot'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function catalogInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER-A',
    orderDate: '2026-11-21',
    lines: [{
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      expectedReferencePurchaseUnitPriceAmount: '9300',
      actualPurchaseUnitPriceAmount: '9300',
      quantity: 2,
      description: '请附带说明书',
    }],
    ...overrides,
  }
}

function customInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productMode: 'CUSTOM',
    customSupplierName: '张三加工厂',
    orderDate: '2026-11-21',
    lines: [{
      lineType: 'CUSTOM',
      name: '定制托盘',
      referencePurchaseUnitPriceAmount: '1200',
      actualPurchaseUnitPriceAmount: '1200',
      quantity: 3,
      description: null,
    }],
    ...overrides,
  }
}

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    name: '环保设备',
    status: 'ACTIVE',
    supplierValue: 'SUPPLIER-A',
    purchaseCostAmount: { toFixed: () => '9300.0000' },
    purchaseCostCurrency: 'CNY',
    ...overrides,
  }
}

function fixture() {
  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue([product()]) },
    productMedia: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const dictionaryLookup = {
    resolveStoredValue: jest.fn().mockResolvedValue({
      known: true,
      effectiveEnabled: true,
      label: '千树设备有限公司',
    }),
  }
  const delivery = { open: jest.fn() }
  const renderer = {
    render: jest.fn<
      Promise<Buffer>,
      [PriceQuotationSheetSnapshot, ReadonlyMap<string, Buffer>]
    >().mockResolvedValue(Buffer.from('png')),
  }
  const service = new PriceQuotationSheetService(
    prisma as never,
    dictionaryLookup as never,
    delivery as never,
    renderer as never,
  )
  return { service, prisma, dictionaryLookup, delivery, renderer }
}

describe('PriceQuotationSheetService', () => {
  it('renders catalog product names and reference prices from the database', async () => {
    const f = fixture()
    const result = await f.service.generate(catalogInput())

    expect(result).toEqual({ buffer: Buffer.from('png'), filename: 'price-quotation-sheet-20261121.png' })
    expect(f.dictionaryLookup.resolveStoredValue).toHaveBeenCalledWith({
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER-A',
    })
    expect(f.renderer.render).toHaveBeenCalledWith({
      orderDate: '2026-11-21',
      supplierName: '千树设备有限公司',
      currencyCode: 'CNY',
      referenceTotalAmount: '18600.00',
      actualTotalAmount: '18600.00',
      lines: [{
        lineNumber: 1,
        productName: '环保设备',
        description: '请附带说明书',
        imageKey: PRODUCT_ID,
        quantity: 2,
        referenceUnitPrice: '9300.00',
        actualUnitPrice: '9300.00',
        actualAmount: '18600.00',
      }],
    }, expect.any(Map))
  })

  it('renders custom lines without touching product or dictionary data', async () => {
    const f = fixture()
    const result = await f.service.generate(customInput())

    expect(result.filename).toBe('price-quotation-sheet-20261121.png')
    expect(f.dictionaryLookup.resolveStoredValue).not.toHaveBeenCalled()
    expect(f.prisma.product.findMany).not.toHaveBeenCalled()
    expect(f.renderer.render).toHaveBeenCalledWith({
      orderDate: '2026-11-21',
      supplierName: '张三加工厂',
      currencyCode: 'CNY',
      referenceTotalAmount: '3600.00',
      actualTotalAmount: '3600.00',
      lines: [{
        lineNumber: 1,
        productName: '定制托盘',
        description: null,
        imageKey: null,
        quantity: 3,
        referenceUnitPrice: '1200.00',
        actualUnitPrice: '1200.00',
        actualAmount: '3600.00',
      }],
    }, expect.any(Map))
  })

  it('reads the primary product image and degrades to placeholders when storage fails', async () => {
    const f = fixture()
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer()
    f.prisma.productMedia.findMany.mockResolvedValue([{
      productId: PRODUCT_ID,
      mediaAsset: { objectKey: 'assets/2026/11/image.png', sizeBytes: BigInt(png.length) },
    }])
    f.delivery.open.mockResolvedValue({ stream: Readable.from([png]) })

    await f.service.generate(catalogInput())
    const calls = f.renderer.render.mock.calls
    expect(calls[0][1].get(PRODUCT_ID)).toBeInstanceOf(Buffer)

    f.renderer.render.mockClear()
    f.delivery.open.mockRejectedValueOnce(new Error('storage down'))
    await f.service.generate(catalogInput())
    const unavailable = f.renderer.render.mock.calls
    expect(unavailable[0][1].size).toBe(0)
  })

  it('rejects unavailable suppliers and products before rendering', async () => {
    const f = fixture()
    f.dictionaryLookup.resolveStoredValue.mockResolvedValueOnce({ known: false })
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE' })
    expect(f.prisma.product.findMany).not.toHaveBeenCalled()

    f.dictionaryLookup.resolveStoredValue.mockResolvedValueOnce({ known: true, effectiveEnabled: false })
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE' })

    f.prisma.product.findMany.mockResolvedValueOnce([])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_UNAVAILABLE' })
  })

  it('rejects product state that cannot be quoted', async () => {
    const f = fixture()
    f.prisma.product.findMany.mockResolvedValueOnce([product({ status: 'DISABLED' })])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_UNAVAILABLE' })

    f.prisma.product.findMany.mockResolvedValueOnce([product({ supplierValue: 'OTHER' })])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH' })

    f.prisma.product.findMany.mockResolvedValueOnce([product({ purchaseCostAmount: null })])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE' })

    f.prisma.product.findMany.mockResolvedValueOnce([product({ purchaseCostCurrency: 'USD' })])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE' })
  })

  it('rejects a reference price that changed after the user selected the product', async () => {
    const f = fixture()
    f.prisma.product.findMany.mockResolvedValueOnce([product({ purchaseCostAmount: { toFixed: () => '9400.0000' } })])
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_STATE_CHANGED',
    })
    expect(f.prisma.productMedia.findMany).not.toHaveBeenCalled()
    expect(f.renderer.render).not.toHaveBeenCalled()
  })

  it('maps renderer failures to the public error contract', async () => {
    const f = fixture()
    f.renderer.render.mockRejectedValueOnce(new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE'))
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_TOO_LARGE' })

    f.renderer.render.mockRejectedValueOnce(new Error('sharp failed'))
    await expect(f.service.generate(catalogInput())).rejects.toMatchObject({
      code: 'PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE',
    })
  })
})
