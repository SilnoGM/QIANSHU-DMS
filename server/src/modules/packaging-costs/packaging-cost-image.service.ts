import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { SalesOrderDocumentMultipartParser, type SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { packagingCostScopeWhere } from './packaging-cost-access'
import { PackagingCostImageKindDto, type PackagingCostImageUploadDto } from './packaging-cost.dto'
import { packagingCostFailure, type PackagingCostContext } from './packaging-cost.normalizer'

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export interface PackagingCostImageContent { status: number, headers: Record<string, string>, stream?: Readable }
@Injectable()
export class PackagingCostImageService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()
  constructor(private readonly prisma: PrismaService, private readonly media: MediaAssetService, private readonly delivery: MediaContentDeliveryService, private readonly dataScope: DataScopeService = dataScopeFallback()) {}
  async upload(context: PackagingCostContext, request: SalesOrderDocumentMultipartRequest, packagingCostId?: string): Promise<PackagingCostImageUploadDto> {
    if (packagingCostId) {
      // 付款凭证只能追加到当前用户可见的提报；SELF 按费用归属人校验，ALL 保持财务代付。
      const scope = await this.dataScope.resolve(context.actorUserId)
      const row = await this.prisma.packagingCostRequest.findFirst({ where: { id: packagingCostId, ...packagingCostScopeWhere(scope, context.actorUserId) }, select: { status: true } })
      if (!row) return packagingCostFailure('PACKAGING_COST_NOT_FOUND', '打木架提报不存在', 404)
      if (row.status !== 'PENDING_PAYMENT') return packagingCostFailure('PACKAGING_COST_STATE_CHANGED', '提报已付款，请刷新', 409)
    }
    try {
      // 共用已有单文件流式解析器；完整 framing 确认后才会激活准备流程的 EOF。
      return await this.multipart.parse(request, async input => {
        if (input.mediaType !== 'IMAGE' || !MIME_TYPES.includes(input.declaredMimeType ?? '')) return packagingCostFailure('PACKAGING_COST_IMAGE_INVALID', '仅支持 JPEG、PNG、WebP 图片')
        // 同一个上传器承载提报证据与付款截图：带提报 ID 的入口是资金凭证，其余是提报证据。
        const asset = await this.media.prepare({ actorUserId: context.actorUserId, allowedTypes: ['IMAGE'], requestedType: 'IMAGE', declaredMimeType: input.declaredMimeType, originalFilename: input.originalFilename, pool: packagingCostId ? 'voucher' : 'packaging', stream: input.stream })
        // 付款凭证限定当前提报和上传者，不能挪用普通包装截图或其他提报的附件。
        if (packagingCostId) {
          const marked = await this.prisma.mediaAsset.updateMany({ where: { id: asset.id, status: 'UPLOADING', createdByUserId: context.actorUserId, uploadPurpose: null }, data: { uploadPurpose: 'PACKAGING_PAYMENT_VOUCHER', packagingCostUploadId: packagingCostId } })
          if (marked.count !== 1) return packagingCostFailure('PACKAGING_COST_IMAGE_UNAVAILABLE', '付款截图上传状态已变化，请重新上传')
        }
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
  async content(id: string, kind: PackagingCostImageKindDto, ifNoneMatch: unknown, method: 'GET' | 'HEAD', actorUserId: string = resolveDataScopeActor()): Promise<PackagingCostImageContent> {
    // 图片内容沿用提报详情的数据范围：SELF 下他人提报与不存在的图片都返回 404。
    const scope = await this.dataScope.resolve(actorUserId)
    const row = await this.prisma.packagingCostRequest.findFirst({ where: { id, ...packagingCostScopeWhere(scope, actorUserId) }, include: { packagingImage: true, quotationImage: true, paymentVoucher: true } })
    const asset = kind === PackagingCostImageKindDto.PACKAGING ? row?.packagingImage : kind === PackagingCostImageKindDto.PAYMENT ? row?.paymentVoucher : row?.quotationImage
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
