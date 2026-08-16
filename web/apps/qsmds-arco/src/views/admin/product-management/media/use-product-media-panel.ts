import type { Ref } from 'vue'
import type {
  ProductListItemDto,
  ProductMediaItemDto,
} from '../../../../api/generated/types.gen'
import type { ProductMediaSafeFailure } from './product-media-common.logic'
import type { ProductMediaLayoutEditorState } from './product-media-layout.logic'

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import productMediaApi, {
  resolveProductMediaContentUrl,
} from '../../../../api/modules/product-media'
import productsApi from '../../../../api/modules/products'
import {
  createProductMediaResourceRegistry,
} from './product-media-resources'
import {
  getProductMediaFocusTargetId,
  orderProductMediaItems,
} from './product-media-view.logic'
import {
  beginProductMediaLayoutSave,
  canApplyProductMediaResponse,
  createProductMediaLayoutEditor,
  createProductMediaLayoutSnapshot,
  createProductMediaSessionState,
  getProductMediaMutationFailure,
  moveProductMediaLayoutItem,
  reconcileProductMediaDetachResult,
  reconcileProductMediaLayoutResult,
  resolveProductMediaLayoutFailure,
  setProductMediaPrimaryImage,
  updateProductMediaLayoutDraft,
} from './product-media.logic'
import { useProductMediaUpload } from './use-product-media-upload'

export interface UseProductMediaPanelOptions {
  authEpoch: Ref<number>
  contentReadable: Ref<boolean>
  editable: Ref<boolean>
  focusAfterDetach: (productMediaId: string | null) => Promise<void>
  focusFirstUploadError: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onProductChange: (product: ProductListItemDto) => void
  onUnknownChange: (unknown: boolean) => void
  product: Ref<ProductListItemDto>
}

type ConflictSource = 'detach' | 'external' | 'layout' | 'upload'
type MutationPhase = 'detach' | 'idle' | 'layout'

function sameStableIdSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id))
}

/**
 * ProductMediaPanel 的副作用集中在此 composable：浏览器 File、Object URL、
 * AbortController、Product version 和未知结果都不会泄漏给展示型子组件。
 */
