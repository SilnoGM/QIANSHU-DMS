import { createHash } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'
import sharp from 'sharp'

import type { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import type { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { MEDIA_CONTENT_SIZE_LIMITS } from '../../media/media-validation'
import type { PurchaseOrderDocumentContentResponse } from '../documents/purchase-order-document.service'
import type { PurchaseOrderImageSnapshot } from './purchase-order-image-snapshot'

export function purchaseOrderImageStorageFailure(): never {
  throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'MEDIA_STORAGE_UNAVAILABLE', '采购单图片存储暂时不可用')
}

/** 产品主图只从权威快照的媒体关联读取；不接受 URL，避免服务器访问任意外部地址。 */
export async function readPurchaseOrderImageThumbnails(
  prisma: PrismaService,
  delivery: MediaContentDeliveryService,
  snapshot: PurchaseOrderImageSnapshot,
): Promise<ReadonlyMap<string, Buffer>> {
  const ids = [...new Set(snapshot.lines.flatMap(line => line.mainImageId === null ? [] : [line.mainImageId]))]
  if (ids.length === 0) return new Map()
  const rows = await prisma.productMedia.findMany({
    where: { id: { in: ids }, kind: 'IMAGE', detachedAt: null, mediaAsset: { status: 'READY', deletedAt: null } },
    select: { id: true, mediaAsset: { select: { objectKey: true, sizeBytes: true } } },
  })
  if (rows.length !== ids.length) return purchaseOrderImageStorageFailure()
  const result = new Map<string, Buffer>()
  // 按图读取并立即缩略，避免多产品订单同时保留所有原始大图。
  for (const row of rows) {
    const asset = row.mediaAsset
    if (asset.objectKey === null || asset.sizeBytes === null || asset.sizeBytes > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) return purchaseOrderImageStorageFailure()
    try {
      const stored = await delivery.open(requireMediaObjectKeyNamespace(asset.objectKey, 'assets'))
      const chunks: Buffer[] = []
      let size = 0n
      try {
        for await (const raw of stored.stream) {
          const chunk: unknown = raw
          if (!Buffer.isBuffer(chunk)) return purchaseOrderImageStorageFailure()
          size += BigInt(chunk.length)
          if (size > MEDIA_CONTENT_SIZE_LIMITS.IMAGE) return purchaseOrderImageStorageFailure()
          chunks.push(chunk)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes) return purchaseOrderImageStorageFailure()
      const thumbnail = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate().resize(160, 160, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
      result.set(row.id, thumbnail)
    }
    catch {
      return purchaseOrderImageStorageFailure()
    }
  }
  return result
}

export interface PurchaseOrderImageContentAsset {
  readonly objectKey: string | null
  readonly checksumSha256: string | null
  readonly sizeBytes: bigint | null
}

/** 草稿和正式凭证复用同一文件；此处只负责私有内容交付，不重画单据。 */
export async function deliverPurchaseOrderImage(
  delivery: MediaContentDeliveryService,
  asset: PurchaseOrderImageContentAsset,
  draftId: string,
  ifNoneMatch: unknown,
  method: 'GET' | 'HEAD',
): Promise<PurchaseOrderDocumentContentResponse> {
  if (asset.objectKey === null || asset.checksumSha256 === null) return purchaseOrderImageStorageFailure()
  const objectKey = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
  const etag = `"sha256-${createHash('sha256').update(`purchase-order-image:${asset.checksumSha256}`).digest('base64url')}"`
  const headers: Record<string, string> = {
    'Accept-Ranges': 'none',
    'Content-Disposition': `inline; filename="purchase-order-${draftId}.png"`,
    'Content-Type': 'image/png',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  }
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)) return { status: HttpStatus.NOT_MODIFIED, headers }
  try {
    const stat = await delivery.stat(objectKey)
    if (stat === null || (asset.sizeBytes !== null && stat.sizeBytes !== asset.sizeBytes)) return purchaseOrderImageStorageFailure()
    headers['Content-Length'] = stat.sizeBytes.toString()
    if (delivery.mode === 'internal_redirect') {
      headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${objectKey.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
      return { status: HttpStatus.OK, headers }
    }
    if (method === 'HEAD') return { status: HttpStatus.OK, headers }
    const stored = await delivery.open(objectKey)
    return { status: HttpStatus.OK, headers, stream: stored.stream }
  }
  catch {
    return purchaseOrderImageStorageFailure()
  }
}
