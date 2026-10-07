import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { MediaConfiguration } from '../../config/media.config'
import type { Prisma } from '../../generated/prisma/client'
import { MediaType } from '../../generated/prisma/enums'
import type { MediaContentValidator } from './media-content-validator'
import {
  buildMediaObjectKey,
  type MediaStoragePool,
  MediaObjectKeyError,
} from './media-object-key'
import type { MediaStorage, StagingWrite } from './media-storage'
import { MediaStorageError } from './media-storage'
import {
  MEDIA_ASSET_FAILURE_CODES,
  type MediaAssetFailureCode,
  type MediaAssetPersistence,
} from './media-asset.persistence'
import {
  MEDIA_CONTENT_SIZE_LIMITS,
  type MediaContentType,
  MediaValidationError,
  type ValidatedMediaContent,
} from './media-validation'
import { createMediaStreamGuard } from './media-stream-guard'

export type MediaAssetLifecycleErrorCode =
  | 'MEDIA_ASSET_CONTENT_INVALID'
  | 'MEDIA_ASSET_CONTENT_TOO_LARGE'
  | 'MEDIA_ASSET_CONTENT_TYPE_MISMATCH'
  | 'MEDIA_ASSET_CONTENT_UNSUPPORTED'
  | 'MEDIA_ASSET_INPUT_INVALID'
  | 'MEDIA_ASSET_PERSISTENCE_FAILED'
  | 'MEDIA_ASSET_STATE_CONFLICT'
  | 'MEDIA_ASSET_STORAGE_FAILED'
  | 'MEDIA_ASSET_STREAM_FAILED'
  | 'MEDIA_ASSET_TYPE_NOT_ALLOWED'
  | 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE'

const ERROR_MESSAGES: Readonly<Record<MediaAssetLifecycleErrorCode, string>> = {
  MEDIA_ASSET_CONTENT_INVALID: 'Media asset content is invalid',
  MEDIA_ASSET_CONTENT_TOO_LARGE: 'Media asset content exceeds the allowed size',
  MEDIA_ASSET_CONTENT_TYPE_MISMATCH: 'Media asset content type does not match',
  MEDIA_ASSET_CONTENT_UNSUPPORTED: 'Media asset content type is unsupported',
  MEDIA_ASSET_INPUT_INVALID: 'Media asset input is invalid',
  MEDIA_ASSET_PERSISTENCE_FAILED: 'Media asset persistence failed',
  MEDIA_ASSET_STATE_CONFLICT: 'Media asset state conflict',
  MEDIA_ASSET_STORAGE_FAILED: 'Media asset storage failed',
  MEDIA_ASSET_STREAM_FAILED: 'Media asset stream failed',
  MEDIA_ASSET_TYPE_NOT_ALLOWED: 'Media asset type is not allowed',
  MEDIA_ASSET_VALIDATOR_UNAVAILABLE: 'Media asset validator is unavailable',
}

export class MediaAssetLifecycleError extends Error {
  readonly code: MediaAssetLifecycleErrorCode

  constructor(code: MediaAssetLifecycleErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'MediaAssetLifecycleError'
    this.code = code
  }
}

export interface PrepareMediaAssetInput {
  readonly actorUserId: string
  readonly allowedTypes: readonly MediaType[]
  readonly declaredMimeType: string | null
  readonly originalFilename: string
  /**
   * 目标业务池，必须是上传瞬间就能确定的粗分类。
   *
   * 它决定对象键，而键在 READY 之后不可改写，因此调用方必须在调用前判定完毕；同一个 HTTP 入口
   * 可能服务多个池时（例如采购付款凭证与普通凭证共用上传器），必须按请求语义分支。
   */
  readonly pool: MediaStoragePool
  readonly requestedType: MediaType
  readonly stream: Readable
}

export interface PreparedMediaAsset {
  readonly id: string
  readonly mediaType: MediaType
  readonly objectKey: string
  readonly trustedMetadata: ValidatedMediaContent
}

export interface MediaAssetServiceDependencies {
  readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: MediaAssetServiceDependencies = {
  now: () => new Date(),
}

function asContentType(mediaType: MediaType): MediaContentType {
  return mediaType
}

function sanitizeDisplayFilename(value: string): string {
  if (typeof value !== 'string') {
    throw new MediaAssetLifecycleError('MEDIA_ASSET_INPUT_INVALID')
  }
  const leaf = value.split(/[\\/]/u).at(-1) ?? ''
  const safe = leaf
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
  const characters = Array.from(safe || 'file')
  if (characters.length <= 255) return characters.join('')

  const extensionIndex = safe.lastIndexOf('.')
  const extension = extensionIndex > 0
    ? Array.from(safe.slice(extensionIndex))
    : []
  const boundedExtension = extension.length <= 32 ? extension : []
  return [
    ...characters.slice(0, 255 - boundedExtension.length),
    ...boundedExtension,
  ].join('')
}

function uploadExpiry(now: Date, hours: number): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new MediaAssetLifecycleError('MEDIA_ASSET_INPUT_INVALID')
  }
  return new Date(now.getTime() + hours * 60 * 60 * 1_000)
}

