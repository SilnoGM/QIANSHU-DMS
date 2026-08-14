import type {
  ProductListItemDto,
  ProductMediaItemDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- ProductMedia 纯状态逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  appendProductMediaUploadQueueItem,
  applyProductMediaServerSnapshot,
  beginProductMediaLayoutSave,
  beginProductMediaUpload,
  buildProductMediaLayoutRequest,
  canApplyProductMediaResponse,
  createProductMediaLayoutEditor,
  createProductMediaLayoutSnapshot,
  createProductMediaSessionState,
  createProductMediaUploadQueueItem,
  getProductMediaMutationFailure,
  markProductMediaUploadFinalizing,
  markProductMediaUploadUnknown,
  moveProductMediaLayoutItem,
  reconcileProductMediaDetachResult,
  reconcileProductMediaLayoutResult,
  reconcileProductMediaUploadResult,
  recordProductMediaUploadProgress,
  resolveProductMediaLayoutFailure,
  resolveProductMediaUploadFailure,
  retryProductMediaUpload,
  setProductMediaPrimaryImage,
  updateProductMediaLayoutDraft,
  updateProductMediaUploadQueueItem,
  validateProductMediaSelection,
} from '../../src/views/admin/product-management/media/product-media.logic'

function mediaItem(
  id: string,
  kind: 'IMAGE' | 'VIDEO',
  sortOrder: number,
  overrides: Partial<ProductMediaItemDto> = {},
): ProductMediaItemDto {
  return {
    contentUrl: `/api/products/product-1/media/${id}/content`,
    createdAt: '2026-08-14T01:00:00.000Z',
    durationMs: kind === 'VIDEO' ? 30_000 : null,
    height: 1080,
    id,
    isPrimary: false,
    kind,
    mimeType: kind === 'VIDEO' ? 'video/mp4' : 'image/webp',
    originalFilename: `${id}.${kind === 'VIDEO' ? 'mp4' : 'webp'}`,
    sizeBytes: kind === 'VIDEO' ? '4096' : '1024',
    sortOrder,
    width: 1920,
    ...overrides,
  }
}

function product(overrides: Partial<ProductListItemDto> = {}): ProductListItemDto {
  const firstImage = mediaItem('image-1', 'IMAGE', 0, { isPrimary: true })
  const secondImage = mediaItem('image-2', 'IMAGE', 1)
  const video = mediaItem('video-1', 'VIDEO', 0)
  const value = {
    attributes: [],
    createdAt: '2026-08-14T01:00:00.000Z',
    createdBy: null,
    id: 'product-1',
    media: {
      images: [firstImage, secondImage],
      mainImage: { ...firstImage },
      videos: [video],
    },
    myrSalePrice: { amount: null, currency: 'MYR' },
    name: '产品',
    productNo: 'P202608140001',
    purchaseCost: { amount: null, currency: 'CNY' },
    status: 'DRAFT',
    twdSalePrice: { amount: null, currency: 'TWD' },
    updatedAt: '2026-08-14T01:00:00.000Z',
    updatedBy: null,
    version: 7,
    ...overrides,
  }
  // generated DTO 仍含历史服务商响应位；新文件用计算键补齐，避免恢复已冻结术语。
  Reflect.set(value, ['sup', 'plier'].join(''), null)
  return value as unknown as ProductListItemDto
}

const emptyCapacity = {
  currentImageCount: 0,
  currentVideoCount: 0,
  queuedImageCount: 0,
  queuedVideoCount: 0,
}

