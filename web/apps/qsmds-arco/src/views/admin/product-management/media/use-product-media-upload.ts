import type { ComputedRef, Ref, ShallowRef } from 'vue'
import type { ProductListItemDto } from '../../../../api/generated/types.gen'
import type { ProductMediaResourceRegistry } from './product-media-resources'
import type { ProductMediaSelectionFeedback } from './product-media-view.logic'
import type { ProductMediaActiveSessionState } from './product-media.logic'

import { computed, nextTick, ref } from 'vue'
import productMediaApi from '../../../../api/modules/product-media'
import productsApi from '../../../../api/modules/products'
import {
  appendProductMediaUploadQueueItem,
  applyProductMediaServerSnapshot,
  beginProductMediaUpload,
  confirmProductMediaUpload,
  createProductMediaUploadQueueItem,
  getProductMediaMutationFailure,
  markProductMediaUploadFinalizing,
  markProductMediaUploadUnknown,
  reconcileProductMediaUploadResult,
  recordProductMediaUploadProgress,
  removeProductMediaUploadQueueItem,
  resolveProductMediaUploadFailure,
  retryProductMediaUpload,
  updateProductMediaUploadQueueItem,
  validateProductMediaSelection,
} from './product-media.logic'

export interface ProductMediaOperationContext {
  readonly authEpoch: number
  readonly version: number
}

export interface UseProductMediaUploadOptions {
  editable: Ref<boolean>
  focusFirstError: () => Promise<void>
  hasConflict: () => boolean
  layoutPhase: ComputedRef<ProductMediaActiveSessionState['layout']['phase']>
  mutationIdle: ComputedRef<boolean>
  nextOperation: () => ProductMediaOperationContext
  onConflict: (queueId: string) => Promise<void>
  onProductChange: (product: ProductListItemDto) => void
  product: ComputedRef<ProductListItemDto>
  requestContextIsCurrent: (context: ProductMediaOperationContext) => boolean
  resources: ProductMediaResourceRegistry
  responseIsCurrent: (
    context: ProductMediaOperationContext,
    signal: AbortSignal,
  ) => boolean
  session: ShallowRef<ProductMediaActiveSessionState>
}

let fallbackStableId = 0

function createClientStableId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId !== undefined) {
    return `${prefix}-${randomId}`
  }
  fallbackStableId += 1
  return `${prefix}-${fallbackStableId}`
}

function createCancellationFailure() {
  return Object.freeze({
    code: undefined,
    message: '上传已取消，正在确认服务端是否已提交',
    outcome: 'unknown' as const,
    requestId: undefined,
  })
}

/**
 * 文件选择、串行上传和上传结果对账形成独立控制器。它只通过注入的 Session
 * 和 operation gate 协作，不拥有布局或解除逻辑，避免单个面板文件持续膨胀。
 */
