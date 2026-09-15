import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import sharp, { type OverlayOptions } from 'sharp'

import { MEDIA_CONTENT_SIZE_LIMITS } from '../../media/media-validation'
import { PurchaseOrderImageError, type PurchaseOrderImageSnapshot } from './purchase-order-image-snapshot'

const WIDTH = 1600
const PAGE_WIDTH = 2100
const PAGE_HEIGHT = 2970
const PAGE_DENSITY = 254
const MARGIN = 64
const CONTENT_WIDTH = WIDTH - MARGIN * 2
// 210:297 对应 A4 竖版；保持现有排版字号，超页拒绝生成，不缩小文字或截断内容。
const MAX_HEIGHT = Math.floor(WIDTH * PAGE_HEIGHT / PAGE_WIDTH)
const MIN_LINE_HEIGHT = 132
const FONT_DIRECTORY = resolve(__dirname, '../../../../deploy/fonts/noto-sans-sc')
const FONT_FILE = resolve(FONT_DIRECTORY, 'NotoSansSC.ttf')
// 固定白底单据采用项目 green.light 主色 oklch(0.527 0.154 150.069) 的 sRGB 值；不随浏览器主题变化。
const COLORS = { primary: '#008236', ink: '#18221c', muted: '#6b756f', line: '#dce4de', soft: '#f2f7f3', white: '#ffffff' }

function escapeMarkup(value: string): string {
  return value.replace(/\p{Cc}/gu, character => character === '\n' || character === '\t' ? character : '')
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;')
}

