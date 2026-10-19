import type {
  ProductListItemDto,
  ProductMediaItemDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 批量图片纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  applyProductBatchLayoutFailure,
  applyProductBatchLayoutSuccess,
  applyProductBatchUploadFailure,
  applyProductBatchUploadSuccess,
  buildProductBatchCurrentImageItems,
  buildProductBatchLayoutPayload,
  buildProductBatchRunResult,
  clearProductBatchPage,
  createProductBatchImageCard,
  getProductBatchPageSelectionState,
  isProductBatchImageLimitReached,
  prepareProductBatchCardFile,
  PRODUCT_BATCH_SELECTION_LIMIT,
  removeProductBatchCardFile,
  resetProductBatchCardForRetry,
  selectProductBatchPage,
  setProductBatchCardPrimary,
  summarizeProductBatchCards,
  toggleProductBatchSelection,
  updateProductBatchSelectionSnapshot,
} from '../../src/views/admin/product-management/list/product-batch-images.logic'
import {
  adaptProductListItemDto,
} from '../../src/views/admin/product-management/list/product-list.logic'

function mediaItem(
  id: string,
  overrides: Partial<ProductMediaItemDto> = {},
): ProductMediaItemDto {
  return {
    id,
    kind: 'IMAGE',
    originalFilename: `${id}.webp`,
    mimeType: 'image/webp',
    sizeBytes: '1024',
    width: 1200,
    height: 1200,
    durationMs: null,
    sortOrder: 0,
    isPrimary: false,
    contentUrl: `/api/products/product-1/media/${id}/content`,
    createdAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  }
}

function productDto(
  id: string,
  overrides: Partial<ProductListItemDto> = {},
): ProductListItemDto {
  return {
    id,
    name: `产品 ${id}`,
    categoryId: null,
    categoryName: null,
    productHeadId: null,
    productHeadName: null,
    productNo: `PRODUCT-${id.toUpperCase()}`,
    status: 'ACTIVE',
    sortOrder: 0,
    supplier: null,
    media: {
      mainImage: null,
      images: [],
      videos: [],
    },
    twdSalePrice: { amount: null, currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: null, currency: 'CNY' },
    attributes: [],
    remark: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  }
}

function product(
  id: string,
  overrides: Partial<ProductListItemDto> = {},
) {
  return adaptProductListItemDto(productDto(id, overrides))
}

function imageFile(name = 'product.jpg', size = 1024, type = 'image/jpeg') {
  return { name, size, type }
}

test('选择集合支持逐项切换、跨页保留与空页状态', () => {
  const first = product('first')
  const second = product('second')

  let selection = new Map()
  let result = toggleProductBatchSelection(selection, first, true)
  selection = result.selected
  assert.equal(result.changed, true)
  assert.equal(selection.get('first'), first)

  result = toggleProductBatchSelection(selection, second, true)
  selection = result.selected
  assert.equal(selection.size, 2)

  result = toggleProductBatchSelection(selection, first, false)
  selection = result.selected
  assert.equal(selection.size, 1)
  assert.equal(selection.has('first'), false)

  assert.equal(getProductBatchPageSelectionState(selection, [first, second]), 'indeterminate')
  assert.equal(getProductBatchPageSelectionState(selection, [second]), true)
  assert.equal(getProductBatchPageSelectionState(selection, []), false)
})

test('全选本页只补足剩余名额并报告是否触达上限', () => {
  const products = [product('a'), product('b'), product('c')]
  const selected = new Map([[products[0]!.id, products[0]!]])

  const capped = selectProductBatchPage(selected, products, 2)
  assert.equal(capped.selected.size, 2)
  assert.equal(capped.addedCount, 1)
  assert.equal(capped.limited, true)
  assert.equal(capped.selected.has('c'), false)

  const full = selectProductBatchPage(selected, products, 3)
  assert.equal(full.selected.size, 3)
  assert.equal(full.addedCount, 2)
  assert.equal(full.limited, false)

  const cleared = clearProductBatchPage(full.selected, products)
  assert.equal(cleared.size, 0)
})

