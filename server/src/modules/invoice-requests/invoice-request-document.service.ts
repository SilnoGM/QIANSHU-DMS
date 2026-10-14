import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { MEDIA_CONTENT_SIZE_LIMITS } from '../media/media-validation'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { SalesOrderDocumentMultipartParser } from '../sales-orders/documents/sales-order-document-multipart.parser'
import {
  INVOICE_REQUEST_DOCUMENT_POOL,
  INVOICE_REQUEST_DOCUMENT_UPLOAD_PURPOSE,
} from './invoice-request.contract'
import { INVOICE_REQUEST_ERROR_CODES, invoiceRequestFailure } from './invoice-request.errors'

/** 发票照片只接受这三种图片：与票面证据的可读性要求一致，且不支持 HEIC。 */
const INVOICE_DOCUMENT_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']

export interface InvoiceRequestDocumentUpload {
  readonly checksumSha256: string
  readonly fileName: string
  readonly mediaAssetId: string
  readonly sizeBytes: number
}

export interface InvoiceRequestDocumentContent {
  headers: Record<string, string>
  stream?: Readable
}

/** 发票照片：上传即定稿，只允许一张，且引用后必须保持 READY（数据库侧的就绪校验兜底）。 */
@Injectable()
export class InvoiceRequestDocumentService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  /**
   * 上传只暂存（UPLOADING）：真正的激活与回填发生在结算认领它的事务里。
   * 复用订单凭证的 multipart 解析器（字段顺序：mediaType 必须在 file 之前），
   * 并把它面向订单的错误码映射成本域的码。
   */
  async stage(actorUserId: string, request: SalesOrderDocumentMultipartRequest): Promise<InvoiceRequestDocumentUpload> {
    try {
      return await this.multipart.parse(request, async (input) => {
        if (input.mediaType !== 'IMAGE' || input.declaredMimeType === null || !INVOICE_DOCUMENT_MIME_TYPES.includes(input.declaredMimeType)) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_INVALID, '请上传 jpg、png 或 webp 格式的发票照片')
        }
        const asset = await this.media.prepare({
          actorUserId,
          allowedTypes: ['IMAGE'],
          requestedType: 'IMAGE',
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          pool: INVOICE_REQUEST_DOCUMENT_POOL,
          stream: input.stream,
        })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null },
          data: { uploadPurpose: INVOICE_REQUEST_DOCUMENT_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '上传状态已变化，请重新上传')
        }
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
          select: { checksumSha256: true, originalFilename: true },
        })
        return {
          mediaAssetId: asset.id,
          fileName: row.originalFilename,
          checksumSha256: row.checksumSha256 ?? '',
          sizeBytes: Number(asset.trustedMetadata.sizeBytes),
        }
      })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_TOO_LARGE, '发票照片不能超过 10 MiB')
        }
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) {
          invoiceRequestFailure('MEDIA_STORAGE_UNAVAILABLE', '发票照片存储暂时不可用', 503)
        }
        invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_INVALID, '发票照片内容无效，请重新拍摄或导出后上传')
      }
      // 解析器面向订单凭证，它的两个码在这里翻译成本域的码，前端不需要认识订单的码。
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_TOO_LARGE, '发票照片不能超过 10 MiB')
        }
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') {
          invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_INVALID, '每次只能上传一张发票照片')
        }
        throw error
      }
      invoiceRequestFailure('MEDIA_STORAGE_UNAVAILABLE', '发票照片存储暂时不可用', 503)
    }
  }

  /**
   * 单据事务内认领照片：锁媒体行防止回收并发，重新校验归属、用途与形状，
   * 必要时激活，返回文件名供响应使用。不允许把他人上传或其它用途的文件据为发票照片。
   */
  async attach(
    transaction: Prisma.TransactionClient,
    input: { readonly actorUserId: string, readonly mediaAssetId: string },
  ): Promise<{ readonly fileName: string }> {
    const locks = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM media_assets WHERE id = CAST(${input.mediaAssetId} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
    }
    const asset = await transaction.mediaAsset.findUnique({ where: { id: input.mediaAssetId } })
    if (asset === null
      || asset.createdByUserId !== input.actorUserId
      || asset.deletedAt !== null
      || asset.uploadPurpose !== INVOICE_REQUEST_DOCUMENT_UPLOAD_PURPOSE
      || asset.mediaType !== 'IMAGE'
      || asset.mimeType === null
      || !INVOICE_DOCUMENT_MIME_TYPES.includes(asset.mimeType)
      || asset.objectKey === null
      || asset.checksumSha256 === null
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256)
      || asset.sizeBytes === null
      || asset.sizeBytes <= 0n
      || asset.sizeBytes > BigInt(MEDIA_CONTENT_SIZE_LIMITS.IMAGE)
      || (asset.status !== 'READY' && asset.status !== 'UPLOADING')
      || (asset.status === 'UPLOADING' && (asset.uploadExpiresAt === null || asset.uploadExpiresAt.getTime() <= Date.now()))) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
    }
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
      }
      const stored = await this.delivery.open(key)
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of stored.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += BigInt(bytes.length)
          if (size > asset.sizeBytes) {
            invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
          }
          hash.update(bytes)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes || hash.digest('hex') !== asset.checksumSha256) {
        invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_UNAVAILABLE, '所选发票照片当前不可用')
      }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      invoiceRequestFailure('MEDIA_STORAGE_UNAVAILABLE', '发票照片存储暂时不可用，请稍后重试', 503)
    }
    if (asset.status === 'UPLOADING') {
      await this.media.activate(transaction, asset.id)
    }
    return { fileName: asset.originalFilename }
  }

  /** 读发票照片：私有、不缓存、只允许 inline 展示。 */
  async content(
    asset: { readonly checksumSha256: string | null, readonly mimeType: string | null, readonly objectKey: string | null, readonly originalFilename: string, readonly sizeBytes: bigint | null },
    method: 'GET' | 'HEAD',
  ): Promise<InvoiceRequestDocumentContent> {
    if (asset.objectKey === null || asset.sizeBytes === null || asset.mimeType === null || !INVOICE_DOCUMENT_MIME_TYPES.includes(asset.mimeType)) {
      invoiceRequestFailure(INVOICE_REQUEST_ERROR_CODES.DOCUMENT_REQUIRED, '这张申请单还没有发票照片', 404)
    }
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (stat === null || stat.sizeBytes !== asset.sizeBytes) {
        invoiceRequestFailure('MEDIA_STORAGE_UNAVAILABLE', '发票照片暂时无法读取', 503)
      }
      const filename = asset.originalFilename.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'invoice.jpg'
      const headers: Record<string, string> = {
        'Content-Type': asset.mimeType,
        'Content-Length': stat.sizeBytes.toString(),
        'Content-Disposition': ['inline; filename="', filename, '"'].join(''),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
      }
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = ['/_qianshu_internal_media/', key.split('/').map(encodeURIComponent).join('/')].join('')
        return { headers }
      }
      return method === 'HEAD' ? { headers } : { headers, stream: (await this.delivery.open(key)).stream }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      invoiceRequestFailure('MEDIA_STORAGE_UNAVAILABLE', '发票照片暂时无法读取', 503)
    }
  }
}
