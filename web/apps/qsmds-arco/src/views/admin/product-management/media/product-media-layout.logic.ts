import type {
  ProductListItemDto,
  ProductMediaDto,
  ProductMediaItemDto,
  ProductMediaLayoutRequestDto,
} from '../../../../api/generated/types.gen'
import type {
  ProductMediaKind,
  ProductMediaSafeFailure,
} from './product-media-common.logic'

export interface ProductMediaLayoutSnapshot {
  readonly imageIds: readonly string[]
  readonly primaryImageId: string | null
  readonly videoIds: readonly string[]
}

export type ProductMediaLayoutPhase
  = | 'conflict'
    | 'dirty'
    | 'ready'
    | 'reconciling'
    | 'saving'
    | 'unknown'

export interface ProductMediaLayoutEditorState {
  readonly baseline: ProductMediaLayoutSnapshot
  readonly draft: ProductMediaLayoutSnapshot
  readonly failure?: ProductMediaSafeFailure
  readonly latest?: ProductMediaLayoutSnapshot
  readonly phase: ProductMediaLayoutPhase
  readonly sourceVersion: number
  readonly submission?: Readonly<ProductMediaLayoutRequestDto>
}

export interface ProductMediaDetachReconciliationContext {
  readonly expectedVersion: number
  readonly productMediaId: string
}

export type ProductMediaMutationReconciliationResult = Readonly<{
  outcome: 'success' | 'unknown'
}>

function freezeLayout(
  layout: ProductMediaLayoutSnapshot,
): ProductMediaLayoutSnapshot {
  return Object.freeze({
    imageIds: Object.freeze([...layout.imageIds]),
    primaryImageId: layout.primaryImageId,
    videoIds: Object.freeze([...layout.videoIds]),
  })
}

function freezeLayoutRequest(
  request: ProductMediaLayoutRequestDto,
): Readonly<ProductMediaLayoutRequestDto> {
  return Object.freeze({
    expectedVersion: request.expectedVersion,
    // generated DTO 使用可变 Array；运行时冻结不影响 JSON 序列化。
    imageIds: Object.freeze([...request.imageIds]) as string[],
    primaryImageId: request.primaryImageId,
    videoIds: Object.freeze([...request.videoIds]) as string[],
  })
}

