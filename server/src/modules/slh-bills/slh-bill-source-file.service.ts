import type { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { MEDIA_CONTENT_SIZE_LIMITS } from '../media/media-validation'
import { SalesOrderDocumentMultipartParser, type SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import type { SlhBillStagedFileDto } from './slh-bill.dto'

export const SLH_BILL_SOURCE_UPLOAD_PURPOSE = 'SLH_BILL_SOURCE_XLSX'
export const SLH_BILL_SOURCE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export interface SlhBillSourceContent { headers: Record<string, string>; stream?: Readable }

function fail(code: string, message: string, status = 422): never { throw new ApiException(status, code, message) }

@Injectable()
export class SlhBillSourceFileService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  /** 账单上传只暂存：解析预览通过后才在入库事务里激活，取消则由既有的过期上传清理回收。 */
  async upload(actorUserId: string, request: SalesOrderDocumentMultipartRequest): Promise<SlhBillStagedFileDto> {
    try {
      return await this.multipart.parse(request, async input => {
        if (input.mediaType !== 'DOCUMENT' || input.declaredMimeType !== SLH_BILL_SOURCE_MIME || !/\.xlsx$/iu.test(input.originalFilename)) {
          fail('SLH_BILL_SOURCE_FILE_INVALID', '请选择顺联航对账单的 .xlsx 文件')
        }
        const asset = await this.media.prepare({ actorUserId, allowedTypes: ['DOCUMENT'], requestedType: 'DOCUMENT', declaredMimeType: input.declaredMimeType, originalFilename: input.originalFilename, pool: 'bill', stream: input.stream })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null },
          data: { uploadPurpose: SLH_BILL_SOURCE_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '上传状态已变化，请重新上传')
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalFilename: true, checksumSha256: true } })
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
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') fail('SLH_BILL_SOURCE_FILE_TOO_LARGE', '账单文件不能超过 50 MiB')
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件存储暂时不可用', 503)
        fail('SLH_BILL_SOURCE_FILE_INVALID', '账单文件内容无效，请选择顺联航提供的 .xlsx 文件')
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') fail('SLH_BILL_SOURCE_FILE_TOO_LARGE', '账单文件不能超过 50 MiB')
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') fail('SLH_BILL_SOURCE_FILE_INVALID', '每次只能上传一个 .xlsx 文件')
        throw error
      }
      fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件存储暂时不可用', 503)
    }
  }

  /** 预览阶段文件仍是临时上传：只接受本人上传、用途正确、未过期且摘要可读的文件。 */
  private async pending(mediaAssetId: string, actorUserId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } })
    if (!asset || asset.createdByUserId !== actorUserId || asset.deletedAt !== null
      || asset.uploadPurpose !== SLH_BILL_SOURCE_UPLOAD_PURPOSE || asset.mediaType !== 'DOCUMENT'
      || asset.mimeType !== SLH_BILL_SOURCE_MIME || !asset.objectKey || !asset.checksumSha256
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256) || asset.sizeBytes === null
      || asset.sizeBytes <= 0n || asset.sizeBytes > BigInt(MEDIA_CONTENT_SIZE_LIMITS.DOCUMENT)) {
      fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用', 404)
    }
    if (asset.status === 'UPLOADING' && (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= Date.now())) {
      fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '账单文件已过期，请重新上传', 404)
    }
    if (asset.status !== 'READY' && asset.status !== 'UPLOADING') fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用', 404)
    return asset
  }

  /**
   * 读回原件用于解析。生产环境的 internal redirect 只影响浏览器下载，
   * 服务端解析必须自己读私有媒体并重新校验摘要。
   */
  async readForParse(mediaAssetId: string, actorUserId: string): Promise<{ bytes: Buffer, fileName: string, checksumSha256: string, sizeBytes: number }> {
    const asset = await this.pending(mediaAssetId, actorUserId)
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey!, 'assets')
      const stat = await this.delivery.stat(key)
      if (!stat || stat.sizeBytes !== asset.sizeBytes || stat.sizeBytes <= 0n || stat.sizeBytes > BigInt(MEDIA_CONTENT_SIZE_LIMITS.DOCUMENT)) {
        fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件暂时无法解析', 503)
      }
      const { stream } = await this.delivery.open(key)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        size += bytes.length
        if (BigInt(size) > stat.sizeBytes) { stream.destroy(); fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件内容已变化', 503) }
        chunks.push(bytes)
      }
      if (BigInt(size) !== stat.sizeBytes) fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件内容不完整', 503)
      const bytes = Buffer.concat(chunks)
      const checksum = createHash('sha256').update(bytes).digest('hex')
      if (checksum !== asset.checksumSha256) fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件内容已变化', 503)
      return { bytes, fileName: asset.originalFilename, checksumSha256: checksum, sizeBytes: Number(stat.sizeBytes) }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件暂时无法解析', 503)
    }
  }

  /**
   * 入库事务内激活原件：锁媒体行防止回收并发，重新读实体并比对摘要，
   * 不允许把其他用途或他人上传的文件据为账单来源。
   */
  async attach(transaction: Prisma.TransactionClient, mediaAssetId: string, actorUserId: string): Promise<{ fileName: string, checksumSha256: string }> {
    const locks = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM media_assets WHERE id = CAST(${mediaAssetId} AS uuid) FOR UPDATE
    `)
    if (locks.length !== 1) fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用')
    const asset = await transaction.mediaAsset.findUnique({ where: { id: mediaAssetId } })
    if (!asset || asset.createdByUserId !== actorUserId || asset.deletedAt !== null
      || asset.uploadPurpose !== SLH_BILL_SOURCE_UPLOAD_PURPOSE || asset.mediaType !== 'DOCUMENT'
      || asset.mimeType !== SLH_BILL_SOURCE_MIME || !asset.objectKey || !asset.checksumSha256
      || !/^[a-f0-9]{64}$/u.test(asset.checksumSha256) || asset.sizeBytes === null
      || asset.sizeBytes <= 0n || asset.sizeBytes > BigInt(MEDIA_CONTENT_SIZE_LIMITS.DOCUMENT)
      || (asset.status !== 'READY' && asset.status !== 'UPLOADING')
      || (asset.status === 'UPLOADING' && (!asset.uploadExpiresAt || asset.uploadExpiresAt.getTime() <= Date.now()))) {
      fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用')
    }
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (!stat || stat.sizeBytes !== asset.sizeBytes) fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用')
      const stored = await this.delivery.open(key)
      const hash = createHash('sha256')
      let size = 0n
      try {
        for await (const chunk of stored.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += BigInt(bytes.length)
          if (size > asset.sizeBytes) fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用')
          hash.update(bytes)
        }
      }
      finally {
        stored.stream.destroy()
      }
      if (size !== asset.sizeBytes || hash.digest('hex') !== asset.checksumSha256) fail('SLH_BILL_SOURCE_FILE_UNAVAILABLE', '所选账单文件当前不可用')
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件存储暂时不可用，请稍后重试', 503)
    }
    if (asset.status === 'UPLOADING') await this.media.activate(transaction, asset.id)
    return { fileName: asset.originalFilename, checksumSha256: asset.checksumSha256 }
  }

  async content(asset: { objectKey: string | null, originalFilename: string, sizeBytes: bigint | null }, method: 'GET' | 'HEAD'): Promise<SlhBillSourceContent> {
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey!, 'assets')
      const stat = await this.delivery.stat(key)
      if (!stat || stat.sizeBytes !== asset.sizeBytes) fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件暂时无法下载', 503)
      const filename = asset.originalFilename.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'slh-bill.xlsx'
      const encoded = encodeURIComponent(asset.originalFilename).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      const headers: Record<string, string> = { 'Content-Type': SLH_BILL_SOURCE_MIME, 'Content-Length': stat.sizeBytes.toString(),
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none' }
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { headers }
      }
      return method === 'HEAD' ? { headers } : { headers, stream: (await this.delivery.open(key)).stream }
    }
    catch (error) {
      if (error instanceof ApiException) throw error
      fail('MEDIA_STORAGE_UNAVAILABLE', '账单文件暂时无法下载', 503)
    }
  }
}
