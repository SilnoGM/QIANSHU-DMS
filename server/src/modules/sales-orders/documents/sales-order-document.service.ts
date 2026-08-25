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
import { MediaContentDeliveryService } from '../../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../../media/media-storage'
import {
  salesOrderRuleFailure,
  salesOrderValidationFailure,
} from '../domain/sales-order-errors'
import { createSalesOrderDocumentTitle } from '../domain/sales-order-document-title'
import { isCanonicalSalesOrderActorId } from '../sales-order-command.normalizer'
import type { SalesOrderMutationContext } from '../sales-order-mutation.service'
import {
  SalesOrderQueryService,
  type SalesOrderDetail,
} from '../sales-order-query.service'
import {
  SalesOrderDocumentMultipartParser,
  type SalesOrderDocumentMultipartRequest,
} from './sales-order-document-multipart.parser'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export interface SalesOrderTemporaryDocument {
  readonly mediaAssetId: string
  readonly mediaType: 'IMAGE' | 'DOCUMENT'
  readonly mimeType: string
  readonly sizeBytes: string
  readonly originalFilename: string
}

export interface SalesOrderDocumentContentResponse {
  readonly status: HttpStatus.NOT_MODIFIED | HttpStatus.OK
  readonly headers: Record<string, string>
  readonly stream?: Readable
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return salesOrderValidationFailure(field, '必须是规范的小写 UUID v4')
  }
  return value
}

function requireContext(context: SalesOrderMutationContext): void {
  if (
    !isCanonicalSalesOrderActorId(context.actorUserId)
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

function requireRecord(
  value: unknown,
  field = 'body',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return salesOrderValidationFailure(field)
  }
  return value as Readonly<Record<string, unknown>>
}

function rejectUnknownKeys(
  body: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  field = 'body',
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(body).some(key => !allowed.has(key))) {
    return salesOrderValidationFailure(field)
  }
}

