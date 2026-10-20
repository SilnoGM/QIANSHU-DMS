import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AuthConfiguration } from '../../config/auth.config'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import { MediaAssetLifecycleError, MediaAssetService } from '../media/media-asset.service'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { MediaAssetRetentionService } from '../media/media-retention.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import {
  SalesOrderDocumentMultipartParser,
  type SalesOrderDocumentMultipartRequest,
} from '../sales-orders/documents/sales-order-document-multipart.parser'
import type { ProfileAvatarUploadDto } from './dto/profile-avatar.dto'
import {
  buildAvatarContentUrl,
  parseAvatarContentUrl,
  USER_AVATAR_UPLOAD_PURPOSE,
} from './profile-avatar.logic'

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_AVATAR_BYTES = 10n * 1024n * 1024n

export interface ProfileAvatarContent {
  headers: Record<string, string>
  status: number
  stream?: Readable
}

export interface ResolveProfileAvatarInput {
  /** 实际发起上传的用户；管理员代传头像时是管理员本人。 */
  actorUserId: string
  avatarUrl: string
  /** 头像最终归属的资料用户。 */
  targetUserId: string
}

function avatarFailure(
  code: string,
  message: string,
  status = 422,
): ApiException {
  return new ApiException(status, code, message)
}

/**
 * 头像上传只暂存，PATCH 资料时再激活。
 *
 * 复用现有媒体管线（multipart parser、MediaAssetService、内容投递、保留期回收），
 * 不新增存储驱动；差异只在用途标记、同源内容 URL 与资料引用绑定。
 */