/**
 * 键里的年月取自 prepare 时刻的 UTC 时间，与 staging 过期时间同源；池与环境来自调用方与部署配置。
 * 键生成失败（非法池、非法环境或非法资产标识）一律归为输入无效，不把它当成存储故障。
 */
function resolveObjectKey(
  input: {
    readonly assetId: string
    readonly canonicalExtension: ValidatedMediaContent['canonicalExtension']
    readonly now: Date
    readonly pool: MediaStoragePool
    readonly storageEnvironment: MediaConfiguration['storageEnvironment']
  },
): string {
  try {
    return buildMediaObjectKey(input)
  }
  catch (error) {
    if (error instanceof MediaObjectKeyError) {
      throw new MediaAssetLifecycleError('MEDIA_ASSET_INPUT_INVALID')
    }
    throw error
  }
}

function lifecycleFromValidation(error: MediaValidationError): MediaAssetLifecycleError {
  const mapping: Readonly<Record<MediaValidationError['code'], MediaAssetLifecycleErrorCode>> = {
    MEDIA_CONTENT_INVALID: 'MEDIA_ASSET_CONTENT_INVALID',
    MEDIA_CONTENT_STREAM_FAILED: 'MEDIA_ASSET_STREAM_FAILED',
    MEDIA_CONTENT_TOO_LARGE: 'MEDIA_ASSET_CONTENT_TOO_LARGE',
    MEDIA_CONTENT_TYPE_MISMATCH: 'MEDIA_ASSET_CONTENT_TYPE_MISMATCH',
    MEDIA_CONTENT_UNSUPPORTED: 'MEDIA_ASSET_CONTENT_UNSUPPORTED',
    MEDIA_VALIDATION_CONFIGURATION_INVALID: 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE',
    MEDIA_VALIDATOR_UNAVAILABLE: 'MEDIA_ASSET_VALIDATOR_UNAVAILABLE',
  }
  return new MediaAssetLifecycleError(mapping[error.code])
}

function isMediaAssetFailureCode(value: string): value is MediaAssetFailureCode {
  return (MEDIA_ASSET_FAILURE_CODES as readonly string[]).includes(value)
}

/**
 * 文件准备与领域激活严格分离：prepare 只把可信内容放入最终目录并保持 UPLOADING；
 * activate 必须复用调用方事务，让 deferred reference trigger 在提交时验证真实领域引用。
 */
export class MediaAssetService {
  private readonly dependencies: MediaAssetServiceDependencies

  constructor(
    private readonly persistence: MediaAssetPersistence,
    private readonly storage: MediaStorage,
    private readonly validator: MediaContentValidator,
    private readonly configuration: MediaConfiguration,
    dependencyOverrides: Partial<MediaAssetServiceDependencies> = {},
  ) {
    this.dependencies = Object.freeze({
      ...DEFAULT_DEPENDENCIES,
      ...dependencyOverrides,
    })
  }

  async prepare(input: PrepareMediaAssetInput): Promise<PreparedMediaAsset> {
    this.requireAllowedType(input.requestedType, input.allowedTypes)
    const now = this.dependencies.now()
    const originalFilename = sanitizeDisplayFilename(input.originalFilename)
    let assetId: string
    try {
      const created = await this.persistence.createUploading({
        actorUserId: input.actorUserId,
        mediaType: input.requestedType,
        originalFilename,
        uploadExpiresAt: uploadExpiry(now, this.configuration.stagingTtlHours),
      })
      assetId = created.id
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) throw error
      throw new MediaAssetLifecycleError('MEDIA_ASSET_PERSISTENCE_FAILED')
    }

