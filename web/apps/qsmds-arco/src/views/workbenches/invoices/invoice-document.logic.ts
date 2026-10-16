import type { ImageGroupItem } from '../../../components/base/ImageGroup/types'
import { mediaThumbnailUrl } from '../../../utils/media-variant'

/**
 * 发票照片上传到云端时的文件名：抬头-统编-YYYYMMDDHHMMSS（本地时间，取上传时刻）。
 * 展示（暂存卡片）与实际上传共用这一个函数，避免屏幕上看到的名称与云端存的对不上。
 */
export function buildInvoiceDocumentFilename(input: {
  readonly buyerName: string
  readonly buyerTaxId: string
  readonly uploadedAt: Date
  readonly originalName: string
  readonly mimeType?: string
}): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = [
    input.uploadedAt.getFullYear(),
    pad(input.uploadedAt.getMonth() + 1),
    pad(input.uploadedAt.getDate()),
    pad(input.uploadedAt.getHours()),
    pad(input.uploadedAt.getMinutes()),
    pad(input.uploadedAt.getSeconds()),
  ].join('')
  const stem = [input.buyerName, input.buyerTaxId, stamp].join('-')
  return stem + resolveExtension(input.originalName, input.mimeType)
}

/** 扩展名取原文件名里的那个（统一小写），缺失或形状可疑时按声明的 MIME 兜底。 */
function resolveExtension(originalName: string, mimeType?: string): string {
  const tail = originalName.match(/\.([A-Za-z0-9]{1,8})$/u)
  if (tail !== null && tail[1] !== undefined) {
    return `.${tail[1].toLowerCase()}`
  }
  if (mimeType === 'image/png') {
    return '.png'
  }
  if (mimeType === 'image/webp') {
    return '.webp'
  }
  return '.jpg'
}

export function formatInvoiceDocumentFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—'
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 开票列表的「发票照片」列：列表位置用缩略变体（webp，长期私有缓存），
 * 点击预览走原件；两者都是同源的受保护内容路径，读取权限由服务端判定。
 */
export function resolveInvoiceDocumentContentUrl(requestId: string): string {
  return `/api/invoice-requests/${encodeURIComponent(requestId)}/document`
}

export function buildInvoiceDocumentItems(
  row: { readonly id: string, readonly documentMediaAssetId?: string | null | undefined },
  label: string,
): ImageGroupItem[] {
  if (row.documentMediaAssetId === null || row.documentMediaAssetId === undefined) {
    return []
  }
  const contentUrl = resolveInvoiceDocumentContentUrl(row.id)
  const src = mediaThumbnailUrl(contentUrl)
  if (src === undefined) {
    return []
  }
  return [{ alt: label, key: row.id, previewSrc: contentUrl, src, tooltip: label }]
}