@Injectable()
export class ProfileAvatarService {
  private readonly multipart = new SalesOrderDocumentMultipartParser()

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaAssetService,
    private readonly delivery: MediaContentDeliveryService,
    private readonly retention: MediaAssetRetentionService,
    private readonly config: ConfigService,
  ) {}

  private get appOrigin(): string {
    return this.config.getOrThrow<AuthConfiguration>('auth').appOrigin
  }

  async upload(
    actorUserId: string,
    request: SalesOrderDocumentMultipartRequest,
  ): Promise<ProfileAvatarUploadDto> {
    try {
      return await this.multipart.parse(request, async (input) => {
        if (
          input.mediaType !== 'IMAGE'
          || input.declaredMimeType === null
          || !MIME_TYPES.includes(input.declaredMimeType as typeof MIME_TYPES[number])
        ) {
          throw avatarFailure(
            'PROFILE_AVATAR_INVALID',
            '仅支持 JPEG、PNG、WebP 头像图片',
          )
        }

        const asset = await this.media.prepare({
          actorUserId,
          allowedTypes: ['IMAGE'],
          requestedType: 'IMAGE',
          declaredMimeType: input.declaredMimeType,
          originalFilename: input.originalFilename,
          pool: 'misc',
          stream: input.stream,
        })

        // 与其它专用上传一致：先保持 UPLOADING，只标记用途；激活发生在资料保存事务。
        const marked = await this.prisma.mediaAsset.updateMany({
          where: {
            id: asset.id,
            status: 'UPLOADING',
            createdByUserId: actorUserId,
            uploadPurpose: null,
          },
          data: { uploadPurpose: USER_AVATAR_UPLOAD_PURPOSE },
        })
        if (marked.count !== 1) {
          throw avatarFailure(
            'PROFILE_AVATAR_UNAVAILABLE',
            '头像上传状态已变化，请重新上传',
          )
        }

        return {
          mediaAssetId: asset.id,
          avatarUrl: buildAvatarContentUrl(this.appOrigin, asset.id),
        }
      })
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) {
        if (error.code === 'MEDIA_ASSET_CONTENT_TOO_LARGE') {
          throw avatarFailure('PROFILE_AVATAR_TOO_LARGE', '头像不能超过 10 MiB')
        }
        if (
          error.code === 'MEDIA_ASSET_STORAGE_FAILED'
          || error.code === 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE'
          || error.code === 'MEDIA_ASSET_PERSISTENCE_FAILED'
        ) {
          throw avatarFailure(
            'MEDIA_STORAGE_UNAVAILABLE',
            '头像存储暂时不可用',
            503,
          )
        }
        throw avatarFailure('PROFILE_AVATAR_INVALID', '头像内容无效，请重新选择')
      }
      if (error instanceof ApiException) {
        if (error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE') {          throw avatarFailure('PROFILE_AVATAR_TOO_LARGE', '头像不能超过 10 MiB')
        }
        if (error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID') {
          throw avatarFailure('PROFILE_AVATAR_INVALID', '每次只能上传一张头像图片')
        }
        throw error
      }
      throw avatarFailure('MEDIA_STORAGE_UNAVAILABLE', '头像存储暂时不可用', 503)
    }
  }

  async content(
    actorUserId: string,
    id: string,
    ifNoneMatch: unknown,
    method: 'GET' | 'HEAD',
  ): Promise<ProfileAvatarContent> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } })
    const missing = () => avatarFailure(
      'PROFILE_AVATAR_NOT_FOUND',
      '头像不存在或当前不可访问',
      404,
    )

    const mimeType = asset?.mimeType ?? null
    const objectKey = asset?.objectKey ?? null
    const checksum = asset?.checksumSha256 ?? null
    if (
      !asset
      || asset.deletedAt !== null
      || asset.uploadPurpose !== USER_AVATAR_UPLOAD_PURPOSE
      || asset.mediaType !== 'IMAGE'
      || !mimeType
      || !MIME_TYPES.includes(mimeType as typeof MIME_TYPES[number])
      || !objectKey
      || !checksum
      || !asset.sizeBytes
    ) {
      throw missing()
    }

    if (asset.status === 'UPLOADING') {
      if (
        asset.createdByUserId !== actorUserId
        || asset.uploadExpiresAt === null
        || asset.uploadExpiresAt <= new Date()
      ) {
        throw missing()
      }
    }
    else if (asset.status !== 'READY') {
      throw missing()
    }

    const key = requireMediaObjectKeyNamespace(objectKey, 'assets')
    const etag = `"sha256-${createHash('sha256').update(`user-avatar:${checksum}`).digest('base64url')}"`
    const filename = asset.originalFilename
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/[^A-Za-z0-9._ -]/gu, '_')
      .slice(0, 180) || 'avatar'
    const headers: Record<string, string> = {
      'Accept-Ranges': 'none',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Type': mimeType,
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
    }

    if (
      typeof ifNoneMatch === 'string'
      && ifNoneMatch.split(',').some(value =>
        value.trim().replace(/^W\//u, '') === etag,
      )
    ) {
      return { status: 304, headers }
    }

    try {
      const stat = await this.delivery.stat(key)
      if (!stat) {
        throw new Error('Missing avatar object')
      }
      headers['Content-Length'] = stat.sizeBytes.toString()
      if (this.delivery.mode === 'internal_redirect') {
        headers['X-Accel-Redirect'] = `/_qianshu_internal_media/${key.split('/').map(encodeURIComponent).join('/')}`
        return { status: 200, headers }
      }
      return method === 'HEAD'
        ? { status: 200, headers }
        : { status: 200, headers, stream: (await this.delivery.open(key)).stream }
    }
    catch {
      throw avatarFailure(
        'MEDIA_STORAGE_UNAVAILABLE',
        '头像存储暂时不可用',
        503,
      )
    }
  }

  /**
   * 只认本系统生成的内容 URL；外部 URL 返回 null，由调用方按存量外链处理。
   * UPLOADING 只允许上传者本人绑定；READY 只允许同一 profile 的幂等重放。
   */
  async resolveUploadedAsset(
    transaction: Prisma.TransactionClient,
    input: ResolveProfileAvatarInput,
  ): Promise<string | null> {
    const assetId = parseAvatarContentUrl(input.avatarUrl, this.appOrigin)
    if (assetId === null) {
      return null
    }

    const [asset, profile, boundElsewhere] = await Promise.all([
      transaction.mediaAsset.findUnique({
        where: { id: assetId },
        select: {
          checksumSha256: true,
          createdByUserId: true,
          deletedAt: true,
          id: true,
          mediaType: true,
          mimeType: true,
          objectKey: true,
          sizeBytes: true,
          status: true,
          uploadExpiresAt: true,
          uploadPurpose: true,
        },
      }),
      transaction.userProfile.findUnique({
        where: { userId: input.targetUserId },
        select: { avatarMediaAssetId: true },
      }),
      transaction.userProfile.findFirst({
        where: {
          avatarMediaAssetId: assetId,
          NOT: { userId: input.targetUserId },
        },
        select: { userId: true },
      }),
    ])

    const unavailable = () => avatarFailure(
      'PROFILE_AVATAR_UNAVAILABLE',
      '头像暂时不可用，请重新上传',
    )

    const mimeType = asset?.mimeType ?? null
    if (
      !asset
      || asset.deletedAt !== null
      || asset.mediaType !== 'IMAGE'
      || asset.uploadPurpose !== USER_AVATAR_UPLOAD_PURPOSE
      || !mimeType
      || !MIME_TYPES.includes(mimeType as typeof MIME_TYPES[number])
      || !asset.objectKey
      || !asset.checksumSha256
      || !asset.sizeBytes
      || asset.sizeBytes <= 0n
      || asset.sizeBytes > MAX_AVATAR_BYTES
      || boundElsewhere !== null
    ) {
      throw unavailable()
    }

    if (asset.status === 'UPLOADING') {
      if (asset.createdByUserId !== input.actorUserId) {
        throw unavailable()
      }
      if (asset.uploadExpiresAt === null || asset.uploadExpiresAt <= new Date()) {
        throw avatarFailure('PROFILE_AVATAR_EXPIRED', '头像上传已过期，请重新上传')
      }
      return asset.id
    }

    if (asset.status === 'READY' && profile?.avatarMediaAssetId === asset.id) {
      return asset.id
    }

    throw unavailable()
  }

  async activate(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<void> {
    try {
      await this.media.activate(transaction, assetId)
    }
    catch {
      throw avatarFailure(
        'PROFILE_AVATAR_UNAVAILABLE',
        '头像暂时不可用，请重新上传',
      )
    }
  }

  async reclaim(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<void> {
    await this.retention.markUnreferencedForTrash(transaction, assetId)
  }
}
