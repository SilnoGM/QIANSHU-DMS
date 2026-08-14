import type {
  ProductListItemDto,
  ProductMediaItemDto,
} from '../../../../api/generated/types.gen'
import type {
  ProductMediaFileLike,
  ProductMediaKind,
  ProductMediaSafeFailure,
} from './product-media-common.logic'

export type ProductMediaUploadPhase
  = | 'conflict'
    | 'failed'
    | 'finalizing'
    | 'queued'
    | 'reconciling'
    | 'unknown'
    | 'uploading'

export interface ProductMediaUploadQueueItem {
  readonly failure?: ProductMediaSafeFailure
  readonly id: string
  readonly kind: ProductMediaKind
  readonly loadedBytes: number
  readonly mimeType: string
  readonly originalFilename: string
  readonly phase: ProductMediaUploadPhase
  readonly previewUrl: string
  readonly totalBytes: number
}

export interface ProductMediaUploadReconciliationContext {
  readonly existingMediaIds: readonly string[]
  readonly expectedVersion: number
  readonly kind: ProductMediaKind
  readonly originalFilename: string
  readonly sizeBytes: number
}

export type ProductMediaUploadReconciliationResult
  = | {
    readonly media: ProductMediaItemDto
    readonly outcome: 'success'
  }
  | {
    readonly outcome: 'unknown'
  }

function freezeQueueItem(
  item: ProductMediaUploadQueueItem,
): ProductMediaUploadQueueItem {
  return Object.freeze(item)
}

export function createProductMediaUploadQueueItem(input: {
  readonly file: ProductMediaFileLike
  readonly id: string
  readonly kind: ProductMediaKind
  readonly previewUrl: string
}): ProductMediaUploadQueueItem {
  if (input.id.trim() === '' || input.previewUrl.trim() === '') {
    throw new TypeError('上传队列需要 stable ID 与 Object URL')
  }
  if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0) {
    throw new TypeError('上传文件大小必须是正安全整数')
  }
  return freezeQueueItem({
    id: input.id,
    kind: input.kind,
    loadedBytes: 0,
    mimeType: input.file.type,
    originalFilename: input.file.name,
    phase: 'queued',
    previewUrl: input.previewUrl,
    totalBytes: input.file.size,
  })
}

export function beginProductMediaUpload(
  item: ProductMediaUploadQueueItem,
): ProductMediaUploadQueueItem {
  if (item.phase !== 'queued') {
    throw new TypeError('只有排队中的文件可以开始上传')
  }
  return freezeQueueItem({ ...item, phase: 'uploading' })
}

/** 进度只消费 Axios 上报的 loaded bytes，不按时间或定时器制造伪进度。 */
export function recordProductMediaUploadProgress(
  item: ProductMediaUploadQueueItem,
  loadedBytes: number,
): ProductMediaUploadQueueItem {
  if (item.phase !== 'uploading') {
    throw new TypeError('只有上传中的文件可以更新进度')
  }
  if (!Number.isSafeInteger(loadedBytes) || loadedBytes < 0) {
    throw new TypeError('上传进度必须是非负安全整数')
  }
  return freezeQueueItem({
    ...item,
    loadedBytes: Math.min(loadedBytes, item.totalBytes),
  })
}

/** bytes 传输结束后的服务端验证阶段保持最后真实进度，不伪造 100%。 */
export function markProductMediaUploadFinalizing(
  item: ProductMediaUploadQueueItem,
): ProductMediaUploadQueueItem {
  if (item.phase !== 'uploading') {
    throw new TypeError('只有上传中的文件可以进入 finalizing')
  }
  return freezeQueueItem({ ...item, phase: 'finalizing' })
}

export function resolveProductMediaUploadFailure(
  item: ProductMediaUploadQueueItem,
  failure: ProductMediaSafeFailure,
): ProductMediaUploadQueueItem {
  if (item.phase !== 'uploading' && item.phase !== 'finalizing') {
    throw new TypeError('只有进行中的上传可以处理失败结果')
  }
  const phase = failure.outcome === 'conflict'
    ? 'conflict'
    : failure.outcome === 'unknown'
      ? 'reconciling'
      : 'failed'
  return freezeQueueItem({ ...item, failure, phase })
}

export function markProductMediaUploadUnknown(
  item: ProductMediaUploadQueueItem,
): ProductMediaUploadQueueItem {
  if (item.phase !== 'reconciling') {
    throw new TypeError('只有对账中的上传可以标记为结果未知')
  }
  return freezeQueueItem({ ...item, phase: 'unknown' })
}

/**
 * retry 只能由失败项的明确用户操作触发。conflict/unknown 必须先刷新产品并
 * 由用户决策，不能把旧 File 自动重传。
 */
export function retryProductMediaUpload(
  item: ProductMediaUploadQueueItem,
): ProductMediaUploadQueueItem {
  if (item.phase === 'unknown' || item.phase === 'reconciling') {
    throw new TypeError('上传结果未知时禁止重试文件')
  }
  if (item.phase !== 'failed') {
    throw new TypeError('只有明确失败的上传可以重试')
  }
  const { failure: _failure, ...rest } = item
  return freezeQueueItem({
    ...rest,
    loadedBytes: 0,
    phase: 'queued',
  })
}

function currentMediaItems(product: ProductListItemDto): ProductMediaItemDto[] {
  return [...product.media.images, ...product.media.videos]
}

/**
 * 上传 mutation 的网络/5xx 结果只通过 GET 对账：Product version 必须精确
 * 前进一次，并且只能新增一个同时匹配 kind、原文件名和字节数的关联。
 */
export function reconcileProductMediaUploadResult(
  context: ProductMediaUploadReconciliationContext,
  actual: ProductListItemDto,
): ProductMediaUploadReconciliationResult {
  if (actual.version !== context.expectedVersion + 1) {
    return Object.freeze({ outcome: 'unknown' })
  }
  const existingIds = new Set(context.existingMediaIds)
  if (existingIds.size !== context.existingMediaIds.length) {
    return Object.freeze({ outcome: 'unknown' })
  }
  const candidates = currentMediaItems(actual).filter(item =>
    !existingIds.has(item.id)
    && item.kind === context.kind
    && item.originalFilename === context.originalFilename
    && item.sizeBytes === String(context.sizeBytes))
  return candidates.length === 1
    ? Object.freeze({ media: candidates[0]!, outcome: 'success' })
    : Object.freeze({ outcome: 'unknown' })
}
