import type { ImageGroupItem } from '../../../components/base/ImageGroup/types'
import { mediaThumbnailUrl } from '../../../utils/media-variant'

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
