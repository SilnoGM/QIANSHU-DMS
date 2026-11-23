import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import sharp, { type OverlayOptions } from 'sharp'

import { MEDIA_CONTENT_SIZE_LIMITS } from '../../media/media-validation'
import { PriceQuotationSheetImageError, type PriceQuotationSheetSnapshot } from './price-quotation-sheet.snapshot'

const WIDTH = 1600
const PAGE_WIDTH = 2100
const PAGE_HEIGHT = 2970
const PAGE_DENSITY = 254
const MAX_PAGE_HEIGHT = 16_384
const MARGIN = 64
const CONTENT_WIDTH = WIDTH - MARGIN * 2
const MAX_HEIGHT = Math.floor(WIDTH * MAX_PAGE_HEIGHT / PAGE_WIDTH)
// 100 行是采购明细上限；单行 100px 可把页眉、合计和红色提示一起控制在媒体上限内。
const MIN_ROW_HEIGHT = 100
const FONT_DIRECTORY = resolve(__dirname, '../../../../deploy/fonts/noto-sans-sc')
const FONT_FILE = resolve(FONT_DIRECTORY, 'NotoSansSC.ttf')
const COLORS = { primary: '#008236', destructive: '#e7000b', ink: '#18221c', muted: '#6b756f', line: '#dce4de', soft: '#f2f7f3', white: '#ffffff' }
const CJK_PATTERN = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u
const QUOTATION_PROMPT = '请核对以上价格与数量，如有差异请及时反馈。'

const COLUMN = {
  imageLeft: MARGIN + 16,
  textLeft: MARGIN + 96,
  textWidth: 552,
  quantityLeft: MARGIN + 700,
  quantityWidth: 80,
  referenceLeft: MARGIN + 820,
  actualLeft: MARGIN + 1040,
  amountLeft: MARGIN + 1260,
  priceWidth: 200,
} as const

function escapeMarkup(value: string): string {
  return value.replace(/\p{Cc}/gu, character => character === '\n' || character === '\t' ? character : '')
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;')
}

function flattenText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** 单行显示：按大致字宽截断，保证 100 行不会因为长名称/长备注把图片顶出媒体上限。 */
function truncateToWidth(value: string, maxWidth: number, fontSize: number): string {
  let width = 0
  let result = ''
  for (const character of value) {
    const characterWidth = CJK_PATTERN.test(character) ? fontSize : fontSize * 0.56
    if (width + characterWidth > maxWidth) return `${result}…`
    width += characterWidth
    result += character
  }
  return result
}

