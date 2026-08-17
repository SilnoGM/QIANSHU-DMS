import type { ProductListItemDto } from '../../../../api/generated/types.gen'
import type { ProductMediaSafeFailure } from './product-media-common.logic'
import type { ProductMediaLayoutEditorState } from './product-media-layout.logic'
import type { ProductMediaUploadQueueItem } from './product-media-upload.logic'

import { createProductMediaLayoutEditor } from './product-media-layout.logic'

export * from './product-media-common.logic'
export * from './product-media-layout.logic'
export * from './product-media-upload.logic'

export interface ProductMediaActiveSessionState {
  readonly failure?: ProductMediaSafeFailure
  readonly layout: ProductMediaLayoutEditorState
  readonly phase: 'active'
  readonly product: ProductListItemDto
  readonly queue: readonly ProductMediaUploadQueueItem[]
}

export interface ProductMediaEmptySessionState {
  readonly layout: null
  readonly phase: 'empty'
  readonly product: null
  readonly queue: readonly []
}

export type ProductMediaSessionState
  = | ProductMediaActiveSessionState
    | ProductMediaEmptySessionState

export interface ProductMediaResponseGuardInput {
  readonly aborted: boolean
  readonly authEpoch: number
  readonly authorized: boolean
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

function withProductMediaQueue(
  state: ProductMediaActiveSessionState,
  queue: readonly ProductMediaUploadQueueItem[],
): ProductMediaActiveSessionState {
  return Object.freeze({
    ...(state.failure === undefined ? {} : { failure: state.failure }),
    layout: state.layout,
    phase: 'active',
    product: state.product,
    queue: Object.freeze([...queue]),
  })
}

export function createProductMediaSessionState(
  product: ProductListItemDto,
  options: {
    readonly failure?: ProductMediaSafeFailure
    readonly queue?: readonly ProductMediaUploadQueueItem[]
  } = {},
): ProductMediaActiveSessionState {
  return Object.freeze({
    ...(options.failure === undefined ? {} : { failure: options.failure }),
    layout: createProductMediaLayoutEditor(product),
    phase: 'active',
    product,
    queue: Object.freeze([...(options.queue ?? [])]),
  })
}

/** 身份或权限边界清理后不保留 Product、layout snapshot、queue 或错误。 */
export function createEmptyProductMediaSessionState(): ProductMediaEmptySessionState {
  return Object.freeze({
    layout: null,
    phase: 'empty',
    product: null,
    queue: Object.freeze([]) as readonly [],
  })
}

export function appendProductMediaUploadQueueItem(
  state: ProductMediaActiveSessionState,
  item: ProductMediaUploadQueueItem,
): ProductMediaActiveSessionState {
  if (state.queue.some(current => current.id === item.id)) {
    throw new TypeError('上传队列 stable ID 不能重复')
  }
  return withProductMediaQueue(state, [...state.queue, item])
}

export function updateProductMediaUploadQueueItem(
  state: ProductMediaActiveSessionState,
  item: ProductMediaUploadQueueItem,
): ProductMediaActiveSessionState {
  const index = state.queue.findIndex(current => current.id === item.id)
  if (index < 0) {
    throw new TypeError('只能更新当前上传队列中的 stable ID')
  }
  const queue = [...state.queue]
  queue[index] = item
  return withProductMediaQueue(state, queue)
}

export function removeProductMediaUploadQueueItem(
  state: ProductMediaActiveSessionState,
  queueId: string,
): ProductMediaActiveSessionState {
  if (!state.queue.some(item => item.id === queueId)) {
    throw new TypeError('只能移除当前上传队列中的 stable ID')
  }
  return withProductMediaQueue(
    state,
    state.queue.filter(item => item.id !== queueId),
  )
}

/**
 * 成功 mutation 返回的 Product 是新的服务端事实。只有布局仍为 ready 时才能
 * 整体替换；若用户已有 dirty 意图，调用方必须走冲突/对账而不是静默覆盖。
 */
export function applyProductMediaServerSnapshot(
  state: ProductMediaActiveSessionState,
  product: ProductListItemDto,
  options: { readonly removeQueueId?: string } = {},
): ProductMediaActiveSessionState {
  if (state.layout.phase !== 'ready') {
    throw new TypeError('本地布局未保存时不能覆盖服务端媒体快照')
  }
  const queue = options.removeQueueId === undefined
    ? state.queue
    : state.queue.filter(item => item.id !== options.removeQueueId)
  if (
    options.removeQueueId !== undefined
    && queue.length === state.queue.length
  ) {
    throw new TypeError('成功响应必须对应当前上传队列 stable ID')
  }
  return Object.freeze({
    layout: createProductMediaLayoutEditor(product),
    phase: 'active',
    product,
    queue: Object.freeze([...queue]),
  })
}

export function canApplyProductMediaResponse(
  input: ProductMediaResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}
