import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { AuditService } from '../../audit/audit.service'
import {
  MediaAssetLifecycleError,
  MediaAssetService,
} from '../../media/media-asset.service'
import { MediaAssetRetentionService } from '../../media/media-retention.service'
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import { purchaseOrderRuleFailure, purchaseOrderValidationFailure } from '../domain/purchase-order-errors'
import { isCanonicalPurchaseOrderActorId } from '../purchase-order-command.normalizer'
import type { PurchaseOrderMutationContext } from '../purchase-order-mutation.service'
import {
  PurchaseOrderQueryService,
  type PurchaseOrderDetail,
} from '../purchase-order-query.service'
import {
  PurchaseOrderDocumentMultipartParser,
  type PurchaseOrderDocumentMultipartRequest,
} from './purchase-order-document-multipart.parser'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface PurchaseOrderTemporaryDocument {
  readonly mediaAssetId: string
  readonly mediaType: 'IMAGE' | 'DOCUMENT'
  readonly mimeType: string
  readonly sizeBytes: string
  readonly originalFilename: string
}

export interface PurchaseOrderDocumentContentResponse {
  readonly status: HttpStatus.NOT_MODIFIED | HttpStatus.OK
  readonly headers: Record<string, string>
  readonly stream?: Readable
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return purchaseOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

function requireContext(context: PurchaseOrderMutationContext): void {
  if (
    !isCanonicalPurchaseOrderActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length < 1
    || [...context.requestId].length > 64
  ) {
    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      '服务器内部错误',
    )
  }
}

function mapUploadError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof MediaAssetLifecycleError) {
    const code = error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE'
      ? 'PURCHASE_ORDER_DOCUMENT_CONTENT_TOO_LARGE'
      : error.code === 'MEDIA_ASSET_CONTENT_UNSUPPORTED'
        || error.code === 'MEDIA_ASSET_TYPE_NOT_ALLOWED'
        ? 'PURCHASE_ORDER_DOCUMENT_CONTENT_UNSUPPORTED'
        : 'PURCHASE_ORDER_DOCUMENT_CONTENT_INVALID'
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      code,
      '采购订单凭证文件无效',
    )
  }
  throw new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'MEDIA_STORAGE_UNAVAILABLE',
    '媒体存储暂时不可用',
  )
}

function contentDisposition(filename: string): string {
  const safe = filename
    .split(/[\\/]/u)
    .at(-1)
    ?.normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180) || 'document'
  return `inline; filename="${safe}"`
}

