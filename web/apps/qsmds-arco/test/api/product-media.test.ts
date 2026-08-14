import type { AxiosInstance, AxiosProgressEvent } from 'axios'
import type {
  ProductMediaDetachRequestDto,
  ProductMediaItemDto,
  ProductMediaLayoutRequestDto,
  ProductMediaUploadRequestDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createProductMediaApi,
  resolveProductMediaContentUrl,
} from '../../src/api/modules/product-media'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'delete' | 'post' | 'put'
  readonly url: string
}

function mediaItem(overrides: Partial<ProductMediaItemDto> = {}): ProductMediaItemDto {
  return {
    contentUrl: '/api/products/product-1/media/media-1/content',
    createdAt: '2026-08-14T01:00:00.000Z',
    durationMs: null,
    height: 1200,
    id: 'media-1',
    isPrimary: true,
    kind: 'IMAGE',
    mimeType: 'image/webp',
    originalFilename: 'main.webp',
    sizeBytes: '1024',
    sortOrder: 0,
    width: 1200,
    ...overrides,
  }
}

test('上传按字段顺序构造 multipart，并透传真实进度、AbortSignal 且禁止自动重试', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
  const api = createProductMediaApi(client)
  const controller = new AbortController()
  const file = new File(['image-bytes'], 'main.webp', { type: 'image/webp' })
  const request: ProductMediaUploadRequestDto = {
    expectedVersion: '7',
    file,
    kind: 'IMAGE',
  }
  const progressEvents: AxiosProgressEvent[] = []
  const onUploadProgress = (event: AxiosProgressEvent) => {
    progressEvents.push(event)
  }

  const result = await api.upload('product/1', request, {
    onUploadProgress,
    signal: controller.signal,
  })

  assert.equal(result, await response)
  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.equal(call.method, 'post')
  assert.equal(call.url, 'products/product%2F1/media')
  assert.ok(call.data instanceof FormData)
  assert.deepEqual([...call.data.entries()].map(([name]) => name), [
    'kind',
    'expectedVersion',
    'file',
  ])
  assert.equal(call.data.get('kind'), 'IMAGE')
  assert.equal(call.data.get('expectedVersion'), '7')
  assert.equal(call.data.get('file'), file)
  assert.deepEqual(call.config, {
    errorPresentation: 'local',
    onUploadProgress,
    retry: false,
    signal: controller.signal,
  })
  assert.deepEqual(progressEvents, [])
  assert.deepEqual(Object.keys(api), ['upload', 'updateLayout', 'detach'])
})

test('布局和解除关联使用 generated DTO、资源路径、AbortSignal 与 retry:false', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    delete(url: string, config?: unknown) {
      calls.push({ config, method: 'delete', url })
      return response
    },
    put(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'put', url })
      return response
    },
  } as unknown as AxiosInstance
  const api = createProductMediaApi(client)
  const controller = new AbortController()
  const layout: ProductMediaLayoutRequestDto = {
    expectedVersion: 7,
    imageIds: ['image-1'],
    primaryImageId: 'image-1',
    videoIds: ['video-1'],
  }
  const detach: ProductMediaDetachRequestDto = { expectedVersion: 8 }

  await api.updateLayout('product/1', layout, controller.signal)
  await api.detach('product/1', 'media/1', detach, controller.signal)

  assert.deepEqual(calls, [
    {
      config: {
        errorPresentation: 'local',
        retry: false,
        signal: controller.signal,
      },
      data: layout,
      method: 'put',
      url: 'products/product%2F1/media/layout',
    },
    {
      config: {
        data: detach,
        errorPresentation: 'local',
        retry: false,
        signal: controller.signal,
      },
      method: 'delete',
      url: 'products/product%2F1/media/media%2F1',
    },
  ])
})

test('contentUrl 只接受与当前 ProductMedia stable ID 精确匹配的同源领域路由', () => {
  const item = mediaItem()

  assert.equal(
    resolveProductMediaContentUrl('product-1', item),
    '/api/products/product-1/media/media-1/content',
  )
  assert.equal(resolveProductMediaContentUrl('product-2', item), null)
  assert.equal(resolveProductMediaContentUrl('product-1', {
    ...item,
    contentUrl: 'https://example.test/media.webp',
  }), null)
  assert.equal(resolveProductMediaContentUrl('product-1', {
    ...item,
    id: 'media/1',
    contentUrl: '/api/products/product-1/media/media%2F1/content',
  }), '/api/products/product-1/media/media%2F1/content')
})
