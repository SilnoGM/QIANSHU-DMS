import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import type { NotificationEventConfigContext } from './notification-event-config.service'
import type {
  NotificationContentFileUploadDto,
  NotificationContentMediaUploadDto,
} from './notification-content-media.dto'
import {
  NotificationContentMediaMultipartParser,
  type NotificationContentMediaMultipartRequest,
} from './notification-content-media-multipart.parser'

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const FILE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface NotificationContentMediaContent {
  readonly status: number
  readonly headers: Record<string, string>
  readonly stream?: Readable
}

function contentMediaFailure(code: string, message: string, status = 422): ApiException {
  return new ApiException(status, code, message)
}

/**
 * 通知内容图片上传与读取。
 *
 * 上传只准备 UPLOADING 资产，由事件配置保存事务负责激活；未保存的草稿资产会随上传过期清理，
 * 不会留下无人引用的 READY 记录。读取只放行已被事件配置引用的资产，避免按 UUID 越权读取
 * 其他业务域的媒体。
 */
@Injectable()
export class NotificationContentMediaService {
  private readonly multipart = new NotificationContentMediaMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  async upload(
    context: NotificationEventConfigContext,
    request: NotificationContentMediaMultipartRequest,
  ): Promise<NotificationContentMediaUploadDto> {
    try {
      return await this.multipart.parse(request, async (input) => {
        if (!MIME_TYPES.includes(input.declaredMimeType ?? '')) {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_MEDIA_INVALID',
            '仅支持 JPEG、PNG、WebP 图片',
          )
        }
        const prepared = await this.media.prepare({
          actorUserId: context.actorUserId,
          allowedTypes: ['IMAGE'],
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          pool: 'notification',
          requestedType: 'IMAGE',
          stream: input.stream,
        })
        if (prepared.trustedMetadata.mediaType !== 'IMAGE') {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_MEDIA_INVALID',
            '仅支持 JPEG、PNG、WebP 图片',
          )
        }
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: prepared.id },
          select: { originalFilename: true },
        })
        return {
          assetId: prepared.id,
          mimeType: prepared.trustedMetadata.mimeType,
          sizeBytes: prepared.trustedMetadata.sizeBytes.toString(),
          width: prepared.trustedMetadata.width,
          height: prepared.trustedMetadata.height,
          originalFilename: row.originalFilename,
        }
      })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_MEDIA_TOO_LARGE',
            '内容图片不得超过 10 MiB',
          )
        }
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) {
          throw contentMediaFailure(
            'MEDIA_STORAGE_UNAVAILABLE',
            '图片存储暂时不可用',
            503,
          )
        }
        throw contentMediaFailure(
          'NOTIFICATION_CONTENT_MEDIA_INVALID',
          '图片文件无效，请重新选择',
        )
      }
      throw error
    }
  }

  async uploadFile(
    context: NotificationEventConfigContext,
    request: NotificationContentMediaMultipartRequest,
  ): Promise<NotificationContentFileUploadDto> {
    try {
      return await this.multipart.parse(request, async (input) => {
        if (!FILE_MIME_TYPES.includes(input.declaredMimeType ?? '')) {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_FILE_INVALID',
            '仅支持 PDF、DOCX、XLSX 文件',
          )
        }
        const prepared = await this.media.prepare({
          actorUserId: context.actorUserId,
          allowedTypes: ['DOCUMENT'],
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          pool: 'notification',
          requestedType: 'DOCUMENT',
          stream: input.stream,
        })
        if (prepared.trustedMetadata.mediaType !== 'DOCUMENT') {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_FILE_INVALID',
            '仅支持 PDF、DOCX、XLSX 文件',
          )
        }
        const row = await this.prisma.mediaAsset.findUniqueOrThrow({
          where: { id: prepared.id },
          select: { originalFilename: true },
        })
        return {
          assetId: prepared.id,
          mimeType: prepared.trustedMetadata.mimeType,
          sizeBytes: prepared.trustedMetadata.sizeBytes.toString(),
          originalFilename: row.originalFilename,
        }
      }, { maxBytes: 20 * 1024 * 1024 })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
          throw contentMediaFailure(
            'NOTIFICATION_CONTENT_MEDIA_TOO_LARGE',
            '内容文件不得超过 20 MiB',
          )
        }
        if (['MEDIA_ASSET_STORAGE_FAILED', 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE', 'MEDIA_ASSET_PERSISTENCE_FAILED'].includes(error.code)) {
          throw contentMediaFailure(
            'MEDIA_STORAGE_UNAVAILABLE',
            '文件存储暂时不可用',
            503,
          )
        }
        throw contentMediaFailure(
          'NOTIFICATION_CONTENT_FILE_INVALID',
          '文件无效，请重新选择',
        )
      }
      throw error
    }
  }

  async content(
    assetId: string,
    ifNoneMatch: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<NotificationContentMediaContent> {
    if (!UUID_PATTERN.test(assetId)) {
      throw contentMediaFailure('NOTIFICATION_CONTENT_MEDIA_NOT_FOUND', '内容图片不存在', 404)
    }
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        mediaType: 'IMAGE',
        status: 'READY',
        deletedAt: null,
        notificationEventChannelMessageMedia: { some: {} },
      },
      select: {
        checksumSha256: true,
        mimeType: true,
        objectKey: true,
        originalFilename: true,
      },
    })
    if (
      asset === null
      || asset.objectKey === null
      || asset.checksumSha256 === null
      || asset.mimeType === null
      || !MIME_TYPES.includes(asset.mimeType)
    ) {
      throw contentMediaFailure('NOTIFICATION_CONTENT_MEDIA_NOT_FOUND', '内容图片不存在', 404)
    }
    const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
    const etag = `"sha256-${createHash('sha256').update(`notification-content:${asset.checksumSha256}`).digest('base64url')}"`
    const filename = asset.originalFilename
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/[^A-Za-z0-9._ -]/gu, '_')
      .slice(0, 180) || 'image'
    const headers: Record<string, string> = {
      'Accept-Ranges': 'none',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Type': asset.mimeType,
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (
      typeof ifNoneMatch === 'string'
      && ifNoneMatch.split(',').some(value => value.trim().replace(/^W\//u, '') === etag)
    ) {
      return { status: 304, headers }
    }
    try {
      const stat = await this.delivery.stat(key)
      if (stat === null) throw new Error('Missing media object')
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { status: 200, headers }
      }
      if (method === 'HEAD') return { status: 200, headers }
      return { status: 200, headers, stream: (await this.delivery.open(key)).stream }
    }
    catch {
      throw contentMediaFailure('MEDIA_STORAGE_UNAVAILABLE', '图片存储暂时不可用', 503)
    }
  }
}