test('选择快照随列表刷新更新，且不改变选择顺序', () => {
  const oldFirst = product('first', { name: '旧名称' })
  const second = product('second')
  const selection = new Map([
    ['first', oldFirst],
    ['second', second],
  ])
  const nextFirst = product('first', { name: '新名称', version: 2 })

  const updated = updateProductBatchSelectionSnapshot(selection, [nextFirst])
  assert.equal(updated.get('first')?.name, '新名称')
  assert.equal(updated.get('first')?.version, 2)
  assert.equal(updated.get('second'), second)
  assert.deepEqual([...updated.keys()], ['first', 'second'])
  assert.notEqual(updated, selection)
})

test('选择上限常量为 50，并拒绝超过上限的逐项选择', () => {
  assert.equal(PRODUCT_BATCH_SELECTION_LIMIT, 50)

  const products = Array.from({ length: 50 }, (_, index) => product(`p-${index}`))
  const selection = new Map(products.map(item => [item.id, item]))
  const extra = product('extra')

  const result = toggleProductBatchSelection(selection, extra, true)
  assert.equal(result.changed, false)
  assert.equal(result.selected.size, 50)
  assert.equal(result.selected.has('extra'), false)
})

test('卡片默认主图勾选只取决于产品当前是否已有主图', () => {
  const withoutMain = createProductBatchImageCard(product('without-main'))
  assert.equal(withoutMain.setAsPrimary, true)
  assert.equal(withoutMain.phase, 'idle')
  assert.equal(withoutMain.file, null)

  const withMain = createProductBatchImageCard(product('with-main', {
    media: {
      mainImage: mediaItem('main', { isPrimary: true }),
      images: [mediaItem('main', { isPrimary: true })],
      videos: [],
    },
  }))
  assert.equal(withMain.setAsPrimary, false)
})

test('文件校验复用现有格式、大小和数量规则', () => {
  const card = createProductBatchImageCard(product('first'))

  const accepted = prepareProductBatchCardFile(
    card,
    imageFile(),
    'blob:first',
  )
  assert.equal(accepted.error, null)
  assert.equal(accepted.card.phase, 'ready')
  assert.equal(accepted.card.file?.name, 'product.jpg')
  assert.equal(accepted.card.previewUrl, 'blob:first')

  const document = prepareProductBatchCardFile(
    card,
    imageFile('contract.pdf', 1024, 'application/pdf'),
    'blob:document',
  )
  assert.equal(document.error?.code, 'PRODUCT_MEDIA_DOCUMENT_UNSUPPORTED')
  assert.equal(document.card.phase, 'idle')

  const tooLarge = prepareProductBatchCardFile(
    card,
    imageFile('large.jpg', 10 * 1024 * 1024 + 1),
    'blob:large',
  )
  assert.equal(tooLarge.error?.code, 'MEDIA_FILE_TOO_LARGE')
  assert.equal(tooLarge.card.phase, 'idle')

  const full = createProductBatchImageCard(product('full', {
    media: {
      mainImage: null,
      images: Array.from({ length: 20 }, (_, index) => mediaItem(`image-${index}`)),
      videos: [],
    },
  }))
  assert.equal(isProductBatchImageLimitReached(full.product), true)
  const exceeded = prepareProductBatchCardFile(full, imageFile(), 'blob:full')
  assert.equal(exceeded.error?.code, 'PRODUCT_MEDIA_LIMIT_EXCEEDED')

  const almostFull = createProductBatchImageCard(product('almost-full', {
    media: {
      mainImage: null,
      images: Array.from({ length: 19 }, (_, index) => mediaItem(`image-${index}`)),
      videos: [],
    },
  }))
  assert.equal(prepareProductBatchCardFile(
    almostFull,
    imageFile(),
    'blob:almost-full',
  ).error, null)
})

test('移除文件与切换主图保持卡片其余状态可预测', () => {
  const card = createProductBatchImageCard(product('first'))
  const selected = prepareProductBatchCardFile(card, imageFile(), 'blob:first').card
  const primary = setProductBatchCardPrimary(selected, false)
  assert.equal(primary.setAsPrimary, false)

  const removed = removeProductBatchCardFile(primary)
  assert.equal(removed.file, null)
  assert.equal(removed.previewUrl, null)
  assert.equal(removed.phase, 'idle')
  assert.equal(removed.selectionError, null)
})

