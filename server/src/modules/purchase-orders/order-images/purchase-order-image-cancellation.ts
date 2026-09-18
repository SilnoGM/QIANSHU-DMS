import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'

import { HttpStatus } from '@nestjs/common'
import sharp, { type OverlayOptions } from 'sharp'

import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { MEDIA_CONTENT_SIZE_LIMITS } from '../../media/media-validation'
import type { PurchaseOrderDocumentContentResponse } from '../documents/purchase-order-document.service'
import { purchaseOrderImageStorageFailure, type PurchaseOrderImageContentAsset } from './purchase-order-image-assets'

const FONT_DIRECTORY = resolve(__dirname, '../../../../deploy/fonts/noto-sans-sc')
const FONT_FILE = resolve(FONT_DIRECTORY, 'NotoSansSC.ttf')
const FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as const
// 改动印章样式时递增版本，避免旧 ETag 命中新图片。颜色采用单据既有 destructive 色。
const STAMP_VERSION = '1'
const STAMP_COLOR = '#e7000b'

async function stampImage(bytes: Buffer, format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  await access(FONT_FILE)
  process.env.FONTCONFIG_FILE ??= resolve(FONT_DIRECTORY, 'fonts.conf')
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384 || (metadata.pages ?? 1) !== 1) return purchaseOrderImageStorageFailure()
  const original = await image.autoOrient().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = original.info
  const label = await sharp({ text: {
    text: `<span foreground="${STAMP_COLOR}" weight="700">已作废</span>`,
    font: 'Noto Sans SC 148', fontfile: FONT_FILE, rgba: true,
  } }).png().toBuffer({ resolveWithObject: true })
  const border = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="250"><rect x="8" y="8" width="624" height="234" rx="14" fill="none" stroke="${STAMP_COLOR}" stroke-width="9"/></svg>`)
  const stamp = await sharp(border).composite([{
    input: label.data, left: Math.round((640 - label.info.width) / 2), top: Math.round((250 - label.info.height) / 2),
  }]).png().toBuffer()
  const rotated = await sharp(stamp).rotate(-12, { background: '#00000000' }).ensureAlpha()
    .linear([1, 1, 1, 0.72], [0, 0, 0, 0]).png().toBuffer()
  const overlays: OverlayOptions[] = []
  // 历史上传图片可能极窄；设置分段下限，避免异常长宽比产生数千次图片合成。
  const pageHeight = Math.max(1024, Math.round(width * 297 / 210))
  // 长图每个 A4 高度重复一次，尾段也完整显示印章。只覆盖半透明标记，不重排、裁剪采购内容。
  for (let pageTop = 0; pageTop < height; pageTop += pageHeight) {
    const sectionHeight = Math.min(pageHeight, height - pageTop)
    const mark = await sharp(rotated).resize(Math.max(1, Math.round(width * 0.45)), Math.max(1, Math.round(sectionHeight * 0.8)), { fit: 'inside' }).png().toBuffer({ resolveWithObject: true })
    const left = Math.max(0, width - mark.info.width - Math.round(width * 0.05))
    const top = pageTop + Math.max(0, Math.min(Math.round(width * 0.18), sectionHeight - mark.info.height - Math.round(sectionHeight * 0.05)))
    overlays.push({ input: mark.data, left, top })
  }
  let result = sharp(original.data, { raw: original.info }).composite(overlays)
  if (!metadata.hasAlpha) result = result.removeAlpha()
  if (metadata.density) result = result.withMetadata({ density: metadata.density })
  return result.toFormat(format).toBuffer()
}

/**
 * 作废状态来自同一次凭证关联查询。读取时生成带印章的副本，原文件及归档引用保持不变。
 * 生产 internal_redirect 同样由应用返回新字节，不能重定向到未盖章原件；盖章失败则明确报错。
 */
export async function deliverCancelledPurchaseOrderImage(
  delivery: MediaContentDeliveryService,
  asset: PurchaseOrderImageContentAsset,
  imageId: string,
  ifNoneMatch: unknown,
  method: 'GET' | 'HEAD',
  mimeType = 'image/png',
): Promise<PurchaseOrderDocumentContentResponse> {
  const format = FORMATS[mimeType as keyof typeof FORMATS]
  if (!format || !asset.objectKey || !asset.checksumSha256 || asset.sizeBytes === null || asset.sizeBytes <= 0n || asset.sizeBytes > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) return purchaseOrderImageStorageFailure()
  const etag = `"sha256-${createHash('sha256').update(`purchase-order-cancelled-image:${STAMP_VERSION}:${mimeType}:${asset.checksumSha256}`).digest('base64url')}"`
  const headers: Record<string, string> = {
    'Accept-Ranges': 'none',
    'Content-Disposition': `inline; filename="purchase-order-${imageId}-cancelled.${format === 'jpeg' ? 'jpg' : format}"`,
    'Content-Type': mimeType,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  }
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)) return { status: HttpStatus.NOT_MODIFIED, headers }
  try {
    const objectKey = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
    const stat = await delivery.stat(objectKey)
    if (stat === null || stat.sizeBytes !== asset.sizeBytes) return purchaseOrderImageStorageFailure()
    const stored = await delivery.open(objectKey)
    const chunks: Buffer[] = []
    let size = 0n
    try {
      for await (const raw of stored.stream) {
        const chunk: unknown = raw
        if (!Buffer.isBuffer(chunk)) return purchaseOrderImageStorageFailure()
        size += BigInt(chunk.length)
        if (size > asset.sizeBytes) return purchaseOrderImageStorageFailure()
        chunks.push(chunk)
      }
    }
    finally { stored.stream.destroy() }
    if (size !== asset.sizeBytes) return purchaseOrderImageStorageFailure()
    const content = await stampImage(Buffer.concat(chunks), format)
    headers['Content-Length'] = String(content.length)
    return { status: HttpStatus.OK, headers, ...(method === 'GET' ? { stream: Readable.from(content) } : {}) }
  }
  catch { return purchaseOrderImageStorageFailure() }
}