function freezeEditor(
  state: ProductMediaLayoutEditorState,
): ProductMediaLayoutEditorState {
  return Object.freeze(state)
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  if (ids.some(id => id.trim() === '') || new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} 必须包含唯一非空 stable ID`)
  }
}

function assertOrderedItems(
  items: readonly ProductMediaItemDto[],
  kind: ProductMediaKind,
): void {
  items.forEach((item, index) => {
    if (item.kind !== kind || item.sortOrder !== index) {
      throw new TypeError(`${kind} 媒体必须按连续 sortOrder 返回`)
    }
    if (kind === 'VIDEO' && item.isPrimary) {
      throw new TypeError('视频不能成为产品主图')
    }
  })
}

function assertSameIdSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (
    actual.length !== expected.length
    || actual.some(id => !expected.includes(id))
  ) {
    throw new TypeError(`${label} 必须精确包含当前全部媒体 ID`)
  }
}

/**
 * DTO 到布局状态的唯一入口。任何重复 ID、非连续排序、视频主图或 mainImage
 * 投影漂移都会失败关闭，避免把不完整集合提交给原子 layout API。
 */
export function createProductMediaLayoutSnapshot(
  media: ProductMediaDto,
): ProductMediaLayoutSnapshot {
  assertOrderedItems(media.images, 'IMAGE')
  assertOrderedItems(media.videos, 'VIDEO')
  const imageIds = media.images.map(item => item.id)
  const videoIds = media.videos.map(item => item.id)
  assertUniqueIds(imageIds, 'imageIds')
  assertUniqueIds(videoIds, 'videoIds')
  if (imageIds.some(id => videoIds.includes(id))) {
    throw new TypeError('图片和视频不能共享 ProductMedia ID')
  }

  const primaryItems = media.images.filter(item => item.isPrimary)
  const primaryImageId = media.mainImage?.id ?? null
  if (
    (primaryImageId === null && primaryItems.length !== 0)
    || (
      primaryImageId !== null
      && (
        primaryItems.length !== 1
        || primaryItems[0]?.id !== primaryImageId
        || !imageIds.includes(primaryImageId)
        || media.mainImage?.kind !== 'IMAGE'
        || media.mainImage.isPrimary !== true
      )
    )
  ) {
    throw new TypeError('mainImage 必须与 images 中唯一主图投影一致')
  }

  return freezeLayout({ imageIds, primaryImageId, videoIds })
}

export function moveProductMediaLayoutItem(
  layout: ProductMediaLayoutSnapshot,
  kind: ProductMediaKind,
  productMediaId: string,
  targetIndex: number,
): ProductMediaLayoutSnapshot {
  const source = kind === 'IMAGE' ? layout.imageIds : layout.videoIds
  const sourceIndex = source.indexOf(productMediaId)
  if (
    sourceIndex < 0
    || !Number.isSafeInteger(targetIndex)
    || targetIndex < 0
    || targetIndex >= source.length
  ) {
    throw new TypeError('排序目标必须属于当前同类型媒体')
  }
  const reordered = [...source]
  reordered.splice(sourceIndex, 1)
  reordered.splice(targetIndex, 0, productMediaId)
  return freezeLayout(kind === 'IMAGE'
    ? { ...layout, imageIds: reordered }
    : { ...layout, videoIds: reordered })
}

export function setProductMediaPrimaryImage(
  layout: ProductMediaLayoutSnapshot,
  productMediaId: string | null,
): ProductMediaLayoutSnapshot {
  if (
    productMediaId !== null
    && !layout.imageIds.includes(productMediaId)
  ) {
    throw new TypeError('主图必须是当前图片')
  }
  return freezeLayout({ ...layout, primaryImageId: productMediaId })
}

export function buildProductMediaLayoutRequest(
  layout: ProductMediaLayoutSnapshot,
  expectedVersion: number,
): Readonly<ProductMediaLayoutRequestDto> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
    throw new TypeError('expectedVersion 必须是正安全整数')
  }
  assertUniqueIds(layout.imageIds, 'imageIds')
  assertUniqueIds(layout.videoIds, 'videoIds')
  if (
    layout.primaryImageId !== null
    && !layout.imageIds.includes(layout.primaryImageId)
  ) {
    throw new TypeError('主图必须是当前图片')
  }
  return freezeLayoutRequest({
    expectedVersion,
    imageIds: [...layout.imageIds],
    primaryImageId: layout.primaryImageId,
    videoIds: [...layout.videoIds],
  })
}

function sameLayout(
  left: ProductMediaLayoutSnapshot,
  right: ProductMediaLayoutSnapshot,
): boolean {
  return left.primaryImageId === right.primaryImageId
    && left.imageIds.length === right.imageIds.length
    && left.videoIds.length === right.videoIds.length
    && left.imageIds.every((id, index) => id === right.imageIds[index])
    && left.videoIds.every((id, index) => id === right.videoIds[index])
}

export function createProductMediaLayoutEditor(
  product: ProductListItemDto,
): ProductMediaLayoutEditorState {
  const baseline = createProductMediaLayoutSnapshot(product.media)
  return freezeEditor({
    baseline,
    draft: baseline,
    phase: 'ready',
    sourceVersion: product.version,
  })
}

export function updateProductMediaLayoutDraft(
  state: ProductMediaLayoutEditorState,
  draft: ProductMediaLayoutSnapshot,
): ProductMediaLayoutEditorState {
  if (state.phase !== 'ready' && state.phase !== 'dirty') {
    throw new TypeError('当前媒体布局状态不能继续编辑')
  }
  assertSameIdSet(draft.imageIds, state.baseline.imageIds, 'imageIds')
  assertSameIdSet(draft.videoIds, state.baseline.videoIds, 'videoIds')
  const safeDraft = freezeLayout(draft)
  return freezeEditor({
    baseline: state.baseline,
    draft: safeDraft,
    phase: sameLayout(safeDraft, state.baseline) ? 'ready' : 'dirty',
    sourceVersion: state.sourceVersion,
  })
}

export function beginProductMediaLayoutSave(
  state: ProductMediaLayoutEditorState,
): ProductMediaLayoutEditorState {
  if (state.phase !== 'dirty') {
    throw new TypeError('只有 dirty 布局可以保存')
  }
  return freezeEditor({
    ...state,
    phase: 'saving',
    submission: buildProductMediaLayoutRequest(
      state.draft,
      state.sourceVersion,
    ),
  })
}

export function resolveProductMediaLayoutFailure(
  state: ProductMediaLayoutEditorState,
  failure: ProductMediaSafeFailure,
): ProductMediaLayoutEditorState {
  if (state.phase !== 'saving' || state.submission === undefined) {
    throw new TypeError('只有保存中的布局可以处理失败')
  }
  if (failure.outcome === 'known') {
    return freezeEditor({
      baseline: state.baseline,
      draft: state.draft,
      failure,
      phase: 'dirty',
      sourceVersion: state.sourceVersion,
    })
  }
  return freezeEditor({
    ...state,
    failure,
    phase: failure.outcome === 'conflict' ? 'conflict' : 'reconciling',
  })
}

function layoutMatchesRequest(
  product: ProductListItemDto,
  request: Readonly<ProductMediaLayoutRequestDto>,
): boolean {
  if (product.version !== request.expectedVersion + 1) {
    return false
  }
  const actual = createProductMediaLayoutSnapshot(product.media)
  return sameLayout(actual, request)
}

/**
 * network/5xx 后只接受 GET 到的服务端事实。匹配则收敛为 ready；任何版本或
 * 布局差异都保留本地 draft 并进入 unknown，不产生自动重放动作。
 */
export function reconcileProductMediaLayoutResult(
  state: ProductMediaLayoutEditorState,
  actual: ProductListItemDto,
): ProductMediaLayoutEditorState {
  if (state.phase !== 'reconciling' || state.submission === undefined) {
    throw new TypeError('只有对账中的布局可以应用 GET 结果')
  }
  if (layoutMatchesRequest(actual, state.submission)) {
    return createProductMediaLayoutEditor(actual)
  }
  return freezeEditor({
    ...state,
    latest: createProductMediaLayoutSnapshot(actual.media),
    phase: 'unknown',
  })
}

function allMediaIds(product: ProductListItemDto): string[] {
  return [
    ...product.media.images.map(item => item.id),
    ...product.media.videos.map(item => item.id),
  ]
}

export function reconcileProductMediaDetachResult(
  context: ProductMediaDetachReconciliationContext,
  actual: ProductListItemDto,
): ProductMediaMutationReconciliationResult {
  return Object.freeze({
    outcome: actual.version === context.expectedVersion + 1
      && !allMediaIds(actual).includes(context.productMediaId)
      ? 'success'
      : 'unknown',
  })
}
