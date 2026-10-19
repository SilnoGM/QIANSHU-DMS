import type {
  ProductMediaFileLike,
  ProductMediaSafeFailure,
  ProductMediaSelectionError,
} from '../media/product-media-common.logic'
import type { ProductListItemViewModel } from './product-list.logic'
import type {
  ProductMediaLayoutRequestDto,
} from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

import { mediaThumbnailUrl } from '../../../../utils/media-variant'
import {
  MAX_PRODUCT_IMAGES,
  validateProductMediaSelection,
} from '../media/product-media-common.logic'
import { resolveProductMediaContentUrl } from './product-list.logic'

export const PRODUCT_BATCH_SELECTION_LIMIT = 50
export const PRODUCT_BATCH_SELECTION_COLUMN_ID = 'selection'

export type ProductBatchImagePhase
  = | 'failed'
    | 'idle'
    | 'main-failed'
    | 'ready'
    | 'reconciling'
    | 'setting-primary'
    | 'success'
    | 'unknown'
    | 'uploading'

export interface ProductBatchImageCardState {
  readonly failure: ProductMediaSafeFailure | null
  readonly file: ProductMediaFileLike | null
  readonly phase: ProductBatchImagePhase
  readonly previewUrl: string | null
  readonly product: ProductListItemViewModel
  readonly progress: number
  readonly selectionError: string | null
  readonly setAsPrimary: boolean
  readonly uploadedMediaId: string | null
}

export interface ProductBatchImageSummary {
  readonly blocked: number
  readonly failed: number
  readonly ready: number
  readonly retryable: number
  readonly setPrimary: number
  readonly skipped: number
  readonly succeeded: number
  readonly unknown: number
}

export interface ProductBatchRunResult {
  readonly failedProductIds: readonly string[]
  readonly primarySetCount: number
  readonly successfulProductIds: readonly string[]
  readonly unknownProductIds: readonly string[]
  readonly uploadedCount: number
}

export interface ProductBatchSelectionResult {
  readonly changed: boolean
  readonly selected: ReadonlyMap<string, ProductListItemViewModel>
}

export interface ProductBatchPageSelectionResult {
  readonly addedCount: number
  readonly limited: boolean
  readonly selected: ReadonlyMap<string, ProductListItemViewModel>
}

export interface ProductBatchFilePreparationResult {
  readonly card: ProductBatchImageCardState
  readonly error: ProductMediaSelectionError | null
}

export type ProductBatchPageSelectionState = boolean | 'indeterminate'

export function createProductBatchImageCard(
  product: ProductListItemViewModel,
): ProductBatchImageCardState {
  return {
    failure: null,
    file: null,
    phase: 'idle',
    previewUrl: null,
    product,
    progress: 0,
    selectionError: null,
    // 无主图时默认勾选，已有主图时不静默替换。
    setAsPrimary: product.media.mainImage === null,
    uploadedMediaId: null,
  }
}

export function isProductBatchImageLimitReached(
  product: ProductListItemViewModel,
): boolean {
  return product.media.images.length >= MAX_PRODUCT_IMAGES
}

export function isProductBatchSelectionDisabled(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  product: ProductListItemViewModel,
  limit = PRODUCT_BATCH_SELECTION_LIMIT,
): boolean {
  return !selected.has(product.id) && selected.size >= limit
}

export function toggleProductBatchSelection(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  product: ProductListItemViewModel,
  checked: boolean,
  limit = PRODUCT_BATCH_SELECTION_LIMIT,
): ProductBatchSelectionResult {
  if (!checked) {
    if (!selected.has(product.id)) {
      return { changed: false, selected }
    }
    const next = new Map(selected)
    next.delete(product.id)
    return { changed: true, selected: next }
  }

  if (selected.has(product.id) || selected.size >= limit) {
    return { changed: false, selected }
  }

  const next = new Map(selected)
  next.set(product.id, product)
  return { changed: true, selected: next }
}

