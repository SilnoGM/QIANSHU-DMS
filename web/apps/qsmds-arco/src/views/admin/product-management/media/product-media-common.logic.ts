import type { ProductMediaItemDto } from '../../../../api/generated/types.gen'

export type ProductMediaKind = ProductMediaItemDto['kind']

export interface ProductMediaFileLike {
  readonly name: string
  readonly size: number
  readonly type: string
}

export interface ProductMediaSelectionCapacity {
  readonly currentImageCount: number
  readonly currentVideoCount: number
  readonly queuedImageCount: number
  readonly queuedVideoCount: number
}

export interface ProductMediaSafeFailure {
  readonly code: string | undefined
  readonly message: string
  readonly outcome: 'conflict' | 'known' | 'unknown'
  readonly requestId: string | undefined
}

export interface ProductMediaSelectionError {
  readonly code:
    | 'MEDIA_CONTENT_INVALID'
    | 'MEDIA_FILE_TOO_LARGE'
    | 'MEDIA_TYPE_UNSUPPORTED'
    | 'PRODUCT_MEDIA_DOCUMENT_UNSUPPORTED'
    | 'PRODUCT_MEDIA_LIMIT_EXCEEDED'
  readonly message: string
}

export type ProductVideoPreviewFailure = 'capability' | 'network'

export type ProductMediaSelectionResult
  = | {
    readonly accepted: true
    readonly kind: ProductMediaKind
  }
  | {
    readonly accepted: false
    readonly error: ProductMediaSelectionError
  }

export const MAX_PRODUCT_IMAGES = 20
export const MAX_PRODUCT_VIDEOS = 5
export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PRODUCT_VIDEO_BYTES = 500 * 1024 * 1024

const DOCUMENT_EXTENSIONS = new Set(['docx', 'pdf', 'xlsx'])
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const ISO_VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4'])
const ALLOWED_TYPE_PAIRS = new Map<string, {
  readonly extensions: ReadonlySet<string>
  readonly kind: ProductMediaKind
  readonly maxBytes: number
}>([
  ['image/jpeg', {
    extensions: new Set(['jpeg', 'jpg']),
    kind: 'IMAGE',
    maxBytes: MAX_PRODUCT_IMAGE_BYTES,
  }],
  ['image/png', {
    extensions: new Set(['png']),
    kind: 'IMAGE',
    maxBytes: MAX_PRODUCT_IMAGE_BYTES,
  }],
  ['image/webp', {
    extensions: new Set(['webp']),
    kind: 'IMAGE',
    maxBytes: MAX_PRODUCT_IMAGE_BYTES,
  }],
  ['video/mp4', {
    extensions: ISO_VIDEO_EXTENSIONS,
    kind: 'VIDEO',
    maxBytes: MAX_PRODUCT_VIDEO_BYTES,
  }],
  ['video/quicktime', {
    extensions: ISO_VIDEO_EXTENSIONS,
    kind: 'VIDEO',
    maxBytes: MAX_PRODUCT_VIDEO_BYTES,
  }],
  ['video/x-m4v', {
    extensions: ISO_VIDEO_EXTENSIONS,
    kind: 'VIDEO',
    maxBytes: MAX_PRODUCT_VIDEO_BYTES,
  }],
  ['video/webm', {
    extensions: new Set(['webm']),
    kind: 'VIDEO',
    maxBytes: MAX_PRODUCT_VIDEO_BYTES,
  }],
])

function selectionError(
  code: ProductMediaSelectionError['code'],
  message: string,
): ProductMediaSelectionResult {
  return Object.freeze({
    accepted: false,
    error: Object.freeze({ code, message }),
  })
}

function extensionOf(filename: string): string {
  const separator = filename.lastIndexOf('.')
  return separator <= 0 || separator === filename.length - 1
    ? ''
    : filename.slice(separator + 1).toLowerCase()
}

function assertCapacityCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} 必须是非负安全整数`)
  }
}

/**
 * 浏览器校验只提供即时反馈，Server 的 magic bytes、解码与 codec 校验仍是
 * 最终真相源。这里同时匹配 MIME 与扩展名，避免只改后缀或只伪造 MIME。
 */
export function validateProductMediaSelection(
  file: ProductMediaFileLike,
  capacity: ProductMediaSelectionCapacity,
): ProductMediaSelectionResult {
  assertCapacityCount(capacity.currentImageCount, 'currentImageCount')
  assertCapacityCount(capacity.currentVideoCount, 'currentVideoCount')
  assertCapacityCount(capacity.queuedImageCount, 'queuedImageCount')
  assertCapacityCount(capacity.queuedVideoCount, 'queuedVideoCount')

  const extension = extensionOf(file.name)
  const mimeType = file.type.toLowerCase()
  if (
    DOCUMENT_EXTENSIONS.has(extension)
    || DOCUMENT_MIME_TYPES.has(mimeType)
  ) {
    return selectionError(
      'PRODUCT_MEDIA_DOCUMENT_UNSUPPORTED',
      '产品媒体仅支持图片和视频',
    )
  }

  const rule = ALLOWED_TYPE_PAIRS.get(mimeType)
  if (rule === undefined || !rule.extensions.has(extension)) {
    return selectionError(
      'MEDIA_TYPE_UNSUPPORTED',
      '仅支持 JPEG、PNG、WebP 图片或 MP4、MOV、M4V、WebM 视频',
    )
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return selectionError('MEDIA_CONTENT_INVALID', '文件内容为空或大小无效')
  }
  if (file.size > rule.maxBytes) {
    return selectionError(
      'MEDIA_FILE_TOO_LARGE',
      rule.kind === 'IMAGE'
        ? '单张图片不得超过 10MiB'
        : '单个视频不得超过 500MiB',
    )
  }

  const used = rule.kind === 'IMAGE'
    ? capacity.currentImageCount + capacity.queuedImageCount
    : capacity.currentVideoCount + capacity.queuedVideoCount
  const maximum = rule.kind === 'IMAGE'
    ? MAX_PRODUCT_IMAGES
    : MAX_PRODUCT_VIDEOS
  if (used >= maximum) {
    return selectionError(
      'PRODUCT_MEDIA_LIMIT_EXCEEDED',
      rule.kind === 'IMAGE'
        ? '每个产品最多 20 张图片'
        : '每个产品最多 5 个视频',
    )
  }

  return Object.freeze({ accepted: true, kind: rule.kind })
}

/**
 * HTMLMediaElement error code 只用于展示降级，不改变媒体事实或上传状态。
 * aborted(1) 常由切换视频、关闭 Modal 或身份清理主动触发，因此不能残留为错误；
 * decode(3)/src-not-supported(4) 属于浏览器播放能力问题，其余值按加载失败安全处理。
 */
export function resolveProductVideoPreviewFailure(
  mediaErrorCode: unknown,
): ProductVideoPreviewFailure | null {
  if (mediaErrorCode === 1) {
    return null
  }
  if (mediaErrorCode === 3 || mediaErrorCode === 4) {
    return 'capability'
  }
  return 'network'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * API Client 已负责归一化错误，但页面边界仍按不可信值读取。只保留公开
 * error code、message 与 requestId，不复制 stack、路径或原始响应内容。
 */
export function getProductMediaMutationFailure(
  error: unknown,
): ProductMediaSafeFailure {
  const fallback = Object.freeze({
    code: undefined,
    message: '产品媒体操作失败，请稍后重试',
    outcome: 'known' as const,
    requestId: undefined,
  })
  try {
    if (!isRecord(error)) {
      return fallback
    }
    const status = typeof error.status === 'number' ? error.status : undefined
    const body = isRecord(error.body) ? error.body : undefined
    const code = typeof body?.code === 'string' ? body.code : undefined
    const message = typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : status === undefined || status >= 500
          ? '服务器状态暂不明确，请重新加载产品确认结果'
          : fallback.message
    const requestId = typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined
    const outcome = (
      status === 409
      && (
        code === 'PRODUCT_STATE_CHANGED'
        || code === 'PRODUCT_MEDIA_LAYOUT_CHANGED'
      )
    )
      ? 'conflict'
      : error.kind === 'network' || status === undefined || status >= 500
        ? 'unknown'
        : 'known'
    return Object.freeze({ code, message, outcome, requestId })
  }
  catch {
    return fallback
  }
}
