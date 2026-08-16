export type MediaValidationErrorCode =
  | 'MEDIA_CONTENT_INVALID'
  | 'MEDIA_CONTENT_STREAM_FAILED'
  | 'MEDIA_CONTENT_TOO_LARGE'
  | 'MEDIA_CONTENT_TYPE_MISMATCH'
  | 'MEDIA_CONTENT_UNSUPPORTED'
  | 'MEDIA_VALIDATION_CONFIGURATION_INVALID'
  | 'MEDIA_VALIDATOR_UNAVAILABLE'

const MEDIA_VALIDATION_ERROR_MESSAGES: Readonly<Record<MediaValidationErrorCode, string>> = {
  MEDIA_CONTENT_INVALID: 'Media content is invalid',
  MEDIA_CONTENT_STREAM_FAILED: 'Media content stream failed',
  MEDIA_CONTENT_TOO_LARGE: 'Media content exceeds the allowed size',
  MEDIA_CONTENT_TYPE_MISMATCH: 'Media content type does not match its declaration',
  MEDIA_CONTENT_UNSUPPORTED: 'Media content type is unsupported',
  MEDIA_VALIDATION_CONFIGURATION_INVALID: 'Media validation configuration is invalid',
  MEDIA_VALIDATOR_UNAVAILABLE: 'Media content validator is unavailable',
}

/**
 * Validator 只向调用方暴露稳定的低基数错误，不保留解析器、绝对路径或原始文件名。
 * 未来 HTTP 层可按 code 映射状态码，但不得直接透传第三方异常。
 */
export class MediaValidationError extends Error {
  readonly code: MediaValidationErrorCode

  constructor(code: MediaValidationErrorCode) {
    super(MEDIA_VALIDATION_ERROR_MESSAGES[code])
    this.name = 'MediaValidationError'
    this.code = code
  }
}

export type MediaContentType = 'DOCUMENT' | 'IMAGE' | 'VIDEO'

const MEBIBYTE = 1024n * 1024n

/** 流式写入和最终 parser 必须复用同一份上限，避免两个边界随维护产生漂移。 */
export const MEDIA_CONTENT_SIZE_LIMITS: Readonly<Record<MediaContentType, bigint>> =
  Object.freeze({
    DOCUMENT: 50n * MEBIBYTE,
    IMAGE: 10n * MEBIBYTE,
    VIDEO: 500n * MEBIBYTE,
  })

export interface MediaContentValidationInput {
  readonly declaredMimeType: string
  readonly expectedMediaType: MediaContentType
  readonly originalFilename: string
  readonly sourcePath: string
}

interface BaseValidatedMediaContent {
  readonly canonicalExtension: '.docx' | '.jpg' | '.mp4' | '.pdf' | '.png' | '.webp' | '.xlsx'
  readonly checksumSha256: string
  readonly mediaType: MediaContentType
  readonly mimeType: string
  readonly sizeBytes: bigint
}

export interface ValidatedImageContent extends BaseValidatedMediaContent {
  readonly canonicalExtension: '.jpg' | '.png' | '.webp'
  readonly height: number
  readonly mediaType: 'IMAGE'
  readonly width: number
}

export interface ValidatedVideoContent extends BaseValidatedMediaContent {
  readonly audioCodec: 'aac' | null
  readonly canonicalExtension: '.mp4'
  readonly durationMs: number
  readonly height: number
  readonly mediaType: 'VIDEO'
  readonly videoCodec: 'h264' | 'hevc'
  readonly width: number
}

export interface ValidatedDocumentContent extends BaseValidatedMediaContent {
  readonly canonicalExtension: '.docx' | '.pdf' | '.xlsx'
  readonly mediaType: 'DOCUMENT'
}

export type ValidatedMediaContent =
  | ValidatedDocumentContent
  | ValidatedImageContent
  | ValidatedVideoContent