export function useProductMediaPanel(options: UseProductMediaPanelOptions) {
  const resources = createProductMediaResourceRegistry()
  const session = shallowRef(createProductMediaSessionState(options.product.value))
  const panelFailure = shallowRef<ProductMediaSafeFailure | null>(null)
  const latestProduct = shallowRef<ProductListItemDto | null>(null)
  const previewItem = shallowRef<ProductMediaItemDto | null>(null)
  const detachTarget = shallowRef<ProductMediaItemDto | null>(null)
  const detachFocusTargetId = ref<string | null>(null)
  const mutationPhase = ref<MutationPhase>('idle')
  const conflictSource = ref<ConflictSource | null>(null)
  const conflictQueueId = ref<string | null>(null)
  const unknownMutation = ref(false)
  const discardVisible = ref(false)
  let pendingNavigationResolver: ((allow: boolean) => void) | null = null
  let operationVersion = 0
  let latestRequestVersion = 0

  const product = computed(() => session.value.product)
  const layout = computed(() => session.value.layout)
  const orderedImages = computed(() => orderProductMediaItems(
    product.value.media.images,
    layout.value.draft.imageIds,
  ))
  const orderedVideos = computed(() => orderProductMediaItems(
    product.value.media.videos,
    layout.value.draft.videoIds,
  ))
  const contentUrls = computed<Readonly<Record<string, string | null>>>(() => {
    const urls: Record<string, string | null> = {}
    for (const item of [...product.value.media.images, ...product.value.media.videos]) {
      urls[item.id] = options.contentReadable.value
        ? resolveProductMediaContentUrl(product.value.id, item)
        : null
    }
    return Object.freeze(urls)
  })
  const totalSizeBytes = computed(() => {
    const total = [...product.value.media.images, ...product.value.media.videos]
      .reduce((sum, item) => sum + BigInt(item.sizeBytes), 0n)
    return total.toString()
  })
  const mutationIdle = computed(() => mutationPhase.value === 'idle')
  const {
    cancelUpload,
    clearUploadBoundary,
    handleFilesSelected,
    queue,
    queuedImageCount,
    queuedVideoCount,
    queueHasActiveTransfer,
    retryUpload,
    scheduleUploads,
    selectionErrors,
    startUpload,
    uploadLocked,
  } = useProductMediaUpload({
    editable: options.editable,
    focusFirstError: options.focusFirstUploadError,
    hasConflict: () => conflictSource.value !== null,
    layoutPhase: computed(() => layout.value.phase),
    mutationIdle,
    nextOperation: () => ({
      authEpoch: options.authEpoch.value,
      version: ++operationVersion,
    }),
    onConflict: queueId => loadLatestProductForConflict('upload', queueId),
    onProductChange: options.onProductChange,
    product,
    requestContextIsCurrent: operation => requestContextIsCurrent(
      operation.version,
      operation.authEpoch,
    ),
    resources,
    responseIsCurrent: (operation, signal) => uploadResponseIsCurrent(
      operation.version,
      operation.authEpoch,
      signal,
    ),
    session,
  })
  const boardLocked = computed(() => mutationPhase.value !== 'idle'
    || queueHasActiveTransfer.value
    || conflictSource.value !== null
    || layout.value.phase === 'saving'
    || layout.value.phase === 'reconciling'
    || layout.value.phase === 'unknown')
  const dirty = computed(() => layout.value.phase === 'dirty'
    || layout.value.phase === 'saving'
    || queue.value.length > 0)
  const unknown = computed(() => unknownMutation.value
    || layout.value.phase === 'unknown'
    || layout.value.phase === 'reconciling'
    || queue.value.some(item => item.phase === 'unknown' || item.phase === 'reconciling'))
  const leaveProtected = computed(() => dirty.value
    || unknown.value
    || conflictSource.value !== null)
  const canReapplyLocalLayout = computed(() => {
    if (
      latestProduct.value === null
      || (
        conflictSource.value !== 'layout'
        && conflictSource.value !== 'external'
        && layout.value.phase !== 'unknown'
      )
    ) {
      return false
    }
    try {
      const latest = createProductMediaLayoutSnapshot(latestProduct.value.media)
      return sameStableIdSet(layout.value.draft.imageIds, latest.imageIds)
        && sameStableIdSet(layout.value.draft.videoIds, latest.videoIds)
    }
    catch {
      return false
    }
  })

  function replaceLayout(nextLayout: ProductMediaLayoutEditorState): void {
    session.value = Object.freeze({
      ...session.value,
      layout: nextLayout,
    })
  }

  function replaceProduct(nextProduct: ProductListItemDto): void {
    session.value = createProductMediaSessionState(nextProduct, { queue: queue.value })
    options.onProductChange(nextProduct)
  }

  function requestContextIsCurrent(version: number, authEpoch: number): boolean {
    return options.editable.value
      && version === operationVersion
      && authEpoch === options.authEpoch.value
  }

  function uploadResponseIsCurrent(
    version: number,
    authEpoch: number,
    signal: AbortSignal,
  ): boolean {
    return canApplyProductMediaResponse({
      aborted: signal.aborted,
      authEpoch,
      authorized: options.editable.value,
      currentAuthEpoch: options.authEpoch.value,
      latestRequestVersion: operationVersion,
      requestVersion: version,
    })
  }

  async function loadLatestProductForConflict(source: ConflictSource, queueId?: string): Promise<void> {
    const requestVersion = ++latestRequestVersion
    const authEpoch = options.authEpoch.value
    const signal = resources.beginRequest('latest-product')
    conflictSource.value = source
    conflictQueueId.value = queueId ?? null
    try {
      const response = await productsApi.getById(product.value.id, signal)
      if (
        signal.aborted
        || requestVersion !== latestRequestVersion
        || authEpoch !== options.authEpoch.value
      ) {
        return
      }
      latestProduct.value = response.data
    }
    catch (error) {
      if (!signal.aborted && requestVersion === latestRequestVersion) {
        panelFailure.value = getProductMediaMutationFailure(error)
      }
    }
    finally {
      resources.completeRequest('latest-product', signal)
    }
  }

  function updateDraft(kind: 'IMAGE' | 'VIDEO', productMediaId: string, targetIndex: number): void {
    if (!options.editable.value || boardLocked.value) {
      return
    }
    const moved = moveProductMediaLayoutItem(
      layout.value.draft,
      kind,
      productMediaId,
      targetIndex,
    )
    replaceLayout(updateProductMediaLayoutDraft(layout.value, moved))
  }

  function setPrimary(productMediaId: string): void {
    if (!options.editable.value || boardLocked.value) {
      return
    }
    const draft = setProductMediaPrimaryImage(layout.value.draft, productMediaId)
    replaceLayout(updateProductMediaLayoutDraft(layout.value, draft))
  }

  async function reconcileLayout(
    failedLayout: ProductMediaLayoutEditorState,
    version: number,
    authEpoch: number,
  ): Promise<void> {
    const signal = resources.beginRequest('layout-reconcile')
    try {
      const response = await productsApi.getById(product.value.id, signal)
      if (!requestContextIsCurrent(version, authEpoch) || signal.aborted) {
        return
      }
      const resolved = reconcileProductMediaLayoutResult(failedLayout, response.data)
      if (resolved.phase === 'ready') {
        session.value = createProductMediaSessionState(response.data, { queue: queue.value })
        panelFailure.value = null
        latestProduct.value = null
        options.onProductChange(response.data)
        return
      }
      latestProduct.value = response.data
      replaceLayout(resolved)
    }
    catch {
      if (requestContextIsCurrent(version, authEpoch) && !signal.aborted) {
        replaceLayout({ ...failedLayout, phase: 'unknown' })
      }
    }
    finally {
      resources.completeRequest('layout-reconcile', signal)
    }
  }

  async function saveLayout(): Promise<void> {
    if (
      !options.editable.value
      || mutationPhase.value !== 'idle'
      || layout.value.phase !== 'dirty'
      || queueHasActiveTransfer.value
    ) {
      return
    }
    const saving = beginProductMediaLayoutSave(layout.value)
    replaceLayout(saving)
    mutationPhase.value = 'layout'
    panelFailure.value = null
    const version = ++operationVersion
    const authEpoch = options.authEpoch.value
    const signal = resources.beginRequest('layout')
    try {
      const response = await productMediaApi.updateLayout(
        product.value.id,
        saving.submission!,
        signal,
      )
      if (!uploadResponseIsCurrent(version, authEpoch, signal)) {
        return
      }
      session.value = createProductMediaSessionState(response.data, { queue: queue.value })
      options.onProductChange(response.data)
    }
    catch (error) {
      if (!requestContextIsCurrent(version, authEpoch)) {
        return
      }
      const failure = getProductMediaMutationFailure(error)
      panelFailure.value = failure
      const failed = resolveProductMediaLayoutFailure(saving, failure)
      replaceLayout(failed)
      if (failed.phase === 'reconciling') {
        await reconcileLayout(failed, version, authEpoch)
      }
      else if (failed.phase === 'conflict') {
        await loadLatestProductForConflict('layout')
      }
    }
    finally {
      resources.completeRequest('layout', signal)
      mutationPhase.value = 'idle'
      scheduleUploads()
    }
  }

  function openPreview(item: ProductMediaItemDto): void {
    if (contentUrls.value[item.id] !== null) {
      previewItem.value = item
    }
  }

  function requestDetach(item: ProductMediaItemDto): void {
    if (!options.editable.value || boardLocked.value || layout.value.phase !== 'ready') {
      return
    }
    const ids = item.kind === 'IMAGE'
      ? orderedImages.value.map(current => current.id)
      : orderedVideos.value.map(current => current.id)
    detachFocusTargetId.value = getProductMediaFocusTargetId(ids, item.id)
    detachTarget.value = item
  }

  async function reconcileDetach(
    target: ProductMediaItemDto,
    expectedVersion: number,
    version: number,
    authEpoch: number,
  ): Promise<void> {
    const signal = resources.beginRequest('detach-reconcile')
    try {
      const response = await productsApi.getById(product.value.id, signal)
      if (!requestContextIsCurrent(version, authEpoch) || signal.aborted) {
        return
      }
      latestProduct.value = response.data
      if (reconcileProductMediaDetachResult({
        expectedVersion,
        productMediaId: target.id,
      }, response.data).outcome === 'success') {
        replaceProduct(response.data)
        panelFailure.value = null
        latestProduct.value = null
        await nextTick()
        await options.focusAfterDetach(detachFocusTargetId.value)
        return
      }
      unknownMutation.value = true
      conflictSource.value = 'detach'
    }
    catch {
      if (requestContextIsCurrent(version, authEpoch) && !signal.aborted) {
        unknownMutation.value = true
        conflictSource.value = 'detach'
      }
    }
    finally {
      resources.completeRequest('detach-reconcile', signal)
    }
  }

  async function confirmDetach(): Promise<void> {
    const target = detachTarget.value
    if (
      target === null
      || !options.editable.value
      || mutationPhase.value !== 'idle'
      || layout.value.phase !== 'ready'
    ) {
      return
    }
    mutationPhase.value = 'detach'
    panelFailure.value = null
    const expectedVersion = product.value.version
    const version = ++operationVersion
    const authEpoch = options.authEpoch.value
    const signal = resources.beginRequest('detach')
    try {
      const response = await productMediaApi.detach(
        product.value.id,
        target.id,
        { expectedVersion },
        signal,
      )
      if (!uploadResponseIsCurrent(version, authEpoch, signal)) {
        return
      }
      detachTarget.value = null
      replaceProduct(response.data)
      await nextTick()
      await options.focusAfterDetach(detachFocusTargetId.value)
    }
    catch (error) {
      if (!requestContextIsCurrent(version, authEpoch)) {
        return
      }
      const failure = getProductMediaMutationFailure(error)
      panelFailure.value = failure
      detachTarget.value = null
      if (failure.outcome === 'conflict') {
        await loadLatestProductForConflict('detach')
      }
      else if (failure.outcome === 'unknown') {
        await reconcileDetach(target, expectedVersion, version, authEpoch)
      }
    }
    finally {
      resources.completeRequest('detach', signal)
      mutationPhase.value = 'idle'
    }
  }

  function acceptLatestProduct(): void {
    if (latestProduct.value === null) {
      return
    }
    const removedQueueId = conflictQueueId.value
    if (removedQueueId !== null) {
      resources.releaseFile(removedQueueId)
    }
    const nextQueue = removedQueueId === null
      ? queue.value
      : queue.value.filter(item => item.id !== removedQueueId)
    session.value = createProductMediaSessionState(latestProduct.value, {
      queue: nextQueue,
    })
    options.onProductChange(latestProduct.value)
    conflictSource.value = null
    conflictQueueId.value = null
    latestProduct.value = null
    panelFailure.value = null
    unknownMutation.value = false
    scheduleUploads()
  }

  function reapplyLocalLayout(): void {
    if (latestProduct.value === null || !canReapplyLocalLayout.value) {
      return
    }
    const localDraft = layout.value.draft
    const rebased = updateProductMediaLayoutDraft(
      createProductMediaLayoutEditor(latestProduct.value),
      localDraft,
    )
    session.value = Object.freeze({
      ...createProductMediaSessionState(latestProduct.value, { queue: queue.value }),
      layout: rebased,
    })
    options.onProductChange(latestProduct.value)
    conflictSource.value = null
    latestProduct.value = null
    panelFailure.value = null
  }

  async function refreshLatestProduct(): Promise<void> {
    const source = conflictSource.value
      ?? (layout.value.phase === 'unknown' ? 'layout' : 'detach')
    await loadLatestProductForConflict(
      source,
      conflictQueueId.value ?? undefined,
    )
  }

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!leaveProtected.value) {
      return
    }
    event.preventDefault()
    event.returnValue = ''
  }

  onBeforeRouteLeave(() => {
    if (!leaveProtected.value) {
      return true
    }
    if (pendingNavigationResolver !== null) {
      return false
    }
    discardVisible.value = true
    return new Promise<boolean>((resolve) => {
      pendingNavigationResolver = resolve
    })
  })

  function closeDiscard(): void {
    discardVisible.value = false
    const resolve = pendingNavigationResolver
    pendingNavigationResolver = null
    resolve?.(false)
  }

  function confirmDiscard(): void {
    discardVisible.value = false
    const resolve = pendingNavigationResolver
    pendingNavigationResolver = null
    resolve?.(true)
  }

  watch(dirty, value => options.onDirtyChange(value), { immediate: true })
  watch(unknown, value => options.onUnknownChange(value), { immediate: true })
  watch(
    [options.authEpoch, options.editable],
    ([nextEpoch, nextEditable], [previousEpoch, previousEditable]) => {
      if (nextEpoch === previousEpoch && nextEditable === previousEditable) {
        return
      }
      operationVersion += 1
      latestRequestVersion += 1
      resources.clear()
      clearUploadBoundary()
      session.value = createProductMediaSessionState(options.product.value)
      panelFailure.value = null
      latestProduct.value = null
      conflictSource.value = null
      conflictQueueId.value = null
      unknownMutation.value = false
    },
  )
  watch(options.product, (nextProduct) => {
    if (
      nextProduct.id === product.value.id
      && nextProduct.version === product.value.version
    ) {
      return
    }
    if (leaveProtected.value) {
      latestProduct.value = nextProduct
      conflictSource.value = 'external'
      return
    }
    resources.clear()
    session.value = createProductMediaSessionState(nextProduct)
  })

  onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
  onBeforeUnmount(() => {
    operationVersion += 1
    latestRequestVersion += 1
    window.removeEventListener('beforeunload', handleBeforeUnload)
    resources.clear()
    pendingNavigationResolver?.(false)
    pendingNavigationResolver = null
  })

  return {
    acceptLatestProduct,
    boardLocked,
    canReapplyLocalLayout,
    cancelUpload,
    closeDiscard,
    confirmDetach,
    confirmDiscard,
    conflictSource,
    contentUrls,
    detachTarget,
    dirty,
    discardVisible,
    handleFilesSelected,
    latestProduct,
    layout,
    mutationPhase,
    openPreview,
    orderedImages,
    orderedVideos,
    panelFailure,
    previewItem,
    product,
    queue,
    queuedImageCount,
    queuedVideoCount,
    reapplyLocalLayout,
    refreshLatestProduct,
    requestDetach,
    retryUpload,
    saveLayout,
    selectionErrors,
    startUpload,
    setPrimary,
    totalSizeBytes,
    unknown,
    updateDraft,
    uploadLocked,
  }
}