function money(value: string): string {
  const [integer, fraction = '0000'] = value.split('.')
  const decimals = fraction.replace(/0+$/u, '').padEnd(2, '0')
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${decimals}`
}

interface TextImage { readonly data: Buffer, readonly width: number, readonly height: number }

/**
 * 供应商核价单使用独立布局：白底、固定 sRGB 色、随服务端归档的中文字体。
 * 与正式采购单图片共用视觉语言，但不依赖订单、货件或唛头，可在采购第二步直接生成。
 */
export class PriceQuotationSheetRenderer {
  async render(snapshot: PriceQuotationSheetSnapshot, imageBytes: ReadonlyMap<string, Buffer> = new Map()): Promise<Buffer> {
    try {
      await access(FONT_FILE)
      process.env.FONTCONFIG_FILE ??= resolve(FONT_DIRECTORY, 'fonts.conf')
      if (snapshot.lines.length * MIN_ROW_HEIGHT + 900 > MAX_HEIGHT) this.tooLarge()
      const canvas = new PriceQuotationSheetCanvas()
      return await canvas.render(snapshot, imageBytes)
    }
    catch (error) {
      if (error instanceof PriceQuotationSheetImageError) throw error
      throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE')
    }
  }

  private tooLarge(): never { throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE') }
}

class PriceQuotationSheetCanvas {
  private y = MARGIN
  private readonly overlays: OverlayOptions[] = []
  private readonly shapes: string[] = []

  private async text(value: string, width: number, size = 24, color = COLORS.ink, bold = false): Promise<TextImage> {
    const result = await sharp({ text: {
      text: `<span foreground="${color}"${bold ? ' weight="600"' : ''}>${escapeMarkup(value || '—')}</span>`,
      font: `Noto Sans SC ${size}`, fontfile: FONT_FILE, width, wrap: 'word-char', spacing: 8, rgba: true,
    } }).png().toBuffer({ resolveWithObject: true })
    if (result.info.width > width || result.info.height > MAX_HEIGHT) throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    return { data: result.data, width: result.info.width, height: result.info.height }
  }

  private place(text: TextImage, left: number, top: number, rightWidth?: number): void {
    this.overlays.push({ input: text.data, left: Math.round(left + (rightWidth === undefined ? 0 : rightWidth - text.width)), top: Math.round(top) })
  }

  private advance(height: number): void {
    this.y += height
    if (this.y + MARGIN > MAX_HEIGHT) throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
  }

  private rect(x: number, y: number, width: number, height: number, fill: string, radius = 0): void {
    this.shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`)
  }

  private line(y = this.y): void { this.rect(MARGIN, y, CONTENT_WIDTH, 1, COLORS.line) }

  private async basicRow(left: string, right: string): Promise<void> {
    const [a, b] = await Promise.all([this.text(left, 714, 24), this.text(right, 714, 24)])
    this.place(a, MARGIN, this.y)
    this.place(b, MARGIN + 758, this.y)
    this.advance(Math.max(a.height, b.height) + 18)
  }

  async render(snapshot: PriceQuotationSheetSnapshot, imageBytes: ReadonlyMap<string, Buffer>): Promise<Buffer> {
    const [title, date] = await Promise.all([
      this.text('千树 · 采购核价单', 620, 46, COLORS.primary, true),
      this.text(`采购日期：${snapshot.orderDate}`, 620, 24, COLORS.ink),
    ])
    this.place(title, MARGIN, this.y)
    this.place(date, WIDTH - MARGIN - 620, this.y + 14, 620)
    this.advance(Math.max(title.height, date.height + 14) + 28)
    this.rect(MARGIN, this.y, CONTENT_WIDTH, 3, COLORS.primary)
    this.advance(24)
    await this.basicRow(`供应商：${flattenText(snapshot.supplierName)}`, `采购币种：${snapshot.currencyCode}`)

    const section = await this.text(`采购产品 · ${snapshot.lines.length} 项`, CONTENT_WIDTH - 24, 27, COLORS.ink, true)
    this.rect(MARGIN, this.y, 5, section.height, COLORS.primary, 2)
    this.place(section, MARGIN + 20, this.y)
    this.advance(section.height + 22)

    const columns = [
      { label: '产品 / 备注', left: COLUMN.textLeft, width: COLUMN.textWidth, right: false, color: COLORS.muted },
      { label: '数量', left: COLUMN.quantityLeft, width: COLUMN.quantityWidth, right: true, color: COLORS.muted },
      { label: '采购定价', left: COLUMN.referenceLeft, width: COLUMN.priceWidth, right: true, color: COLORS.primary },
      { label: '本单采购价', left: COLUMN.actualLeft, width: COLUMN.priceWidth, right: true, color: COLORS.destructive },
      { label: '小计', left: COLUMN.amountLeft, width: COLUMN.priceWidth, right: true, color: COLORS.muted },
    ] as const
    this.rect(MARGIN, this.y, CONTENT_WIDTH, 54, COLORS.soft)
    for (const column of columns) {
      const label = await this.text(column.label, column.width, 22, column.color)
      this.place(label, column.left, this.y + 14, column.right ? column.width : undefined)
    }
    this.advance(54)
    for (const line of snapshot.lines) await this.productRow(line, imageBytes)

    this.advance(20)
    const referenceTotal = await this.text(`采购定价总计：¥${money(snapshot.referenceTotalAmount)} ${snapshot.currencyCode}`, CONTENT_WIDTH, 30, COLORS.primary, true)
    this.place(referenceTotal, MARGIN, this.y, CONTENT_WIDTH)
    this.advance(referenceTotal.height + 10)
    const actualTotal = await this.text(`本单采购总价：¥${money(snapshot.actualTotalAmount)} ${snapshot.currencyCode}`, CONTENT_WIDTH, 30, COLORS.destructive, true)
    this.place(actualTotal, MARGIN, this.y, CONTENT_WIDTH)
    this.advance(actualTotal.height + 24)
    this.line()
    this.advance(20)
    await this.promptLine()

    const height = Math.max(900, Math.ceil(this.y + MARGIN))
    if (height > MAX_HEIGHT) throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="100%" height="100%" fill="white"/>${this.shapes.join('')}</svg>`)
    const content = await sharp(background).composite(this.overlays).flatten({ background: COLORS.white }).removeAlpha().png().toBuffer()
    const outputHeight = Math.max(PAGE_HEIGHT, Math.ceil(height * PAGE_WIDTH / WIDTH))
    const output = await sharp(content)
      .resize(PAGE_WIDTH, outputHeight, { fit: 'contain', position: 'north', background: COLORS.white })
      .withMetadata({ density: PAGE_DENSITY })
      .png({ compressionLevel: 9 }).toBuffer()
    if (BigInt(output.byteLength) > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) throw new PriceQuotationSheetImageError('PURCHASE_ORDER_IMAGE_TOO_LARGE')
    return output
  }

  /**
   * 尾部提示按内容宽度等比放大，尽量铺满整行；若估算后仍换行则逐级缩小，
   * 保证供应商看到的是一行醒目的红色提示，而不是被拆成两行。
   */
  private async promptLine(): Promise<void> {
    const baseSize = 30
    const measured = await this.text(QUOTATION_PROMPT, 10_000, baseSize, COLORS.destructive, true)
    const targetWidth = CONTENT_WIDTH - 8
    let size = Math.min(72, Math.max(baseSize, Math.floor(baseSize * targetWidth * 0.98 / measured.width)))
    let prompt = await this.text(QUOTATION_PROMPT, CONTENT_WIDTH, size, COLORS.destructive, true)
    while (prompt.height > size * 1.8 && size > baseSize) {
      size -= 2
      prompt = await this.text(QUOTATION_PROMPT, CONTENT_WIDTH, size, COLORS.destructive, true)
    }
    this.place(prompt, MARGIN, this.y)
    this.advance(prompt.height + 16)
  }

  private async productRow(line: PriceQuotationSheetSnapshot['lines'][number], imageBytes: ReadonlyMap<string, Buffer>): Promise<void> {
    const top = this.y + 16
    const name = await this.text(
      truncateToWidth(flattenText(line.productName), COLUMN.textWidth - 12, 24),
      COLUMN.textWidth, 24, COLORS.ink, true,
    )
    this.place(name, COLUMN.textLeft, top)
    const remarkValue = line.description === null
      ? '备注：-'
      : `备注：${truncateToWidth(flattenText(line.description), COLUMN.textWidth - 92, 20)}`
    const remark = await this.text(remarkValue, COLUMN.textWidth, 20, COLORS.muted)
    this.place(remark, COLUMN.textLeft, top + name.height + 6)

    this.rect(COLUMN.imageLeft, top, 64, 64, COLORS.soft, 8)
    const bytes = line.imageKey === null ? undefined : imageBytes.get(line.imageKey)
    if (bytes !== undefined) {
      try {
        const image = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).autoOrient()
          .resize(64, 64, { fit: 'contain', background: COLORS.white }).flatten({ background: COLORS.white }).png().toBuffer()
        this.overlays.push({ input: image, left: COLUMN.imageLeft, top })
      }
      catch { await this.placeholder(top) }
    }
    else {
      await this.placeholder(top)
    }

    const [quantity, referencePrice, actualPrice, amount] = await Promise.all([
      this.text(String(line.quantity), COLUMN.quantityWidth, 24),
      this.text(money(line.referenceUnitPrice), COLUMN.priceWidth, 24, COLORS.primary),
      this.text(money(line.actualUnitPrice), COLUMN.priceWidth, 24, COLORS.destructive, true),
      this.text(money(line.actualAmount), COLUMN.priceWidth, 24, COLORS.ink, true),
    ])
    this.place(quantity, COLUMN.quantityLeft, top + 4, COLUMN.quantityWidth)
    this.place(referencePrice, COLUMN.referenceLeft, top + 4, COLUMN.priceWidth)
    this.place(actualPrice, COLUMN.actualLeft, top + 4, COLUMN.priceWidth)
    this.place(amount, COLUMN.amountLeft, top + 4, COLUMN.priceWidth)

    const textHeight = name.height + 6 + remark.height
    this.advance(Math.max(MIN_ROW_HEIGHT, Math.max(64, textHeight) + 28))
    this.line()
  }

  private async placeholder(top: number): Promise<void> {
    const label = await this.text('无图', 64, 18, COLORS.muted)
    this.place(label, COLUMN.imageLeft + (64 - label.width) / 2, top + (64 - label.height) / 2)
  }
}