@Injectable()
export class PurchaseOrderDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAsset: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly audit: AuditService,
    private readonly query: PurchaseOrderQueryService,
    private readonly multipart: PurchaseOrderDocumentMultipartParser,
    private readonly retention: MediaAssetRetentionService,
  ) {}

  uploadTemporary(
    context: PurchaseOrderMutationContext,
    request: PurchaseOrderDocumentMultipartRequest,
    paymentUpload?: { purpose: 'PURCHASE_PAYMENT_VOUCHER', payableId: string },
  ): Promise<PurchaseOrderTemporaryDocument> {
    requireContext(context)
    return this.multipart.parse(request, async input => {
      try {
        const prepared = await this.mediaAsset.prepare({
          actorUserId: context.actorUserId,
          allowedTypes: paymentUpload ? ['IMAGE'] : ['IMAGE', 'DOCUMENT'],
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          requestedType: input.mediaType,
          stream: input.stream,
        })
        if (paymentUpload) {
          const marked = await this.prisma.mediaAsset.updateMany({
            where: { id: prepared.id, status: 'UPLOADING', createdByUserId: context.actorUserId, uploadPurpose: null, purchasePayableUploadId: null },
            data: { uploadPurpose: paymentUpload.purpose, purchasePayableUploadId: paymentUpload.payableId },
          })
          if (marked.count !== 1) return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '付款截图状态已变化，请重新上传')
        }
        return {
          mediaAssetId: prepared.id,
          mediaType: prepared.mediaType as 'IMAGE' | 'DOCUMENT',
          mimeType: prepared.trustedMetadata.mimeType,
          sizeBytes: prepared.trustedMetadata.sizeBytes.toString(),
          originalFilename: input.originalFilename,
        }
      }
      catch (error) {
        return mapUploadError(error)
      }
    })
  }

  /** 独立凭证只归档；不复用销售签收的状态推进，避免附件写入改变采购履约事实。 */
  async attach(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    input: unknown,
  ): Promise<PurchaseOrderDetail> {
    requireContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return purchaseOrderValidationFailure('body')
    }
    const body = input as Record<string, unknown>
    if (Object.keys(body).some(key => !['documentType', 'mediaAssetId', 'remark'].includes(key))) {
      return purchaseOrderValidationFailure('body')
    }
    const documentType = body.documentType
    if (documentType !== 'ORDER_ISSUANCE_VOUCHER' && documentType !== 'DELIVERY_RECEIPT') {
      return purchaseOrderValidationFailure('documentType')
    }
    const mediaAssetId = requireUuid(body.mediaAssetId, 'mediaAssetId')
    if (body.remark != null && (typeof body.remark !== 'string' || [...body.remark].length > 500)) {
      return purchaseOrderValidationFailure('remark')
    }
    const remark = typeof body.remark === 'string' ? body.remark.trim() || null : null
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "purchase_orders"
          WHERE "id" = CAST(${purchaseOrderId} AS uuid) FOR UPDATE
        `)
        if (locks.length !== 1) {
          throw new ApiException(HttpStatus.NOT_FOUND, 'PURCHASE_ORDER_NOT_FOUND', '采购订单不存在')
        }
        // 订单行锁串行化同单归档请求，部分唯一索引再防守绕过服务的并发写入。
        if (documentType === 'ORDER_ISSUANCE_VOUCHER') {
          const existing = await transaction.purchaseOrderDocument.findFirst({
            where: { purchaseOrderId, documentType, detachedAt: null }, select: { id: true },
          })
          if (existing !== null) {
            return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS', '该采购订单已有有效采购单凭证')
          }
        }
        const asset = await transaction.mediaAsset.findFirst({
          where: {
            id: mediaAssetId, createdByUserId: context.actorUserId, status: 'UPLOADING',
            mediaType: { in: ['IMAGE', 'DOCUMENT'] }, deletedAt: null, objectKey: { not: null },
          },
          select: { id: true },
        })
        if (asset === null) {
          return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '所选订单凭证当前不可用')
        }
        await this.mediaAsset.activate(transaction, mediaAssetId)
        const document = await transaction.purchaseOrderDocument.create({
          data: {
            purchaseOrderId, mediaAssetId, paymentId: null, documentType, remark,
            title: documentType === 'ORDER_ISSUANCE_VOUCHER' ? '采购单' : '签收单',
            createdByUserId: context.actorUserId,
          },
          select: { id: true },
        })
        await transaction.purchaseOrder.update({
          where: { id: purchaseOrderId }, data: { version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PURCHASE_ORDER_DOCUMENT_ATTACHED,
          outcome: AuditOutcome.SUCCESS, actorType: AuditActorType.USER,
          actorUserId: context.actorUserId, targetType: 'PURCHASE_ORDER_DOCUMENT',
          targetId: document.id, requestId: context.requestId,
          metadata: { purchaseOrderId, documentType },
        })
      })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '所选订单凭证当前不可用')
      }
      throw error
    }
    return this.query.getById(purchaseOrderId)
  }

  async detach(
    context: PurchaseOrderMutationContext,
    rawPurchaseOrderId: unknown,
    rawDocumentId: unknown,
  ): Promise<PurchaseOrderDetail> {
    requireContext(context)
    const purchaseOrderId = requireUuid(rawPurchaseOrderId, 'purchaseOrderId')
    const documentId = requireUuid(rawDocumentId, 'documentId')
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "purchase_orders"
        WHERE "id" = CAST(${purchaseOrderId} AS uuid)
        FOR UPDATE
      `)
      if (locks.length !== 1) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'PURCHASE_ORDER_NOT_FOUND',
          '采购订单不存在',
        )
      }
      const document = await transaction.purchaseOrderDocument.findFirst({
        where: { id: documentId, purchaseOrderId, detachedAt: null },
        select: { id: true, documentType: true, mediaAssetId: true, paymentId: true },
      })
      if (document === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'PURCHASE_ORDER_DOCUMENT_NOT_FOUND',
          '采购订单凭证不存在',
        )
      }
      if (document.documentType === 'PAYMENT_VOUCHER' && document.paymentId) {
        return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '付款凭证须随付款记录保留，不能单独移除')
      }
      // 普通凭证解除只隐藏附件，不改写采购业务事实。
      await transaction.purchaseOrderDocument.update({
        where: { id: documentId },
        data: {
          detachedAt: new Date(),
          detachedByUserId: context.actorUserId,
        },
      })
      // 解除正式凭证后，已归档草稿不再充当有效媒体引用；同事务标记回收，
      // 保留磁盘原文件直到保留期届满，避免事务回滚却丢失凭证内容。
      const retained = await this.retention.markUnreferencedForTrash(transaction, document.mediaAssetId)
      if (retained !== 'TRASHED' && retained !== 'ACTIVE_REFERENCE') {
        return purchaseOrderRuleFailure('PURCHASE_ORDER_DOCUMENT_UNAVAILABLE', '采购订单凭证状态已变更，请刷新后重试')
      }
      await transaction.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { version: { increment: 1 } },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PURCHASE_ORDER_DOCUMENT_DETACHED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'PURCHASE_ORDER_DOCUMENT',
        targetId: documentId,
        requestId: context.requestId,
        metadata: { purchaseOrderId, documentType: document.documentType },
      })
    })
    return this.query.getById(purchaseOrderId)
  }

  async resolveContent(
    purchaseOrderId: string,
    documentId: string,
    ifNoneMatch: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<PurchaseOrderDocumentContentResponse> {
    const row = await this.prisma.purchaseOrderDocument.findFirst({
      where: {
        id: requireUuid(documentId, 'documentId'),
        purchaseOrderId: requireUuid(purchaseOrderId, 'purchaseOrderId'),
        detachedAt: null,
        mediaAsset: { status: 'READY', deletedAt: null },
      },
      select: {
        mediaAsset: { select: {
          checksumSha256: true,
          mimeType: true,
          objectKey: true,
          originalFilename: true,
        } },
      },
    })
    if (
      row === null
      || row.mediaAsset.objectKey === null
      || row.mediaAsset.checksumSha256 === null
      || row.mediaAsset.mimeType === null
    ) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PURCHASE_ORDER_DOCUMENT_NOT_FOUND',
        '采购订单凭证不存在',
      )
    }
    const objectKey = requireMediaObjectKeyNamespace(
      row.mediaAsset.objectKey,
      'assets',
    )
    const etag = `"sha256-${createHash('sha256')
      .update(`purchase-order-document:${row.mediaAsset.checksumSha256}`)
      .digest('base64url')}"`
    const headers: Record<string, string> = {
      'Accept-Ranges': 'none',
      'Content-Disposition': contentDisposition(row.mediaAsset.originalFilename),
      'Content-Type': row.mediaAsset.mimeType,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (
      typeof ifNoneMatch === 'string'
      && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)
    ) {
      return { status: HttpStatus.NOT_MODIFIED, headers }
    }
    try {
      const stat = await this.delivery.stat(objectKey)
      if (stat === null) throw new Error('missing media object')
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${objectKey
          .split('/')
          .map(segment => encodeURIComponent(segment))
          .join('/')}`
        return { status: HttpStatus.OK, headers }
      }
      if (method === 'HEAD') return { status: HttpStatus.OK, headers }
      const stored = await this.delivery.open(objectKey)
      return { status: HttpStatus.OK, headers, stream: stored.stream }
    }
    catch {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'MEDIA_STORAGE_UNAVAILABLE',
        '媒体存储暂时不可用',
      )
    }
  }
}
