import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { SalesOrderDocumentMultipartParser, type SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { PackagingCostImageKindDto, type PackagingCostImageUploadDto } from './packaging-cost.dto'
import { packagingCostFailure, type PackagingCostContext } from './packaging-cost.normalizer'

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export interface PackagingCostImageContent { status: number, headers: Record<string, string>, stream?: Readable }
@Injectable()
export class PackagingCostImageService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()
  constructor(private readonly prisma: PrismaService, private readonly media: MediaAssetService, private readonly delivery: MediaContentDeliveryService) {}
  async upload(context: PackagingCostContext, request: SalesOrderDocumentMultipartRequest): Promise<PackagingCostImageUploadDto> {
    try {
      // 共用已有单文件流式解析器；完整 framing 确认后才会激活准备流程的 EOF。
      return await this.multipart.parse(request, async input => {
        if (input.mediaType !== 'IMAGE' || !MIME_TYPES.includes(input.declaredMimeType ?? '')) return packagingCostFailure('PACKAGING_COST_IMAGE_INVALID', '仅支持 JPEG、PNG、WebP 图片')
        const asset = await this.media.prepare({ actorUserId: context.actorUserId, allowedTypes: ['IMAGE'], requestedType: 'IMAGE', declaredMimeType: input.declaredMimeType, originalFilename: input.originalFilename, stream: input.stream })
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalFilename: true } })
        return { mediaAssetId: asset.id, mediaType: 'IMAGE', mimeType: asset.trustedMetadata.mimeType, sizeBytes: asset.trustedMetadata.sizeBytes.toString(), originalFilename: row.originalFilename }
      })
    } catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') return packagingCostFailure('PACKAGING_COST_IMAGE_TOO_LARGE', '每张截图不得超过10 MiB')
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) return packagingCostFailure('MEDIA_STORAGE_UNAVAILABLE', '截图存储暂时不可用', 503)
        return packagingCostFailure('PACKAGING_COST_IMAGE_INVALID', '截图文件无效，请重新选择')
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') return packagingCostFailure('PACKAGING_COST_IMAGE_TOO_LARGE', '每张截图不得超过10 MiB')
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') return packagingCostFailure('PACKAGING_COST_IMAGE_INVALID', '每次只能上传一张截图')
        throw error
      }
      return packagingCostFailure('MEDIA_STORAGE_UNAVAILABLE', '截图存储暂时不可用', 503)
    }
  }
  async content(id: string, kind: PackagingCostImageKindDto, ifNoneMatch: unknown, method: 'GET' | 'HEAD'): Promise<PackagingCostImageContent> {
    const row = await this.prisma.packagingCostRequest.findUnique({ where: { id }, include: { packagingImage: true, quotationImage: true } })
    const asset = kind === PackagingCostImageKindDto.PACKAGING ? row?.packagingImage : row?.quotationImage
    if (!asset || asset.status !== 'READY' || asset.deletedAt || !asset.objectKey || !asset.checksumSha256 || !asset.mimeType || !MIME_TYPES.includes(asset.mimeType)) return packagingCostFailure('PACKAGING_COST_IMAGE_NOT_FOUND', '截图凭证不存在', 404)
    const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
    const etag = `"sha256-${createHash('sha256').update(`packaging-cost:${asset.checksumSha256}`).digest('base64url')}"`
    const filename = asset.originalFilename.split(/[\\/]/u).at(-1)?.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'image'
    const headers: Record<string, string> = { 'Accept-Ranges': 'none', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Type': asset.mimeType, ETag: etag, 'X-Content-Type-Options': 'nosniff' }
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)) return { status: 304, headers }
    try {
      const stat = await this.delivery.stat(key)
      if (!stat) throw new Error('Missing media object')
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { status: 200, headers }
      }
      if (method === 'HEAD') return { status: 200, headers }
      return { status: 200, headers, stream: (await this.delivery.open(key)).stream }
    } catch { return packagingCostFailure('MEDIA_STORAGE_UNAVAILABLE', '截图存储暂时不可用', 503) }
  }
}
