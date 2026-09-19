import type { Readable } from 'node:stream'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { OCEAN_FREIGHT_SOURCE_UPLOAD_PURPOSE } from '../media/ocean-freight-source-file.service'
import { SalesOrderDocumentMultipartParser, type SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import type { ContainerSourceFileDto } from './container-source-file.dto'

export const CONTAINER_SOURCE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export interface ContainerSourceContent { headers: Record<string, string>; stream?: Readable }
function fail(code: string, message: string, status = 422): never { throw new ApiException(status, code, message) }

@Injectable()
export class ContainerSourceFileService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()
  constructor(private readonly prisma: PrismaService, private readonly media: MediaAssetService, private readonly delivery: MediaContentDeliveryService) {}

  async upload(actorUserId: string, batchId: string, request: SalesOrderDocumentMultipartRequest): Promise<ContainerSourceFileDto> {
    const batch = await this.prisma.containerBatch.findUnique({ where: { id: batchId }, select: { sourceFileId: true } })
    if (!batch) fail('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
    if (batch.sourceFileId !== null) fail('CONTAINER_SOURCE_FILE_LOCKED', '来源文件已保存，不能替换')
    try {
      return await this.multipart.parse(request, async input => {
        if (input.mediaType !== 'DOCUMENT' || input.declaredMimeType !== CONTAINER_SOURCE_MIME || !/\.xlsx$/iu.test(input.originalFilename)) {
          fail('CONTAINER_SOURCE_FILE_INVALID', '请选择有效的 .xlsx 装柜资料文件')
        }
        // prepare 会识别真实 OOXML 内容并验证完整文件，上传仍为临时状态；只有父柜次保存成功才激活。
        const asset = await this.media.prepare({ actorUserId, allowedTypes: ['DOCUMENT'], requestedType: 'DOCUMENT', declaredMimeType: input.declaredMimeType, originalFilename: input.originalFilename, stream: input.stream })
        const marked = await this.prisma.mediaAsset.updateMany({
          where: { id: asset.id, status: 'UPLOADING', createdByUserId: actorUserId, uploadPurpose: null },
          data: { uploadPurpose: OCEAN_FREIGHT_SOURCE_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) fail('OCEAN_FREIGHT_SOURCE_FILE_UNAVAILABLE', '上传状态已变化，请重新上传')
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, select: { originalFilename: true } })
        return { mediaAssetId: asset.id, originalFilename: row.originalFilename, mimeType: asset.trustedMetadata.mimeType, sizeBytes: asset.trustedMetadata.sizeBytes.toString() }
      })
    } catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') fail('CONTAINER_SOURCE_FILE_TOO_LARGE', '来源文件不能超过 50 MiB')
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) fail('MEDIA_STORAGE_UNAVAILABLE', '来源文件存储暂时不可用', 503)
        fail('CONTAINER_SOURCE_FILE_INVALID', '来源文件内容无效，请选择有效的 .xlsx 文件')
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') fail('CONTAINER_SOURCE_FILE_TOO_LARGE', '来源文件不能超过 50 MiB')
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') fail('CONTAINER_SOURCE_FILE_INVALID', '每次只能上传一个 .xlsx 文件')
        throw error
      }
      fail('MEDIA_STORAGE_UNAVAILABLE', '来源文件存储暂时不可用', 503)
    }
  }

  private async attached(batchId: string) {
    const batch = await this.prisma.containerBatch.findUnique({ where: { id: batchId }, include: { sourceFile: true } })
    if (!batch) fail('CONTAINER_BATCH_NOT_FOUND', '柜次不存在', 404)
    const asset = batch.sourceFile
    if (!asset || asset.status !== 'READY' || asset.deletedAt || asset.uploadPurpose !== OCEAN_FREIGHT_SOURCE_UPLOAD_PURPOSE
      || asset.mediaType !== 'DOCUMENT' || asset.mimeType !== CONTAINER_SOURCE_MIME || !asset.objectKey || asset.sizeBytes === null) {
      fail('CONTAINER_SOURCE_FILE_NOT_FOUND', '柜次来源文件不存在或不可用', 404)
    }
    return asset
  }
  async metadata(batchId: string): Promise<ContainerSourceFileDto> {
    const asset = await this.attached(batchId)
    return { mediaAssetId: asset.id, originalFilename: asset.originalFilename, mimeType: asset.mimeType!, sizeBytes: asset.sizeBytes!.toString() }
  }
  async content(batchId: string, method: 'GET' | 'HEAD'): Promise<ContainerSourceContent> {
    const asset = await this.attached(batchId)
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey!, 'assets')
      const stat = await this.delivery.stat(key)
      if (!stat || stat.sizeBytes !== asset.sizeBytes) fail('MEDIA_STORAGE_UNAVAILABLE', '来源文件暂时无法下载', 503)
      const filename = asset.originalFilename.replace(/[^A-Za-z0-9._ -]/gu, '_').slice(0, 180) || 'source.xlsx'
      const encoded = encodeURIComponent(asset.originalFilename).replace(/['()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      const headers: Record<string, string> = { 'Content-Type': CONTAINER_SOURCE_MIME, 'Content-Length': stat.sizeBytes.toString(),
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none' }
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { headers }
      }
      return method === 'HEAD' ? { headers } : { headers, stream: (await this.delivery.open(key)).stream }
    } catch (error) {
      if (error instanceof ApiException) throw error
      fail('MEDIA_STORAGE_UNAVAILABLE', '来源文件暂时无法下载', 503)
    }
  }
}