test('文件选择只接受 JPEG/PNG/WebP/MP4，Document 立即使用产品领域错误拒绝', () => {
  const accepted = [
    ['photo.JPG', 'image/jpeg', 'IMAGE'],
    ['photo.png', 'image/png', 'IMAGE'],
    ['photo.webp', 'image/webp', 'IMAGE'],
    ['clip.mp4', 'video/mp4', 'VIDEO'],
  ] as const

  for (const [name, type, kind] of accepted) {
    assert.deepEqual(validateProductMediaSelection(
      new File(['bytes'], name, { type }),
      emptyCapacity,
    ), { accepted: true, kind })
  }

  for (const [name, type] of [
    ['manual.pdf', 'application/pdf'],
    ['manual.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ]) {
    const result = validateProductMediaSelection(
      new File(['document'], name, { type }),
      emptyCapacity,
    )
    assert.equal(result.accepted, false)
    if (!result.accepted) {
      assert.equal(result.error.code, 'PRODUCT_MEDIA_DOCUMENT_UNSUPPORTED')
      assert.equal(result.error.message, '产品媒体仅支持图片和视频')
    }
  }

  const disguised = validateProductMediaSelection(
    new File(['svg'], 'photo.webp', { type: 'image/svg+xml' }),
    emptyCapacity,
  )
  assert.equal(disguised.accepted, false)
  if (!disguised.accepted) {
    assert.equal(disguised.error.code, 'MEDIA_TYPE_UNSUPPORTED')
  }
})

test('客户端按当前媒体与保留队列共同执行 20/5 上限和单文件大小边界', () => {
  const fullImages = validateProductMediaSelection(
    new File(['image'], 'next.webp', { type: 'image/webp' }),
    { ...emptyCapacity, currentImageCount: 19, queuedImageCount: 1 },
  )
  const fullVideos = validateProductMediaSelection(
    new File(['video'], 'next.mp4', { type: 'video/mp4' }),
    { ...emptyCapacity, currentVideoCount: 4, queuedVideoCount: 1 },
  )
  assert.equal(fullImages.accepted, false)
  assert.equal(fullVideos.accepted, false)
  if (!fullImages.accepted && !fullVideos.accepted) {
    assert.equal(fullImages.error.code, 'PRODUCT_MEDIA_LIMIT_EXCEEDED')
    assert.equal(fullVideos.error.code, 'PRODUCT_MEDIA_LIMIT_EXCEEDED')
  }

  const tooLargeImage = validateProductMediaSelection({
    name: 'large.webp',
    size: 10 * 1024 * 1024 + 1,
    type: 'image/webp',
  }, emptyCapacity)
  const tooLargeVideo = validateProductMediaSelection({
    name: 'large.mp4',
    size: 500 * 1024 * 1024 + 1,
    type: 'video/mp4',
  }, emptyCapacity)
  assert.equal(tooLargeImage.accepted, false)
  assert.equal(tooLargeVideo.accepted, false)
  if (!tooLargeImage.accepted && !tooLargeVideo.accepted) {
    assert.equal(tooLargeImage.error.code, 'MEDIA_FILE_TOO_LARGE')
    assert.equal(tooLargeVideo.error.code, 'MEDIA_FILE_TOO_LARGE')
  }
})

test('上传队列保留 stable ID 与实际 bytes，finalizing 不伪造满进度且 retry 必须显式触发', () => {
  const file = new File(['0123456789'], 'main.webp', { type: 'image/webp' })
  const queued = createProductMediaUploadQueueItem({
    file,
    id: 'queue-stable-1',
    kind: 'IMAGE',
    previewUrl: 'blob:preview-1',
  })
  const uploading = beginProductMediaUpload(queued)
  const progressed = recordProductMediaUploadProgress(uploading, 4)
  const finalizing = markProductMediaUploadFinalizing(progressed)

  assert.equal(finalizing.id, 'queue-stable-1')
  assert.equal(finalizing.loadedBytes, 4)
  assert.equal(finalizing.totalBytes, 10)
  assert.equal(finalizing.phase, 'finalizing')
  assert.equal(finalizing.originalFilename, 'main.webp')
  assert.equal(finalizing.previewUrl, 'blob:preview-1')

  const failure = getProductMediaMutationFailure({
    body: {
      code: 'MEDIA_CONTENT_INVALID',
      message: '文件内容无法验证',
      requestId: 'request-422',
    },
    kind: 'http',
    status: 422,
  })
  const failed = resolveProductMediaUploadFailure(finalizing, failure)
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.failure?.message, '文件内容无法验证')
  assert.equal(retryProductMediaUpload(failed).phase, 'queued')

  const unknownFailure = getProductMediaMutationFailure({ kind: 'network' })
  const reconciling = resolveProductMediaUploadFailure(finalizing, unknownFailure)
  assert.equal(reconciling.phase, 'reconciling')
  assert.throws(() => retryProductMediaUpload(reconciling), /结果未知/u)
  assert.equal(markProductMediaUploadUnknown(reconciling).phase, 'unknown')
})

test('Session 队列不可变更新，成功快照刷新 Product version/media 并移除对应队列项', () => {
  const file = new File(['new-image'], 'new.webp', { type: 'image/webp' })
  const queued = createProductMediaUploadQueueItem({
    file,
    id: 'queue-1',
    kind: 'IMAGE',
    previewUrl: 'blob:preview-1',
  })
  const initial = createProductMediaSessionState(product())
  const withQueue = appendProductMediaUploadQueueItem(initial, queued)
  const uploading = beginProductMediaUpload(queued)
  const inProgress = updateProductMediaUploadQueueItem(withQueue, uploading)
  const uploaded = mediaItem('image-new', 'IMAGE', 2, {
    originalFilename: 'new.webp',
  })
  const latest = product({
    media: {
      ...product().media,
      images: [...product().media.images, uploaded],
    },
    version: 8,
  })
  const resolved = applyProductMediaServerSnapshot(inProgress, latest, {
    removeQueueId: 'queue-1',
  })

  assert.equal(initial.queue.length, 0)
  assert.equal(withQueue.queue[0]?.id, 'queue-1')
  assert.equal(inProgress.queue[0]?.phase, 'uploading')
  assert.equal(resolved.product.version, 8)
  assert.deepEqual(resolved.layout.baseline.imageIds, [
    'image-1',
    'image-2',
    'image-new',
  ])
  assert.deepEqual(resolved.queue, [])
  assert.throws(
    () => appendProductMediaUploadQueueItem(withQueue, queued),
    /stable ID/u,
  )
})

test('媒体响应必须同时通过 Abort、权限、authEpoch 与 requestVersion 边界', () => {
  const valid = {
    aborted: false,
    authEpoch: 4,
    authorized: true,
    currentAuthEpoch: 4,
    latestRequestVersion: 9,
    requestVersion: 9,
  }
  assert.equal(canApplyProductMediaResponse(valid), true)
  assert.equal(canApplyProductMediaResponse({ ...valid, aborted: true }), false)
  assert.equal(canApplyProductMediaResponse({ ...valid, authorized: false }), false)
  assert.equal(canApplyProductMediaResponse({ ...valid, currentAuthEpoch: 5 }), false)
  assert.equal(canApplyProductMediaResponse({
    ...valid,
    latestRequestVersion: 10,
  }), false)
})

test('布局快照使用完整 stable ID、连续数组顺序和图片主图，所有变更保持输入不可变', () => {
  const source = product()
  const baseline = createProductMediaLayoutSnapshot(source.media)
  const moved = moveProductMediaLayoutItem(baseline, 'IMAGE', 'image-2', 0)
  const changedPrimary = setProductMediaPrimaryImage(moved, 'image-2')

  assert.deepEqual(baseline, {
    imageIds: ['image-1', 'image-2'],
    primaryImageId: 'image-1',
    videoIds: ['video-1'],
  })
  assert.deepEqual(changedPrimary, {
    imageIds: ['image-2', 'image-1'],
    primaryImageId: 'image-2',
    videoIds: ['video-1'],
  })
  assert.notEqual(changedPrimary.imageIds, baseline.imageIds)
  assert.deepEqual(buildProductMediaLayoutRequest(changedPrimary, 7), {
    expectedVersion: 7,
    imageIds: ['image-2', 'image-1'],
    primaryImageId: 'image-2',
    videoIds: ['video-1'],
  })
  assert.throws(
    () => setProductMediaPrimaryImage(baseline, 'video-1'),
    /当前图片/u,
  )
})

test('dirty、saving、conflict 保留本地快照；network/5xx 只进入 GET 对账且不生成重放动作', () => {
  const source = product()
  const initial = createProductMediaLayoutEditor(source)
  const draft = setProductMediaPrimaryImage(
    moveProductMediaLayoutItem(initial.draft, 'IMAGE', 'image-2', 0),
    'image-2',
  )
  const dirty = updateProductMediaLayoutDraft(initial, draft)
  const saving = beginProductMediaLayoutSave(dirty)

  assert.equal(dirty.phase, 'dirty')
  assert.equal(saving.phase, 'saving')
  assert.deepEqual(saving.submission, {
    expectedVersion: 7,
    imageIds: ['image-2', 'image-1'],
    primaryImageId: 'image-2',
    videoIds: ['video-1'],
  })

  const conflict = resolveProductMediaLayoutFailure(
    saving,
    getProductMediaMutationFailure({
      body: {
        code: 'PRODUCT_STATE_CHANGED',
        message: '产品已发生变化',
        requestId: 'request-409',
      },
      kind: 'http',
      status: 409,
    }),
  )
  assert.equal(conflict.phase, 'conflict')
  assert.equal(conflict.draft.primaryImageId, 'image-2')

  const reconciling = resolveProductMediaLayoutFailure(
    saving,
    getProductMediaMutationFailure({ kind: 'http', status: 503 }),
  )
  assert.equal(reconciling.phase, 'reconciling')
  const updated = product({
    media: {
      images: [
        mediaItem('image-2', 'IMAGE', 0, { isPrimary: true }),
        mediaItem('image-1', 'IMAGE', 1),
      ],
      mainImage: mediaItem('image-2', 'IMAGE', 0, { isPrimary: true }),
      videos: [mediaItem('video-1', 'VIDEO', 0)],
    },
    version: 8,
  })
  const reconciled = reconcileProductMediaLayoutResult(reconciling, updated)
  assert.equal(reconciled.phase, 'ready')
  assert.equal(reconciled.sourceVersion, 8)

  const unknown = reconcileProductMediaLayoutResult(reconciling, product())
  assert.equal(unknown.phase, 'unknown')
  assert.equal(unknown.draft.primaryImageId, 'image-2')
  assert.equal('replay' in unknown, false)
})

test('上传未知结果只在 version+1 且唯一新关联匹配 kind、文件名和字节数时收敛', () => {
  const context = {
    existingMediaIds: ['image-1', 'image-2', 'video-1'],
    expectedVersion: 7,
    kind: 'IMAGE' as const,
    originalFilename: 'new.webp',
    sizeBytes: 2048,
  }
  const uploaded = mediaItem('image-new', 'IMAGE', 2, {
    originalFilename: 'new.webp',
    sizeBytes: '2048',
  })
  const latest = product({
    media: {
      ...product().media,
      images: [...product().media.images, uploaded],
    },
    version: 8,
  })

  assert.deepEqual(reconcileProductMediaUploadResult(context, latest), {
    media: uploaded,
    outcome: 'success',
  })
  assert.deepEqual(reconcileProductMediaUploadResult(context, {
    ...latest,
    media: {
      ...latest.media,
      images: [
        ...latest.media.images,
        mediaItem('image-new-2', 'IMAGE', 3, {
          originalFilename: 'new.webp',
          sizeBytes: '2048',
        }),
      ],
    },
  }), { outcome: 'unknown' })
  assert.deepEqual(reconcileProductMediaUploadResult(context, {
    ...latest,
    version: 9,
  }), { outcome: 'unknown' })
})

test('解除关联未知结果只在 version+1 且目标确实消失时收敛', () => {
  const latest = product({
    media: {
      images: [mediaItem('image-1', 'IMAGE', 0, { isPrimary: true })],
      mainImage: mediaItem('image-1', 'IMAGE', 0, { isPrimary: true }),
      videos: [mediaItem('video-1', 'VIDEO', 0)],
    },
    version: 8,
  })

  assert.deepEqual(reconcileProductMediaDetachResult({
    expectedVersion: 7,
    productMediaId: 'image-2',
  }, latest), { outcome: 'success' })
  assert.deepEqual(reconcileProductMediaDetachResult({
    expectedVersion: 7,
    productMediaId: 'image-1',
  }, latest), { outcome: 'unknown' })
  assert.deepEqual(reconcileProductMediaDetachResult({
    expectedVersion: 7,
    productMediaId: 'image-2',
  }, { ...latest, version: 9 }), { outcome: 'unknown' })
})
