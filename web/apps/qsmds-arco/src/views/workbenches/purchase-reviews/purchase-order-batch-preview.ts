/** 批量弹窗最多 20 张 A4 图片；缩到 1080px 既保留可读性，也避免同时解码原始 2100px 图。 */
export const PURCHASE_ORDER_BATCH_PREVIEW_WIDTH = 1080

/**
 * 生成批量审核用的图片预览 URL。原始 PNG 解码一次后立即缩成 1080px WebP，
 * 只保留缩略图对象 URL；浏览器不支持或转换失败时退回完整 Blob。
 */
export async function createPurchaseOrderBatchPreviewUrl(blob: Blob): Promise<string> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return URL.createObjectURL(blob)
  }

  try {
    const bitmap = await createImageBitmap(blob)
    const width = Math.min(PURCHASE_ORDER_BATCH_PREVIEW_WIDTH, bitmap.width)
    const height = Math.max(1, Math.round(bitmap.height * width / bitmap.width))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) {
      bitmap.close()
      return URL.createObjectURL(blob)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const thumbnail = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.9)
    })
    return URL.createObjectURL(thumbnail ?? blob)
  }
  catch {
    return URL.createObjectURL(blob)
  }
}