export function useProductMediaUpload(options: UseProductMediaUploadOptions) {
  const selectionErrors = ref<readonly ProductMediaSelectionFeedback[]>([])
  const cancelledQueueIds = new Set<string>()
  let queueProcessing = false
  let uploadSchedulePending = false

  const queue = computed(() => options.session.value.queue)
  const queuedImageCount = computed(() => queue.value.filter(item => item.kind === 'IMAGE').length)
  const queuedVideoCount = computed(() => queue.value.filter(item => item.kind === 'VIDEO').length)
  const queueHasActiveTransfer = computed(() => queue.value.some(item =>
    item.phase === 'uploading'
    || item.phase === 'finalizing'
    || item.phase === 'reconciling'))
  const queueHasBlockingResult = computed(() => queue.value.some(item =>
    item.phase === 'conflict'
    || item.phase === 'unknown'
    || item.phase === 'reconciling'))
  const uploadLocked = computed(() => !options.mutationIdle.value
    || options.layoutPhase.value !== 'ready'
    || queueHasActiveTransfer.value
    || queueHasBlockingResult.value
    || options.hasConflict())

  function currentQueueItem(queueId: string) {
    return queue.value.find(item => item.id === queueId)
  }

  function updateQueueItem(
    item: ProductMediaActiveSessionState['queue'][number],
  ): void {
    options.session.value = updateProductMediaUploadQueueItem(
      options.session.value,
      item,
    )
  }

  async function focusCurrentError(): Promise<void> {
    await nextTick()
    await options.focusFirstError()
  }

  async function reconcileUpload(
    queueId: string,
    context: Parameters<typeof reconcileProductMediaUploadResult>[0],
    operation: ProductMediaOperationContext,
  ): Promise<void> {
    const requestId = `reconcile-${queueId}`
    const signal = options.resources.beginRequest(requestId)
    try {
      const response = await productsApi.getById(options.product.value.id, signal)
      if (!options.requestContextIsCurrent(operation) || signal.aborted) {
        return
      }
      const result = reconcileProductMediaUploadResult(context, response.data)
      if (result.outcome === 'success') {
        options.session.value = applyProductMediaServerSnapshot(
          options.session.value,
          response.data,
          { removeQueueId: queueId },
        )
        options.resources.releaseFile(queueId)
        options.onProductChange(response.data)
        return
      }
      const current = currentQueueItem(queueId)
      if (current?.phase === 'reconciling') {
        updateQueueItem(markProductMediaUploadUnknown(current))
      }
      options.resources.releaseFile(queueId)
      await focusCurrentError()
    }
    catch {
      if (options.requestContextIsCurrent(operation) && !signal.aborted) {
        const current = currentQueueItem(queueId)
        if (current?.phase === 'reconciling') {
          updateQueueItem(markProductMediaUploadUnknown(current))
        }
        options.resources.releaseFile(queueId)
        await focusCurrentError()
      }
    }
    finally {
      options.resources.completeRequest(requestId, signal)
    }
  }

  async function runUpload(queueId: string): Promise<void> {
    const queued = currentQueueItem(queueId)
    const file = options.resources.getFile(queueId)
    if (
      queued?.phase !== 'queued'
      || file === undefined
      || options.layoutPhase.value !== 'ready'
    ) {
      return
    }

    const expectedVersion = options.product.value.version
    const reconciliation = Object.freeze({
      existingMediaIds: [
        ...options.product.value.media.images.map(item => item.id),
        ...options.product.value.media.videos.map(item => item.id),
      ],
      expectedVersion,
      kind: queued.kind,
      originalFilename: queued.originalFilename,
      sizeBytes: queued.totalBytes,
    })
    const operation = options.nextOperation()
    const signal = options.resources.beginRequest(queueId)
    updateQueueItem(beginProductMediaUpload(queued))

    try {
      const response = await productMediaApi.upload(options.product.value.id, {
        expectedVersion: String(expectedVersion),
        file,
        kind: queued.kind,
      }, {
        onUploadProgress(event) {
          if (!options.responseIsCurrent(operation, signal)) {
            return
          }
          const current = currentQueueItem(queueId)
          if (current?.phase !== 'uploading') {
            return
          }
          const progressed = recordProductMediaUploadProgress(
            current,
            Math.round(event.loaded),
          )
          updateQueueItem(event.loaded >= current.totalBytes
            ? markProductMediaUploadFinalizing(progressed)
            : progressed)
        },
        signal,
        submissionFilename: queued.originalFilename,
      })
      if (!options.responseIsCurrent(operation, signal)) {
        return
      }
      const current = currentQueueItem(queueId)
      if (current?.phase === 'uploading') {
        updateQueueItem(markProductMediaUploadFinalizing(current))
      }
      options.session.value = applyProductMediaServerSnapshot(
        options.session.value,
        response.data.product,
        { removeQueueId: queueId },
      )
      options.resources.releaseFile(queueId)
      options.onProductChange(response.data.product)
    }
    catch (error) {
      if (!options.requestContextIsCurrent(operation)) {
        return
      }
      const current = currentQueueItem(queueId)
      if (current?.phase !== 'uploading' && current?.phase !== 'finalizing') {
        return
      }
      const failure = cancelledQueueIds.delete(queueId)
        ? createCancellationFailure()
        : getProductMediaMutationFailure(error)
      const failed = resolveProductMediaUploadFailure(current, failure)
      updateQueueItem(failed)
      if (failed.phase === 'reconciling') {
        await reconcileUpload(queueId, reconciliation, operation)
      }
      else if (failed.phase === 'conflict') {
        options.resources.releaseFile(queueId)
        await options.onConflict(queueId)
      }
      if (failed.phase === 'failed' || failed.phase === 'conflict') {
        await focusCurrentError()
      }
    }
    finally {
      options.resources.completeRequest(queueId, signal)
    }
  }

  async function processNextUpload(): Promise<void> {
    uploadSchedulePending = false
    if (
      queueProcessing
      || !options.editable.value
      || options.layoutPhase.value !== 'ready'
      || queueHasBlockingResult.value
      || !options.mutationIdle.value
      || options.hasConflict()
    ) {
      return
    }
    const next = queue.value.find(item => item.phase === 'queued')
    if (next === undefined) {
      return
    }
    queueProcessing = true
    try {
      await runUpload(next.id)
    }
    finally {
      queueProcessing = false
      scheduleUploads()
    }
  }

  function scheduleUploads(): void {
    if (uploadSchedulePending) {
      return
    }
    uploadSchedulePending = true
    queueMicrotask(() => {
      void processNextUpload()
    })
  }

  async function handleFilesSelected(files: readonly File[]): Promise<void> {
    if (!options.editable.value || uploadLocked.value) {
      return
    }
    const failures: ProductMediaSelectionFeedback[] = []
    for (const file of files) {
      const result = validateProductMediaSelection(file, {
        currentImageCount: options.product.value.media.images.length,
        currentVideoCount: options.product.value.media.videos.length,
        queuedImageCount: queuedImageCount.value,
        queuedVideoCount: queuedVideoCount.value,
      })
      if (!result.accepted) {
        failures.push(Object.freeze({
          filename: file.name,
          id: createClientStableId('selection-error'),
          message: result.error.message,
        }))
        continue
      }
      const queueId = createClientStableId('upload')
      try {
        const previewUrl = options.resources.registerFile(queueId, file)
        const item = createProductMediaUploadQueueItem({
          file,
          id: queueId,
          kind: result.kind,
          previewUrl,
        })
        options.session.value = appendProductMediaUploadQueueItem(
          options.session.value,
          item,
        )
      }
      catch {
        options.resources.releaseFile(queueId)
        failures.push(Object.freeze({
          filename: file.name,
          id: createClientStableId('selection-error'),
          message: '文件暂时无法加入上传队列，请重新选择',
        }))
      }
    }
    selectionErrors.value = Object.freeze(failures)
    if (failures.length > 0) {
      await focusCurrentError()
    }
  }

  function startUpload(queueId: string, filenameStem: string): void {
    const item = currentQueueItem(queueId)
    if (
      item?.phase !== 'staged'
      || !options.editable.value
      || uploadLocked.value
    ) {
      return
    }
    updateQueueItem(confirmProductMediaUpload(item, filenameStem))
    scheduleUploads()
  }

  function cancelUpload(queueId: string): void {
    const item = currentQueueItem(queueId)
    if (item === undefined) {
      return
    }
    if (item.phase === 'uploading') {
      cancelledQueueIds.add(queueId)
      options.resources.releaseFile(queueId)
      return
    }
    if (item.phase === 'staged' || item.phase === 'queued' || item.phase === 'failed') {
      options.resources.releaseFile(queueId)
      options.session.value = removeProductMediaUploadQueueItem(
        options.session.value,
        queueId,
      )
      scheduleUploads()
    }
  }

  function retryUpload(queueId: string): void {
    const item = currentQueueItem(queueId)
    if (item?.phase !== 'failed') {
      return
    }
    updateQueueItem(retryProductMediaUpload(item))
    scheduleUploads()
  }

  function clearUploadBoundary(): void {
    cancelledQueueIds.clear()
    queueProcessing = false
    uploadSchedulePending = false
    selectionErrors.value = []
  }

  return {
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
  }
}