export function selectProductBatchPage(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  pageProducts: readonly ProductListItemViewModel[],
  limit = PRODUCT_BATCH_SELECTION_LIMIT,
): ProductBatchPageSelectionResult {
  const next = new Map(selected)
  let addedCount = 0
  let limited = false

  for (const product of pageProducts) {
    if (next.has(product.id)) {
      continue
    }
    if (next.size >= limit) {
      limited = true
      break
    }
    next.set(product.id, product)
    addedCount += 1
  }

  return {
    addedCount,
    limited,
    selected: addedCount === 0 ? selected : next,
  }
}

export function clearProductBatchPage(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  pageProducts: readonly ProductListItemViewModel[],
): ReadonlyMap<string, ProductListItemViewModel> {
  if (pageProducts.length === 0) {
    return selected
  }
  const next = new Map(selected)
  for (const product of pageProducts) {
    next.delete(product.id)
  }
  return next.size === selected.size ? selected : next
}

export function getProductBatchPageSelectionState(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  pageProducts: readonly ProductListItemViewModel[],
): ProductBatchPageSelectionState {
  if (pageProducts.length === 0) {
    return false
  }
  const selectedCount = pageProducts.filter(product => selected.has(product.id)).length
  if (selectedCount === 0) {
    return false
  }
  return selectedCount === pageProducts.length ? true : 'indeterminate'
}

/** 列表刷新只更新已选产品的快照，保留选择顺序与当前页外的选择。 */
export function updateProductBatchSelectionSnapshot(
  selected: ReadonlyMap<string, ProductListItemViewModel>,
  products: readonly ProductListItemViewModel[],
): ReadonlyMap<string, ProductListItemViewModel> {
  if (selected.size === 0 || products.length === 0) {
    return selected
  }
  let changed = false
  const next = new Map(selected)
  for (const product of products) {
    if (next.has(product.id)) {
      next.set(product.id, product)
      changed = true
    }
  }
  return changed ? next : selected
}

export function prepareProductBatchCardFile(
  card: ProductBatchImageCardState,
  file: ProductMediaFileLike,
  previewUrl: string,
): ProductBatchFilePreparationResult {
  const validation = validateProductMediaSelection(file, {
    currentImageCount: card.product.media.images.length,
    currentVideoCount: card.product.media.videos.length,
    // 每张卡片只提交一张图片，候选文件不计入队列占用；数量上限由 current 判断。
    queuedImageCount: 0,
    queuedVideoCount: 0,
  })
  if (!validation.accepted) {
    return {
      card: {
        ...card,
        selectionError: validation.error.message,
      },
      error: validation.error,
    }
  }

  return {
    card: {
      ...card,
      failure: null,
      file,
      phase: 'ready',
      previewUrl,
      progress: 0,
      selectionError: null,
      uploadedMediaId: null,
    },
    error: null,
  }
}

export function removeProductBatchCardFile(
  card: ProductBatchImageCardState,
): ProductBatchImageCardState {
  return {
    ...card,
    failure: null,
    file: null,
    phase: 'idle',
    previewUrl: null,
    progress: 0,
    selectionError: null,
    uploadedMediaId: null,
  }
}

export function setProductBatchCardPrimary(
  card: ProductBatchImageCardState,
  setAsPrimary: boolean,
): ProductBatchImageCardState {
  return { ...card, setAsPrimary }
}

export function applyProductBatchUploadSuccess(
  card: ProductBatchImageCardState,
  product: ProductListItemViewModel,
  uploadedMediaId: string,
): ProductBatchImageCardState {
  return {
    ...card,
    failure: null,
    phase: card.setAsPrimary ? 'setting-primary' : 'success',
    product,
    progress: 100,
    selectionError: null,
    uploadedMediaId,
  }
}

export function applyProductBatchUploadFailure(
  card: ProductBatchImageCardState,
  failure: ProductMediaSafeFailure,
): ProductBatchImageCardState {
  return {
    ...card,
    failure,
    phase: failure.outcome === 'unknown' ? 'unknown' : 'failed',
    progress: 0,
  }
}

export function applyProductBatchLayoutSuccess(
  card: ProductBatchImageCardState,
  product: ProductListItemViewModel,
): ProductBatchImageCardState {
  return {
    ...card,
    failure: null,
    phase: 'success',
    product,
    progress: 100,
  }
}