function mapUploadError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof MediaAssetLifecycleError) {
    const code = error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE'
      ? 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE'
      : error.code === 'MEDIA_ASSET_CONTENT_UNSUPPORTED'
        || error.code === 'MEDIA_ASSET_TYPE_NOT_ALLOWED'
        ? 'SALES_ORDER_DOCUMENT_CONTENT_UNSUPPORTED'
        : 'SALES_ORDER_DOCUMENT_CONTENT_INVALID'
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      code,
      '订单凭证文件无效',
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
export class SalesOrderDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAsset: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly audit: AuditService,
    private readonly query: SalesOrderQueryService,
    private readonly multipart: SalesOrderDocumentMultipartParser,
  ) {}

  uploadTemporary(
    context: SalesOrderMutationContext,
    request: SalesOrderDocumentMultipartRequest,
  ): Promise<SalesOrderTemporaryDocument> {
    requireContext(context)
    return this.multipart.parse(request, async input => {
      try {
        const prepared = await this.mediaAsset.prepare({
          actorUserId: context.actorUserId,
          allowedTypes: ['IMAGE', 'DOCUMENT'],
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          requestedType: input.mediaType,
          stream: input.stream,
        })
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

  async submitDeliveryReceipt(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    requireContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const body = requireRecord(input)
    rejectUnknownKeys(body, ['mediaAssetId'])
    const mediaAssetId = requireUuid(body.mediaAssetId, 'mediaAssetId')

    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "sales_orders"
          WHERE "id" = CAST(${salesOrderId} AS uuid)
          FOR UPDATE
        `)
        if (locks.length !== 1) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            'SALES_ORDER_NOT_FOUND',
            '销售订单不存在',
          )
        }
        const order = await transaction.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: { id: true, customerName: true },
        })
        if (order === null) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            'SALES_ORDER_NOT_FOUND',
            '销售订单不存在',
          )
        }
        const asset = await transaction.mediaAsset.findFirst({
          where: {
            id: mediaAssetId,
            createdByUserId: context.actorUserId,
            status: 'UPLOADING',
            mediaType: { in: ['IMAGE', 'DOCUMENT'] },
            deletedAt: null,
            objectKey: { not: null },
          },
          select: { id: true, createdAt: true },
        })
        if (asset === null) {
          return salesOrderRuleFailure(
            'SALES_ORDER_DOCUMENT_UNAVAILABLE',
            '所选签收单当前不可用',
          )
        }
        await this.mediaAsset.activate(transaction, mediaAssetId)
        const document = await transaction.salesOrderDocument.create({
          data: {
            salesOrderId,
            mediaAssetId,
            paymentId: null,
            documentType: 'DELIVERY_RECEIPT',
            title: createSalesOrderDocumentTitle(
              order.customerName,
              'DELIVERY_RECEIPT',
              asset.createdAt,
            ),
            remark: null,
            createdByUserId: context.actorUserId,
          },
          select: { id: true },
        })
        // 货物签收仅新增订单级凭证；订单进度仍等待后续管理员审批。
        await transaction.salesOrder.update({
          where: { id: salesOrderId },
          data: { version: { increment: 1 } },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SALES_ORDER_DOCUMENT_ATTACHED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'SALES_ORDER_DOCUMENT',
          targetId: document.id,
          requestId: context.requestId,
          metadata: { salesOrderId, documentType: 'DELIVERY_RECEIPT' },
        })
      })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      if (error instanceof MediaAssetLifecycleError) return mapUploadError(error)
      throw error
    }
    return this.query.getById(salesOrderId)
  }

  async detach(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    rawDocumentId: unknown,
  ): Promise<SalesOrderDetail> {
    requireContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    const documentId = requireUuid(rawDocumentId, 'documentId')
    await this.prisma.$transaction(async transaction => {
      await applyTransactionTimeouts(transaction)
      const locks = await transaction.$queryRaw<Array<{
        id: string
        fulfillmentStatus: string
      }>>(Prisma.sql`
        SELECT "id", "fulfillment_status" AS "fulfillmentStatus"
        FROM "sales_orders"
        WHERE "id" = CAST(${salesOrderId} AS uuid)
        FOR UPDATE
      `)
      if (locks.length !== 1) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'SALES_ORDER_NOT_FOUND',
          '销售订单不存在',
        )
      }
      const document = await transaction.salesOrderDocument.findFirst({
        where: { id: documentId, salesOrderId, detachedAt: null },
        select: { id: true, documentType: true },
      })
      if (document === null) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'SALES_ORDER_DOCUMENT_NOT_FOUND',
          '订单凭证不存在',
        )
      }
      if (document.documentType !== 'DELIVERY_RECEIPT') {
        return salesOrderRuleFailure(
          'SALES_ORDER_DOCUMENT_REQUIRED',
          '出单凭证和收款凭证不能单独解除',
        )
      }
      if (
        locks[0]?.fulfillmentStatus === 'SIGNED'
        && document.documentType === 'DELIVERY_RECEIPT'
      ) {
        const receiptCount = await transaction.salesOrderDocument.count({
          where: {
            salesOrderId,
            documentType: 'DELIVERY_RECEIPT',
            detachedAt: null,
          },
        })
        if (receiptCount <= 1) {
          return salesOrderRuleFailure(
            'SALES_ORDER_DELIVERY_RECEIPT_REQUIRED',
            '已签收订单必须保留至少一份有效签收单',
          )
        }
      }
      await transaction.salesOrderDocument.update({
        where: { id: documentId },
        data: {
          detachedAt: new Date(),
          detachedByUserId: context.actorUserId,
        },
      })
      await transaction.salesOrder.update({
        where: { id: salesOrderId },
        data: { version: { increment: 1 } },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.SALES_ORDER_DOCUMENT_DETACHED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'SALES_ORDER_DOCUMENT',
        targetId: documentId,
        requestId: context.requestId,
        metadata: { salesOrderId, documentType: document.documentType },
      })
    })
    return this.query.getById(salesOrderId)
  }

  async resolveContent(
    salesOrderId: string,
    documentId: string,
    ifNoneMatch: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<SalesOrderDocumentContentResponse> {
    const row = await this.prisma.salesOrderDocument.findFirst({
      where: {
        id: requireUuid(documentId, 'documentId'),
        salesOrderId: requireUuid(salesOrderId, 'salesOrderId'),
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
        'SALES_ORDER_DOCUMENT_NOT_FOUND',
        '订单凭证不存在',
      )
    }
    const objectKey = requireMediaObjectKeyNamespace(
      row.mediaAsset.objectKey,
      'assets',
    )
    const etag = `"sha256-${createHash('sha256')
      .update(`sales-order-document:${row.mediaAsset.checksumSha256}`)
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