test('上传成功按是否设主图进入成功或布局阶段，失败保留可重试状态', () => {
  const card = prepareProductBatchCardFile(
    createProductBatchImageCard(product('first')),
    imageFile(),
    'blob:first',
  ).card
  const updatedProduct = product('first', { version: 2 })

  const plain = applyProductBatchUploadSuccess(
    setProductBatchCardPrimary(card, false),
    updatedProduct,
    'media-new',
  )
  assert.equal(plain.phase, 'success')
  assert.equal(plain.uploadedMediaId, 'media-new')
  assert.equal(plain.product.version, 2)
  assert.equal(plain.progress, 100)

  const primary = applyProductBatchUploadSuccess(
    setProductBatchCardPrimary(card, true),
    updatedProduct,
    'media-new',
  )
  assert.equal(primary.phase, 'setting-primary')

  const knownFailure = applyProductBatchUploadFailure(primary, {
    code: 'MEDIA_CONTENT_INVALID',
    message: '图片内容无效',
    outcome: 'known',
    requestId: 'req-1',
  })
  assert.equal(knownFailure.phase, 'failed')

  const unknownFailure = applyProductBatchUploadFailure(primary, {
    code: undefined,
    message: '结果未知',
    outcome: 'unknown',
    requestId: undefined,
  })
  assert.equal(unknownFailure.phase, 'unknown')

  const retry = resetProductBatchCardForRetry(knownFailure)
  assert.equal(retry.phase, 'ready')
  assert.equal(retry.failure, null)
})

test('布局成功完成，布局失败进入主图未设置并只重试布局', () => {
  const card = setProductBatchCardPrimary(
    prepareProductBatchCardFile(
      createProductBatchImageCard(product('first')),
      imageFile(),
      'blob:first',
    ).card,
    true,
  )
  const uploaded = applyProductBatchUploadSuccess(
    card,
    product('first', { version: 2 }),
    'media-new',
  )

  const success = applyProductBatchLayoutSuccess(uploaded, product('first', {
    version: 3,
    media: {
      mainImage: mediaItem('media-new', { isPrimary: true }),
      images: [mediaItem('media-new', { isPrimary: true })],
      videos: [],
    },
  }))
  assert.equal(success.phase, 'success')
  assert.equal(success.product.version, 3)

  const failed = applyProductBatchLayoutFailure(uploaded, {
    code: 'PRODUCT_STATE_CHANGED',
    message: '产品已变化',
    outcome: 'conflict',
    requestId: 'req-2',
  })
  assert.equal(failed.phase, 'main-failed')

  const retry = resetProductBatchCardForRetry(failed)
  assert.equal(retry.phase, 'setting-primary')
  assert.equal(retry.failure, null)
  assert.equal(retry.uploadedMediaId, 'media-new')
})

test('布局 payload 保留上传后的图片/视频顺序，只替换主图', () => {
  const primary = mediaItem('primary')
  const target = mediaItem('target')
  const video: ProductMediaItemDto = {
    ...mediaItem('video'),
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    contentUrl: '/api/products/product-1/media/video/content',
  }
  const payload = buildProductBatchLayoutPayload(product('first', {
    version: 7,
    media: {
      mainImage: primary,
      images: [primary, target],
      videos: [video],
    },
  }), 'target')

  assert.deepEqual(payload, {
    expectedVersion: 7,
    imageIds: ['primary', 'target'],
    videoIds: ['video'],
    primaryImageId: 'target',
  })
})

test('当前图片优先主图，其次首图，无权限时不暴露内容地址', () => {
  const main = mediaItem('main', {
    contentUrl: '/api/products/first/media/main/content',
    isPrimary: true,
  })
  const second = mediaItem('second', {
    contentUrl: '/api/products/first/media/second/content',
  })
  const withMain = product('first', {
    media: { mainImage: main, images: [main, second], videos: [] },
  })
  const items = buildProductBatchCurrentImageItems(withMain, true)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.key, 'main')
  assert.match(items[0]?.src ?? '', /variant=thumb/u)
  assert.equal(items[0]?.previewSrc, main.contentUrl)

  const withoutMain = product('second', {
    media: {
      mainImage: null,
      images: [{
        ...second,
        contentUrl: '/api/products/second/media/second/content',
      }],
      videos: [],
    },
  })
  assert.equal(buildProductBatchCurrentImageItems(withoutMain, true)[0]?.key, 'second')
  assert.deepEqual(buildProductBatchCurrentImageItems(withMain, false), [])
})

