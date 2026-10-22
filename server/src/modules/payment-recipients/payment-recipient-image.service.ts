import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AccessControlService } from '../access-control/access-control.service'
import { MediaAssetService, MediaAssetLifecycleError } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { SalesOrderDocumentMultipartParser, type SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import type { PaymentRecipientImageUploadDto } from './payment-recipient.dto'
import { recipientFailure } from './payment-recipient.normalizer'

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 收款码上传入口同时服务收款资料维护、采购发起和打木架提报三条业务链。 */
export const PAYMENT_RECIPIENT_IMAGE_UPLOAD_PERMISSIONS = Object.freeze([
  'supplier-payment-profiles:update',
  'purchase-orders:create',
  'packaging-costs:create',
] as const)

export interface PaymentRecipientImageContent { status: number, headers: Record<string, string>, stream?: Readable }
@Injectable()
export class PaymentRecipientImageService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()
  constructor(private readonly prisma: PrismaService, private readonly media: MediaAssetService, private readonly delivery: MediaContentDeliveryService, private readonly access: AccessControlService) {}
  private async permissions(actorUserId: string): Promise<readonly string[]> {
    const [actor, permissions] = await Promise.all([this.prisma.user.findUnique({ where: { id: actorUserId }, select: { status: true } }), this.access.getPermissionCodes(actorUserId)])
    if (actor?.status !== 'ACTIVE') return recipientFailure('FORBIDDEN', '权限不足', 403)
    return permissions
  }
  async upload(actorUserId: string, request: SalesOrderDocumentMultipartRequest): Promise<PaymentRecipientImageUploadDto> {
    const permissions = await this.permissions(actorUserId)
    // 路由层已用 RequireAnyPermissions 声明同一组权限；服务层保留防御性检查，避免直接调用时绕过。
    if (!this.access.hasAny(permissions, PAYMENT_RECIPIENT_IMAGE_UPLOAD_PERMISSIONS)) return recipientFailure('FORBIDDEN', '权限不足', 403)
    try {
      return await this.multipart.parse(request, async input => {
        if (input.mediaType !== 'IMAGE' || !MIME_TYPES.includes(input.declaredMimeType ?? '')) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_INVALID', '仅支持 JPEG、PNG、WebP 收款码图片')
        const asset = await this.media.prepare({ actorUserId, requestedType: 'IMAGE', allowedTypes: ['IMAGE'], declaredMimeType: input.declaredMimeType, originalFilename: input.originalFilename, pool: 'payment-recipient', stream: input.stream })
        // prepare 保持 UPLOADING；标记失败也不会产生 READY 孤儿，过期清理仍可回收。
        const marked = await this.prisma.mediaAsset.updateMany({ where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null }, data: { uploadPurpose: 'PAYMENT_RECIPIENT_QR' } })
        if (marked.count !== 1) return recipientFailure('PAYMENT_RECIPIENT_IMAGE_UNAVAILABLE', '收款码上传状态已变化，请重新上传')
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalFilename: true } })
        return { mediaAssetId: asset.id, mediaType: 'IMAGE', mimeType: asset.trustedMetadata.mimeType, sizeBytes: asset.trustedMetadata.sizeBytes.toString(), originalFilename: row.originalFilename }
      })
    } catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') return recipientFailure('PAYMENT_RECIPIENT_IMAGE_TOO_LARGE', '每张收款码不得超过 10 MiB')
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) return recipientFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503)
        return recipientFailure('PAYMENT_RECIPIENT_IMAGE_INVALID', '图片内容无效，请重新选择')
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') return recipientFailure('PAYMENT_RECIPIENT_IMAGE_TOO_LARGE', '每张收款码不得超过 10 MiB')
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') return recipientFailure('PAYMENT_RECIPIENT_IMAGE_INVALID', '每次只能上传一张完整的收款码图片')
        throw error
      }
      return recipientFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503)
    }
  }
  async content(actorUserId: string, id: string, ifNoneMatch: unknown, method: 'GET' | 'HEAD'): Promise<PaymentRecipientImageContent> {
    const permissions = await this.permissions(actorUserId)
    const can = (code: string) => permissions.includes(code)
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id }, include: {
      paymentRecipientAccounts: { include: { profile: { select: { supplierValue: true, purchaseOrderId: true, packagingVendor: true, packagingRequestId: true, createdByUserId: true } } } },
      paymentRecipientSnapshots: { select: { id: true } },
      packagingRecipientSnapshots: { select: { id: true } },
    } })
    const missing = () => recipientFailure('PAYMENT_RECIPIENT_IMAGE_NOT_FOUND', '收款码不存在或当前不可访问', 404)
    if (!asset || asset.deletedAt || asset.uploadPurpose !== 'PAYMENT_RECIPIENT_QR' || asset.mediaType !== 'IMAGE' || !MIME_TYPES.includes(asset.mimeType ?? '') || !asset.objectKey || !asset.checksumSha256 || !asset.mimeType) return missing()
    if (asset.status === 'UPLOADING') {
      if (asset.createdByUserId !== actorUserId || !asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date() || (!can('supplier-payment-profiles:update') && !can('purchase-orders:create') && !can('packaging-costs:create'))) return missing()
    } else if (asset.status === 'READY') {
      const profile = asset.paymentRecipientAccounts
      const canReadProfile = can('supplier-payment-profiles:read') && profile.some(row => row.profile.supplierValue != null || row.profile.packagingVendor != null)
      let canReadOrder = profile.some(row => row.profile.purchaseOrderId != null && (can('purchase-orders:read') || can('purchase-orders:review') || (can('purchase-orders:create') && row.profile.createdByUserId === actorUserId)))
      const supplierValues = profile.flatMap(row => row.profile.supplierValue ? [row.profile.supplierValue] : [])
      // 商品采购使用供应商 profile；读取/审核权限只放行实际采购单引用过的供应商二维码。
      if (!canReadOrder && supplierValues.length && (can('purchase-orders:read') || can('purchase-orders:review'))) {
        canReadOrder = await this.prisma.purchaseOrder.findFirst({ where: { supplierValue: { in: supplierValues } }, select: { id: true } }) !== null
      }
      const canReadPayment = can('purchase-orders:payment') && (profile.some(row => row.profile.supplierValue != null || row.profile.purchaseOrderId != null) || asset.paymentRecipientSnapshots.length > 0)
      const canReadPackaging = (can('packaging-costs:create') && profile.some(row => row.profile.packagingVendor === 'CHENGXIN' || (row.profile.packagingRequestId != null && row.profile.createdByUserId === actorUserId)))
        || (can('packaging-costs:read') && (profile.some(row => row.profile.packagingVendor != null || row.profile.packagingRequestId != null) || asset.packagingRecipientSnapshots.length > 0))
      const canReadHistory = can('purchase-orders:read') && asset.paymentRecipientSnapshots.length > 0
      if (!canReadProfile && !canReadOrder && !canReadPayment && !canReadHistory && !canReadPackaging) return missing()
    } else return missing()
    const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
    const etag = `"sha256-${createHash('sha256').update(`payment-recipient:${asset.checksumSha256}`).digest('base64url')}"`
    const filename = asset.originalFilename.split(/[\\/]/u).at(-1)?.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'receipt-code'
    const headers: Record<string, string> = { 'Accept-Ranges': 'none', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Type': asset.mimeType, ETag: etag, 'X-Content-Type-Options': 'nosniff' }
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)) return { status: 304, headers }
    try {
      const stat = await this.delivery.stat(key)
      if (!stat) throw new Error('Missing recipient image')
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { status: 200, headers }
      }
      return method === 'HEAD' ? { status: 200, headers } : { status: 200, headers, stream: (await this.delivery.open(key)).stream }
    } catch { return recipientFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503) }
  }
}
