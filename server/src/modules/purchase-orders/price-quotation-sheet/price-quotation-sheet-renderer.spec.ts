import sharp from 'sharp'

import { PriceQuotationSheetRenderer } from './price-quotation-sheet-renderer'
import type { PriceQuotationSheetSnapshot } from './price-quotation-sheet.snapshot'

const renderer = new PriceQuotationSheetRenderer()

function render(snapshot: PriceQuotationSheetSnapshot, images: ReadonlyMap<string, Buffer> = new Map()): Promise<Buffer> {
  return renderer.render(snapshot, images)
}

function snapshot(overrides: Partial<PriceQuotationSheetSnapshot> = {}): PriceQuotationSheetSnapshot {
  return {
    orderDate: '2026-11-22',
    supplierName: '千树设备有限公司',
    currencyCode: 'CNY',
    referenceTotalAmount: '18600.00',
    actualTotalAmount: '18600.00',
    lines: [{
      lineNumber: 1,
      productName: '环保设备',
      description: '请附带说明书',
      imageKey: null,
      quantity: 2,
      referenceUnitPrice: '9300.00',
      actualUnitPrice: '9300.00',
      actualAmount: '18600.00',
    }],
    ...overrides,
  }
}

describe('PriceQuotationSheetRenderer', () => {
  jest.setTimeout(180_000)

  it('renders a deterministic A4 white PNG with bundled Chinese typography', async () => {
    const image = await render(snapshot())
    expect(await sharp(image).metadata()).toMatchObject({ format: 'png', width: 2100, height: 2970, density: 254, hasAlpha: false })
    expect(await sharp(image).extract({ left: 0, top: 2900, width: 2100, height: 70 }).raw().toBuffer()).toEqual(Buffer.alloc(2100 * 70 * 3, 255))
    expect(await sharp(image).extract({ left: 0, top: 0, width: 20, height: 20 }).raw().toBuffer()).toEqual(Buffer.alloc(1200, 255))
    expect(await render(snapshot())).toEqual(image)
    // 不同汉字必须产生不同像素，防止部署缺字体时全都退化成相同方块。
    expect(await render(snapshot({ supplierName: '仓储物流' }))).not.toEqual(image)
  })

  it('escapes Pango markup and tolerates long names and missing images', async () => {
    const image = await render(snapshot({
      lines: [{
        ...snapshot().lines[0],
        productName: '<span size="999999">literal</span> & 超长产品名称'.repeat(4),
        description: '备注<&>\n'.repeat(10),
      }],
    }))
    expect(await sharp(image).metadata()).toMatchObject({ width: 2100, height: 2970 })
  })

  it('fits the 100-line purchase limit into one tall image', async () => {
    const lines = Array.from({ length: 100 }, (_, index) => ({
      lineNumber: index + 1,
      productName: `环保设备 ${index + 1}`,
      description: '请附带说明书',
      imageKey: null,
      quantity: index + 1,
      referenceUnitPrice: '9300.00',
      actualUnitPrice: '9300.00',
      actualAmount: '18600.00',
    }))
    const image = await render(snapshot({ lines }))
    const metadata = await sharp(image).metadata()
    expect(metadata.width).toBe(2100)
    expect(metadata.height).toBeGreaterThan(2970)
    expect(metadata.height).toBeLessThanOrEqual(16_384)
    expect(image.byteLength).toBeLessThan(10 * 1024 * 1024)
  })

  it('rejects content that cannot fit the media height budget', async () => {
    const lines = Array.from({ length: 120 }, (_, index) => ({
      lineNumber: index + 1,
      productName: `产品 ${index + 1}`,
      description: null,
      imageKey: null,
      quantity: 1,
      referenceUnitPrice: '1.00',
      actualUnitPrice: '1.00',
      actualAmount: '1.00',
    }))
    await expect(render(snapshot({ lines }))).rejects.toMatchObject({ code: 'PURCHASE_ORDER_IMAGE_TOO_LARGE' })
  })
})