    let staging: StagingWrite | undefined
    try {
      staging = await this.storage.createStagingWrite(assetId)
      const guard = createMediaStreamGuard(
        MEDIA_CONTENT_SIZE_LIMITS[asContentType(input.requestedType)],
      )
      try {
        await pipeline(input.stream, guard.stream, staging.stream)
      }
      catch (error) {
        if (error instanceof MediaValidationError) throw lifecycleFromValidation(error)
        throw new MediaAssetLifecycleError('MEDIA_ASSET_STREAM_FAILED')
      }
      const digest = await guard.completion

      let trustedMetadata: ValidatedMediaContent
      try {
        trustedMetadata = await this.storage.withStagingValidationSource(
          staging.key,
          sourcePath => this.validator.validate({
            declaredMimeType: input.declaredMimeType ?? '',
            expectedMediaType: asContentType(input.requestedType),
            originalFilename,
            sourcePath,
          }),
        )
      }
      catch (error) {
        if (error instanceof MediaValidationError) throw lifecycleFromValidation(error)
        if (error instanceof MediaStorageError) {
          throw new MediaAssetLifecycleError('MEDIA_ASSET_STORAGE_FAILED')
        }
        throw new MediaAssetLifecycleError('MEDIA_ASSET_VALIDATOR_UNAVAILABLE')
      }
      if (
        trustedMetadata.mediaType !== input.requestedType ||
        trustedMetadata.sizeBytes !== digest.sizeBytes ||
        trustedMetadata.checksumSha256 !== digest.checksumSha256
      ) {
        throw new MediaAssetLifecycleError('MEDIA_ASSET_CONTENT_INVALID')
      }

      const objectKey = resolveObjectKey({
        assetId,
        canonicalExtension: trustedMetadata.canonicalExtension,
        now,
        pool: input.pool,
        storageEnvironment: this.configuration.storageEnvironment,
      })
      let materialized: boolean
      try {
        materialized = await this.persistence.markPrepared({
          assetId,
          objectKey,
          trustedMetadata,
        })
      }
      catch {
        throw new MediaAssetLifecycleError('MEDIA_ASSET_PERSISTENCE_FAILED')
      }
      if (!materialized) {
        throw new MediaAssetLifecycleError('MEDIA_ASSET_STATE_CONFLICT')
      }

      try {
        await this.storage.finalize(staging.key, objectKey)
        // 校验强度由驱动决定：本地回读全文，对象存储用长度 + 上传时写入的摘要，
        // 元数据缺失时回退为回读全文。写入失败或校验不通过都必须失败关闭。
        const verified = await this.storage.verifyStoredObject(objectKey, {
          checksumSha256: digest.checksumSha256,
          sizeBytes: digest.sizeBytes,
        })
        if (!verified) {
          throw new MediaAssetLifecycleError('MEDIA_ASSET_STORAGE_FAILED')
        }
      }
      catch (error) {
        if (error instanceof MediaAssetLifecycleError) throw error
        throw new MediaAssetLifecycleError('MEDIA_ASSET_STORAGE_FAILED')
      }

      return Object.freeze({
        id: assetId,
        mediaType: input.requestedType,
        objectKey,
        trustedMetadata: Object.freeze({ ...trustedMetadata }),
      })
    }
    catch (error) {
      const lifecycleError = error instanceof MediaAssetLifecycleError
        ? error
        : new MediaAssetLifecycleError('MEDIA_ASSET_STORAGE_FAILED')
      await staging?.cancel().catch(() => undefined)
      try {
        const failureCode = isMediaAssetFailureCode(lifecycleError.code)
          ? lifecycleError.code
          : 'MEDIA_ASSET_PERSISTENCE_FAILED'
        await this.persistence.failUploading(
          assetId,
          failureCode,
        )
      }
      catch {
        throw new MediaAssetLifecycleError('MEDIA_ASSET_PERSISTENCE_FAILED')
      }
      throw lifecycleError
    }
  }

  async activate(
    transaction: Prisma.TransactionClient,
    assetId: string,
  ): Promise<void> {
    try {
      const result = await this.persistence.activate(transaction, assetId)
      if (result === 'ACTIVATED' || result === 'ALREADY_READY') return
      throw new MediaAssetLifecycleError('MEDIA_ASSET_STATE_CONFLICT')
    }
    catch (error) {
      if (error instanceof MediaAssetLifecycleError) throw error
      throw new MediaAssetLifecycleError('MEDIA_ASSET_PERSISTENCE_FAILED')
    }
  }

  async fail(assetId: string, failureCode: MediaAssetFailureCode): Promise<void> {
    if (!(MEDIA_ASSET_FAILURE_CODES as readonly string[]).includes(failureCode)) {
      throw new MediaAssetLifecycleError('MEDIA_ASSET_INPUT_INVALID')
    }
    try {
      await this.persistence.failUploading(assetId, failureCode)
    }
    catch {
      throw new MediaAssetLifecycleError('MEDIA_ASSET_PERSISTENCE_FAILED')
    }
  }

  private requireAllowedType(
    requestedType: MediaType,
    allowedTypes: readonly MediaType[],
  ): void {
    const supported = Object.values(MediaType).includes(requestedType)
    if (!supported || !allowedTypes.includes(requestedType)) {
      throw new MediaAssetLifecycleError('MEDIA_ASSET_TYPE_NOT_ALLOWED')
    }
  }
}