test('摘要区分待上传、跳过、已达上限和设主图数量', () => {
  const ready = prepareProductBatchCardFile(
    createProductBatchImageCard(product('ready')),
    imageFile(),
    'blob:ready',
  ).card
  const primary = setProductBatchCardPrimary(ready, true)
  const skipped = createProductBatchImageCard(product('skipped'))
  const blocked = prepareProductBatchCardFile(
    createProductBatchImageCard(product('blocked', {
      media: {
        mainImage: null,
        images: Array.from({ length: 20 }, (_, index) => mediaItem(`image-${index}`)),
        videos: [],
      },
    })),
    imageFile(),
    'blob:blocked',
  ).card

  const summary = summarizeProductBatchCards([primary, skipped, blocked])
  assert.deepEqual({
    ready: summary.ready,
    skipped: summary.skipped,
    blocked: summary.blocked,
    setPrimary: summary.setPrimary,
  }, {
    ready: 1,
    skipped: 1,
    blocked: 1,
    setPrimary: 1,
  })
})

test('图片已上传但主图失败时，即使达到 20 张仍计为可重试失败', () => {
  const card = setProductBatchCardPrimary(
    prepareProductBatchCardFile(
      createProductBatchImageCard(product('full')),
      imageFile(),
      'blob:full',
    ).card,
    true,
  )
  const uploadedProduct = product('full', {
    version: 2,
    media: {
      mainImage: null,
      images: Array.from({ length: 20 }, (_, index) => mediaItem(`image-${index}`)),
      videos: [],
    },
  })
  const mainFailed = applyProductBatchLayoutFailure(
    applyProductBatchUploadSuccess(card, uploadedProduct, 'media-new'),
    {
      code: 'PRODUCT_STATE_CHANGED',
      message: '主图设置失败',
      outcome: 'conflict',
      requestId: undefined,
    },
  )

  const summary = summarizeProductBatchCards([mainFailed])
  assert.equal(summary.failed, 1)
  assert.equal(summary.retryable, 1)
  assert.equal(summary.blocked, 0)

  const failedAtLimit = applyProductBatchUploadFailure(
    setProductBatchCardPrimary(card, false),
    {
      code: 'PRODUCT_MEDIA_LIMIT_EXCEEDED',
      message: '图片已达上限',
      outcome: 'known',
      requestId: undefined,
    },
  )
  const failedSummary = summarizeProductBatchCards([{
    ...failedAtLimit,
    product: uploadedProduct,
  }])
  assert.equal(failedSummary.failed, 1)
  assert.equal(failedSummary.retryable, 0)
})

test('运行结果汇总成功、失败与未知产品 ID', () => {
  const success = applyProductBatchUploadSuccess(
    setProductBatchCardPrimary(
      prepareProductBatchCardFile(
        createProductBatchImageCard(product('success')),
        imageFile(),
        'blob:success',
      ).card,
      false,
    ),
    product('success', { version: 2 }),
    'media-success',
  )
  const failed = applyProductBatchUploadFailure(
    prepareProductBatchCardFile(
      createProductBatchImageCard(product('failed')),
      imageFile(),
      'blob:failed',
    ).card,
    {
      code: 'MEDIA_CONTENT_INVALID',
      message: '失败',
      outcome: 'known',
      requestId: undefined,
    },
  )
  const unknown = applyProductBatchUploadFailure(
    prepareProductBatchCardFile(
      createProductBatchImageCard(product('unknown')),
      imageFile(),
      'blob:unknown',
    ).card,
    {
      code: undefined,
      message: '未知',
      outcome: 'unknown',
      requestId: undefined,
    },
  )

  const result = buildProductBatchRunResult([success, failed, unknown])
  assert.deepEqual(result.successfulProductIds, ['success'])
  assert.deepEqual(result.failedProductIds, ['failed'])
  assert.deepEqual(result.unknownProductIds, ['unknown'])
  assert.equal(result.uploadedCount, 1)
  assert.equal(result.primarySetCount, 0)
})