export function applyProductBatchLayoutFailure(
  card: ProductBatchImageCardState,
  failure: ProductMediaSafeFailure,
): ProductBatchImageCardState {
  return {
    ...card,
    failure,
    phase: 'main-failed',
    progress: 100,
  }
}

export function resetProductBatchCardForRetry(
  card: ProductBatchImageCardState,
): ProductBatchImageCardState {
  if (card.phase === 'failed') {
    return {
      ...card,
      failure: null,
      phase: 'ready',
      progress: 0,
    }
  }
  if (card.phase === 'main-failed') {
    return {
      ...card,
      failure: null,
      phase: 'setting-primary',
    }
  }
  return card
}

export function buildProductBatchLayoutPayload(
  product: ProductListItemViewModel,
  primaryImageId: string,
): ProductMediaLayoutRequestDto {
  return {
    expectedVersion: product.version,
    imageIds: product.media.images.map(item => item.id),
    primaryImageId,
    videoIds: product.media.videos.map(item => item.id),
  }
}

/** 卡片缩略图走派生变体，预览仍用原图；无读取权限时不暴露内容地址。 */
export function buildProductBatchCurrentImageItems(
  product: ProductListItemViewModel,
  contentReadable: boolean,
): readonly ImageGroupItem[] {
  if (!contentReadable) {
    return []
  }
  const media = product.media.mainImage ?? product.media.images[0] ?? null
  if (media === null) {
    return []
  }
  const contentUrl = resolveProductMediaContentUrl(product.id, media)
  if (contentUrl === null) {
    return []
  }
  const label = product.media.mainImage === null
    ? `${product.name}图片`
    : `${product.name}主图`
  return [{
    alt: label,
    key: media.id,
    previewSrc: contentUrl,
    src: mediaThumbnailUrl(contentUrl) ?? contentUrl,
    tooltip: label,
  }]
}

export function summarizeProductBatchCards(
  cards: readonly ProductBatchImageCardState[],
): ProductBatchImageSummary {
  let blocked = 0
  let failed = 0
  let ready = 0
  let retryable = 0
  let setPrimary = 0
  let skipped = 0
  let succeeded = 0
  let unknown = 0

  for (const card of cards) {
    if (card.phase === 'success') {
      succeeded += 1
      continue
    }
    if (card.phase === 'unknown') {
      unknown += 1
      continue
    }
    if (card.phase === 'failed' || card.phase === 'main-failed') {
      failed += 1
      if (card.phase === 'main-failed' || !isProductBatchImageLimitReached(card.product)) {
        retryable += 1
      }
      continue
    }
    if (isProductBatchImageLimitReached(card.product)) {
      blocked += 1
      continue
    }
    if (card.file === null) {
      skipped += 1
      continue
    }
    ready += 1
    if (card.setAsPrimary) {
      setPrimary += 1
    }
  }

  return {
    blocked,
    failed,
    ready,
    retryable,
    setPrimary,
    skipped,
    succeeded,
    unknown,
  }
}

export function canSubmitProductBatch(
  cards: readonly ProductBatchImageCardState[],
): boolean {
  return summarizeProductBatchCards(cards).ready > 0
}

export function buildProductBatchRunResult(
  cards: readonly ProductBatchImageCardState[],
): ProductBatchRunResult {
  const successfulProductIds: string[] = []
  const failedProductIds: string[] = []
  const unknownProductIds: string[] = []
  let uploadedCount = 0
  let primarySetCount = 0

  for (const card of cards) {
    if (card.phase === 'success') {
      successfulProductIds.push(card.product.id)
      uploadedCount += 1
      if (card.setAsPrimary) {
        primarySetCount += 1
      }
      continue
    }
    if (card.phase === 'main-failed') {
      failedProductIds.push(card.product.id)
      uploadedCount += 1
      continue
    }
    if (card.phase === 'failed') {
      failedProductIds.push(card.product.id)
      continue
    }
    if (card.phase === 'unknown') {
      unknownProductIds.push(card.product.id)
    }
  }

  return {
    failedProductIds,
    primarySetCount,
    successfulProductIds,
    unknownProductIds,
    uploadedCount,
  }
}
