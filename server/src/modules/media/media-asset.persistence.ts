import type { Prisma } from '../../generated/prisma/client'
import {
  MediaAssetStatus,
  type MediaType,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { ValidatedMediaContent } from './media-validation'

export const MEDIA_ASSET_FAILURE_CODES = Object.freeze([
  'MEDIA_ASSET_CONTENT_INVALID',
  'MEDIA_ASSET_CONTENT_TOO_LARGE',
  'MEDIA_ASSET_CONTENT_TYPE_MISMATCH',
  'MEDIA_ASSET_CONTENT_UNSUPPORTED',
  'MEDIA_ASSET_DOMAIN_TRANSACTION_FAILED',
  'MEDIA_ASSET_PERSISTENCE_FAILED',
  'MEDIA_ASSET_STATE_CONFLICT',
  'MEDIA_ASSET_STORAGE_FAILED',
  'MEDIA_ASSET_STREAM_FAILED',
  'MEDIA_ASSET_UPLOAD_EXPIRED',
  'MEDIA_ASSET_VALIDATOR_UNAVAILABLE',
] as const)

export type MediaAssetFailureCode = typeof MEDIA_ASSET_FAILURE_CODES[number]

export interface CreateUploadingMediaAssetInput {
  readonly actorUserId: string
  readonly mediaType: MediaType
  readonly originalFilename: string
  readonly uploadExpiresAt: Date
}

export interface PreparedMediaAssetPersistenceInput {
  readonly assetId: string
  readonly objectKey: string
  readonly trustedMetadata: ValidatedMediaContent
}

export type MediaAssetActivationResult =
  | 'ACTIVATED'
  | 'ALREADY_READY'
  | 'NOT_ACTIVATABLE'
  | 'NOT_FOUND'

/**
 * MediaAsset 的数据库写全部集中在此处，并使用旧状态条件更新。
 * 文件系统状态不在 persistence 内推断，领域引用也由未来各领域服务显式创建。
 */
export class MediaAssetPersistence {
  constructor(private readonly prisma: PrismaService) {}

  createUploading(
    input: CreateUploadingMediaAssetInput,
  ): Promise<{ readonly id: string }> {
    return this.prisma.mediaAsset.create({
      data: {
        audioCodec: null,
        checksumSha256: null,
        createdByUserId: input.actorUserId,
        durationMs: null,
        failureCode: null,
        height: null,
        mediaType: input.mediaType,
        mimeType: null,
        objectKey: null,
        originalFilename: input.originalFilename,
        retentionUntil: null,
        sizeBytes: null,
        status: MediaAssetStatus.UPLOADING,
        storageDriver: 'local',
        uploadExpiresAt: input.uploadExpiresAt,
        videoCodec: null,
        width: null,
      },
      select: { id: true },
    })
  }

  async markPrepared(input: PreparedMediaAssetPersistenceInput): Promise<boolean> {
    const metadata = input.trustedMetadata
    const result = await this.prisma.mediaAsset.updateMany({
      where: {
        id: input.assetId,
        objectKey: null,
        status: MediaAssetStatus.UPLOADING,
      },
      data: {
        audioCodec: metadata.mediaType === 'VIDEO' ? metadata.audioCodec : null,
        checksumSha256: metadata.checksumSha256,
        durationMs: metadata.mediaType === 'VIDEO' ? metadata.durationMs : null,
        failureCode: null,
        height: metadata.mediaType === 'DOCUMENT' ? null : metadata.height,
        mimeType: metadata.mimeType,
        objectKey: input.objectKey,
        sizeBytes: metadata.sizeBytes,
        videoCodec: metadata.mediaType === 'VIDEO' ? metadata.videoCodec : null,
        width: metadata.mediaType === 'DOCUMENT' ? null : metadata.width,
      },
    })
    return result.count === 1
  }

  async activate(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<MediaAssetActivationResult> {
    const activated = await transaction.mediaAsset.updateMany({
      where: {
        checksumSha256: { not: null },
        id: assetId,
        mimeType: { not: null },
        objectKey: { not: null },
        sizeBytes: { not: null },
        status: MediaAssetStatus.UPLOADING,
      },
      data: {
        failureCode: null,
        status: MediaAssetStatus.READY,
        uploadExpiresAt: null,
      },
    })
    if (activated.count === 1) return 'ACTIVATED'

    const current = await transaction.mediaAsset.findUnique({
      where: { id: assetId },
      select: { status: true },
    })
    if (!current) return 'NOT_FOUND'
    return current.status === MediaAssetStatus.READY
      ? 'ALREADY_READY'
      : 'NOT_ACTIVATABLE'
  }

  async failUploading(
    assetId: string,
    failureCode: MediaAssetFailureCode,
  ): Promise<boolean> {
    const result = await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, status: MediaAssetStatus.UPLOADING },
      data: {
        failureCode,
        status: MediaAssetStatus.FAILED,
      },
    })
    return result.count === 1
  }
}
