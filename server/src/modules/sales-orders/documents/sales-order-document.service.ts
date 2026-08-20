import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type SalesOrderDocumentType,
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
const DOCUMENT_TYPES = new Set<SalesOrderDocumentType>([
  'DEPOSIT_VOUCHER',
  'DELIVERY_RECEIPT',
  'OTHER',
])

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

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return salesOrderValidationFailure(field)
  const normalized = value.trim().normalize('NFKC')
  if ([...normalized].length < 1 || [...normalized].length > maximum) {
    return salesOrderValidationFailure(field)
  }
  return normalized
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

  async attach(
    context: SalesOrderMutationContext,
    rawSalesOrderId: unknown,
    input: unknown,
  ): Promise<SalesOrderDetail> {
    requireContext(context)
    const salesOrderId = requireUuid(rawSalesOrderId, 'salesOrderId')
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return salesOrderValidationFailure('body')
    }
    const body = input as Readonly<Record<string, unknown>>
    const mediaAssetId = requireUuid(body.mediaAssetId, 'mediaAssetId')
    const paymentId = body.paymentId === null || body.paymentId === undefined
      ? null
      : requireUuid(body.paymentId, 'paymentId')
    if (
      typeof body.documentType !== 'string'
      || !DOCUMENT_TYPES.has(body.documentType as SalesOrderDocumentType)
    ) {
      return salesOrderValidationFailure('documentType')
    }
    const documentType = body.documentType as SalesOrderDocumentType
    const title = optionalText(body.title, 'title', 128)
    const remark = optionalText(body.remark, 'remark', 500)
    try {
      await this.prisma.$transaction(async transaction => {
        await applyTransactionTimeouts(transaction)
        const locks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "sales_orders"
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
        const asset = await transaction.mediaAsset.findFirst({
          where: {
            id: mediaAssetId,
            createdByUserId: context.actorUserId,
            status: 'UPLOADING',
            mediaType: { in: ['IMAGE', 'DOCUMENT'] },
            deletedAt: null,
            objectKey: { not: null },
          },
          select: { id: true },
        })
        if (asset === null) {
          return salesOrderRuleFailure(
            'SALES_ORDER_DOCUMENT_UNAVAILABLE',
            '所选订单凭证当前不可用',
          )
        }
        if (paymentId !== null) {
          const payment = await transaction.salesOrderPayment.findFirst({
            where: { id: paymentId, salesOrderId },
            select: { id: true },
          })
          if (payment === null) {
            return salesOrderRuleFailure(
              'SALES_ORDER_PAYMENT_NOT_FOUND',
              '关联的实际收款记录不存在',
            )
          }
        }
        await this.mediaAsset.activate(transaction, mediaAssetId)
        const document = await transaction.salesOrderDocument.create({
          data: {
            salesOrderId,
            mediaAssetId,
            paymentId,
            documentType,
            title,
            remark,
            createdByUserId: context.actorUserId,
          },
          select: { id: true },
        })
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
          metadata: { salesOrderId, documentType },
        })
      })
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      return mapUploadError(error)
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