function money(value: string): string {
  const [integer, fraction = '0000'] = value.split('.')
  const decimals = fraction.replace(/0+$/u, '').padEnd(2, '0')
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${decimals}`
}

interface TextImage { readonly data: Buffer, readonly width: number, readonly height: number }

/**
 * 使用独立的固定布局和随服务端归档的字体。业务值只进入转义后的 Pango 文本，
 * 图片只接受服务端已读取的 bytes，不访问输入 URL 或本地路径。
 */
export class PurchaseOrderImageRenderer {
  async render(snapshot: PurchaseOrderImageSnapshot, imageBytes: ReadonlyMap<string, Buffer> = new Map()): Promise<Buffer> {
    try {
      await access(FONT_FILE)
      // Pango 首次初始化不应扫描无关宿主字体；运维显式提供的配置仍保留。
      process.env.FONTCONFIG_FILE ??= resolve(FONT_DIRECTORY, 'fonts.conf')
      if (snapshot.lines.length * MIN_LINE_HEIGHT + 700 > MAX_HEIGHT) this.tooLarge()
      const canvas = new PurchaseOrderImageCanvas()
      return await canvas.render(snapshot, imageBytes)
    }
    catch (error) {
      if (error instanceof PurchaseOrderImageError) throw error
      throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE')
    }
  }

  private tooLarge(): never { throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE') }
}

/** 每次渲染单独持有布局状态，避免并发请求混入另一张采购单的内容。 */
class PurchaseOrderImageCanvas {
  private y = MARGIN
  private readonly overlays: OverlayOptions[] = []
  private readonly shapes: string[] = []

  private async text(value: string, width: number, size = 24, color = COLORS.ink, bold = false): Promise<TextImage> {
    const result = await sharp({ text: {
      text: `<span foreground="${color}"${bold ? ' weight="600"' : ''}>${escapeMarkup(value || '—')}</span>`,
      font: `Noto Sans SC ${size}`, fontfile: FONT_FILE, width, wrap: 'word-char', spacing: 8, rgba: true,
    } }).png().toBuffer({ resolveWithObject: true })
    if (result.info.width > width || result.info.height > MAX_HEIGHT) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    return { data: result.data, width: result.info.width, height: result.info.height }
  }

  private place(text: TextImage, left: number, top: number, rightWidth?: number): void {
    this.overlays.push({ input: text.data, left: Math.round(left + (rightWidth === undefined ? 0 : rightWidth - text.width)), top: Math.round(top) })
  }

  private advance(height: number): void {
    this.y += height
    if (this.y + MARGIN > MAX_HEIGHT) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
  }

  private rect(x: number, y: number, width: number, height: number, fill: string, radius = 0): void {
    this.shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`)
  }

  private line(y = this.y): void { this.rect(MARGIN, y, CONTENT_WIDTH, 1, COLORS.line) }

  private async section(title: string): Promise<void> {
    this.advance(30)
    const label = await this.text(title, CONTENT_WIDTH - 24, 27, COLORS.ink, true)
    this.rect(MARGIN, this.y, 5, label.height, COLORS.primary, 2)
    this.place(label, MARGIN + 20, this.y)
    this.advance(label.height + 22)
  }

  private async basicRow(left: string, right: string): Promise<void> {
    const [a, b] = await Promise.all([this.text(left, 714, 24), this.text(right, 714, 24)])
    this.place(a, MARGIN, this.y)
    this.place(b, MARGIN + 758, this.y)
    this.advance(Math.max(a.height, b.height) + 18)
  }

  async render(snapshot: PurchaseOrderImageSnapshot, imageBytes: ReadonlyMap<string, Buffer>): Promise<Buffer> {
    const [brand, title, orderNo] = await Promise.all([
      this.text('千树 · 采购单', 600, 22, COLORS.primary, true),
      this.text('采购单', 620, 48, COLORS.ink, true),
      this.text(snapshot.orderNo, 770, 28, COLORS.ink, true),
    ])
    this.place(brand, MARGIN, this.y)
    this.advance(brand.height + 18)
    this.place(title, MARGIN, this.y)
    this.place(orderNo, WIDTH - MARGIN - 770, this.y + 14, 770)
    this.advance(Math.max(title.height, orderNo.height + 14) + 30)
    this.rect(MARGIN, this.y, CONTENT_WIDTH, 3, COLORS.primary)
    this.advance(28)
    await this.basicRow(`供应商：${snapshot.supplierName}`, `采购经办人：${snapshot.purchaserName}`)
    await this.basicRow(`采购日期：${snapshot.orderDate}`, `采购币种：${snapshot.currencyCode}`)
    const mark = await this.text(`基础唛头：${snapshot.shippingMarkText}`, CONTENT_WIDTH - 40, 28, COLORS.primary, true)
    this.rect(MARGIN, this.y, CONTENT_WIDTH, mark.height + 40, COLORS.soft, 12)
    this.place(mark, MARGIN + 20, this.y + 20)
    this.advance(mark.height + 40)

    await this.section(`采购产品  ·  ${snapshot.lines.length} 项`)
    const columns = [
      { label: '产品 / 规格备注', left: MARGIN + 18, width: 668, right: false },
      { label: '数量', left: MARGIN + 716, width: 90, right: true },
      { label: '采购单价', left: MARGIN + 830, width: 280, right: true },
      { label: '小计', left: MARGIN + 1134, width: 320, right: true },
    ]
    this.rect(MARGIN, this.y, CONTENT_WIDTH, 58, COLORS.soft)
    for (const column of columns) {
      const label = await this.text(column.label, column.width, 22, COLORS.muted)
      this.place(label, column.left, this.y + 15, column.right ? column.width : undefined)
    }
    this.advance(58)
    for (const product of snapshot.lines) await this.productRow(product, imageBytes)

    this.advance(24)
    const [totalLabel, total] = await Promise.all([
      this.text('采购总额', 360, 26, COLORS.ink, true),
      this.text(`¥${money(snapshot.purchaseTotalAmount)} ${snapshot.currencyCode}`, 1072, 34, COLORS.primary, true),
    ])
    this.place(totalLabel, MARGIN, this.y + 7)
    this.place(total, MARGIN + 400, this.y, 1072)
    this.advance(Math.max(total.height, totalLabel.height + 7) + 18)
    const terms = await this.text(`约定定金  ¥${money(snapshot.depositDueAmount)}    ·    约定尾款  ¥${money(snapshot.balanceDueAmount)}`, CONTENT_WIDTH, 23, COLORS.muted)
    this.place(terms, MARGIN, this.y, CONTENT_WIDTH)
    this.advance(terms.height + 20)
    this.line()

    await this.section(`采购货件  ·  ${snapshot.parts.length} 件`)
    for (const part of snapshot.parts) await this.shipment(part, snapshot)
    if (snapshot.remark) {
      await this.section('采购备注')
      const remark = await this.text(snapshot.remark, CONTENT_WIDTH, 23)
      this.place(remark, MARGIN, this.y)
      this.advance(remark.height + 16)
    }
    this.advance(18)
    this.line()
    this.advance(20)
    const footer = await this.text(`${snapshot.orderNo}  ·  共 ${snapshot.lines.length} 项产品 / ${snapshot.parts.length} 件货件`, CONTENT_WIDTH, 20, COLORS.muted)
    this.place(footer, MARGIN, this.y)
    this.advance(footer.height)
    const height = Math.max(900, Math.ceil(this.y + MARGIN))
    if (height > MAX_HEIGHT) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="100%" height="100%" fill="white"/>${this.shapes.join('')}</svg>`)
    // 先合成排版，再等比放到 A4 画布上。短单据仅补白，避免拉伸产品图片和文字。
    const content = await sharp(background).composite(this.overlays).flatten({ background: COLORS.white }).removeAlpha().png().toBuffer()
    const output = await sharp(content)
      .resize(PAGE_WIDTH, PAGE_HEIGHT, { fit: 'contain', position: 'north', background: COLORS.white })
      .withMetadata({ density: PAGE_DENSITY })
      .png({ compressionLevel: 9 }).toBuffer()
    if (BigInt(output.byteLength) > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    return output
  }

  private async productRow(product: PurchaseOrderImageSnapshot['lines'][number], imageBytes: ReadonlyMap<string, Buffer>): Promise<void> {
    const top = this.y + 22
    const infoLeft = MARGIN + 136
    let infoY = top
    for (const [value, size, color, bold] of [
      [product.productNo ?? '临时产品', 20, COLORS.muted, false],
      [product.productName, 26, COLORS.ink, true],
      [product.attributes.join('；'), 21, COLORS.muted, false],
      [product.description ? `备注：${product.description}` : '', 21, COLORS.muted, false],
    ] as const) {
      if (!value) continue
      const info = await this.text(value, 548, size, color, bold)
      this.place(info, infoLeft, infoY)
      infoY += info.height + 10
    }
    this.rect(MARGIN + 18, top, 96, 96, COLORS.soft, 8)
    if (product.mainImageId) {
      const bytes = imageBytes.get(product.mainImageId)
      if (!bytes) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_PRODUCT_IMAGE_UNAVAILABLE')
      try {
        const image = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).autoOrient()
          .resize(96, 96, { fit: 'contain', background: COLORS.white }).flatten({ background: COLORS.white }).png().toBuffer()
        this.overlays.push({ input: image, left: MARGIN + 18, top })
      }
      catch { throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_PRODUCT_IMAGE_UNAVAILABLE') }
    }
    else {
      const placeholder = await this.text('暂无\n图片', 80, 20, COLORS.muted)
      this.place(placeholder, MARGIN + 18 + (96 - placeholder.width) / 2, top + (96 - placeholder.height) / 2)
    }
    const quantities = await Promise.all([
      this.text(String(product.quantity), 90, 24),
      this.text(money(product.unitPrice), 280, 24),
      this.text(money(product.amount), 320, 24, COLORS.ink, true),
    ])
    for (const [index, column] of [{ left: 716, width: 90 }, { left: 830, width: 280 }, { left: 1134, width: 320 }].entries()) {
      this.place(quantities[index], MARGIN + column.left, top + 4, column.width)
    }
    this.advance(Math.max(MIN_LINE_HEIGHT, infoY - this.y + 16, ...quantities.map(text => text.height + 44)))
    this.line()
  }

  private async shipment(part: PurchaseOrderImageSnapshot['parts'][number], snapshot: PurchaseOrderImageSnapshot): Promise<void> {
    const [label, number] = await Promise.all([
      this.text(`货件-${String(part.partNumber).padStart(2, '0')}`, 530, 25, COLORS.ink, true),
      this.text(part.shipmentNo, 840, 24, COLORS.muted),
    ])
    this.rect(MARGIN, this.y, CONTENT_WIDTH, Math.max(label.height, number.height) + 28, COLORS.soft, 8)
    this.place(label, MARGIN + 16, this.y + 14)
    this.place(number, MARGIN + CONTENT_WIDTH - 856, this.y + 14, 840)
    this.advance(Math.max(label.height, number.height) + 44)
    const mark = await this.text(`唛头：${part.shippingMarkText}`, CONTENT_WIDTH - 32, 24, COLORS.primary, true)
    this.place(mark, MARGIN + 16, this.y)
    this.advance(mark.height + 20)
    for (const item of part.items) {
      const product = snapshot.lines.find(line => line.id === item.purchaseOrderLineId)
      if (!product) throw new PurchaseOrderImageError('PURCHASE_ORDER_IMAGE_SNAPSHOT_INVALID')
      const [name, quantity] = await Promise.all([
        this.text(`${product.productNo ? `${product.productNo}  ·  ` : ''}${product.productName}`, CONTENT_WIDTH - 220, 22),
        this.text(`数量 ${item.quantity}`, 170, 22),
      ])
      this.place(name, MARGIN + 16, this.y)
      this.place(quantity, MARGIN + CONTENT_WIDTH - 186, this.y, 170)
      this.advance(Math.max(name.height, quantity.height) + 14)
    }
    this.advance(14)
  }
}
