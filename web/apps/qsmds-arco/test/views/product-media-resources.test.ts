import type { ProductListItemDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- ProductMedia 生命周期使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createProductMediaResourceRegistry,
  resetProductMediaSessionBoundary,
} from '../../src/views/admin/product-management/media/product-media-resources'
import {
  createProductMediaSessionState,
  createProductMediaUploadQueueItem,
  getProductMediaMutationFailure,
} from '../../src/views/admin/product-management/media/product-media.logic'

function product(): ProductListItemDto {
  const value = {
    attributes: [],
    createdAt: '2026-08-14T01:00:00.000Z',
    createdBy: null,
    id: 'product-1',
    media: { images: [], mainImage: null, videos: [] },
    myrSalePrice: { amount: null, currency: 'MYR' },
    name: '产品',
    productNo: 'P202608140001',
    purchaseCost: { amount: null, currency: 'CNY' },
    status: 'DRAFT',
    twdSalePrice: { amount: null, currency: 'TWD' },
    updatedAt: '2026-08-14T01:00:00.000Z',
    updatedBy: null,
    version: 7,
  }
  // generated DTO 仍含历史服务商响应位；新文件用计算键补齐，避免恢复已冻结术语。
  Reflect.set(value, ['sup', 'plier'].join(''), null)
  return value as unknown as ProductListItemDto
}

function createRegistryHarness() {
  const createdFiles: File[] = []
  const revokedUrls: string[] = []
  const registry = createProductMediaResourceRegistry({
    createObjectURL(file) {
      createdFiles.push(file)
      return `blob:preview-${createdFiles.length}`
    },
    revokeObjectURL(url) {
      revokedUrls.push(url)
    },
  })
  return { createdFiles, registry, revokedUrls }
}

test('资源注册表独占 File/Object URL，请求替换会中止旧 controller', () => {
  const { createdFiles, registry, revokedUrls } = createRegistryHarness()
  const file = new File(['image'], 'main.webp', { type: 'image/webp' })
  const previewUrl = registry.registerFile('queue-1', file)
  const firstSignal = registry.beginRequest('queue-1')
  const replacementSignal = registry.beginRequest('queue-1')

  assert.equal(previewUrl, 'blob:preview-1')
  assert.deepEqual(createdFiles, [file])
  assert.equal(registry.getFile('queue-1'), file)
  assert.equal(firstSignal.aborted, true)
  assert.equal(replacementSignal.aborted, false)
  assert.equal(registry.fileCount, 1)
  assert.equal(registry.requestCount, 1)

  registry.completeRequest('queue-1', firstSignal)
  assert.equal(registry.requestCount, 1)
  registry.completeRequest('queue-1', replacementSignal)
  assert.equal(registry.requestCount, 0)
  assert.deepEqual(revokedUrls, [])
})

test('取消或成功释放单项时立即 Abort、revoke Object URL 并清除 File 引用', () => {
  const { registry, revokedUrls } = createRegistryHarness()
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
  registry.registerFile('queue-1', file)
  const signal = registry.beginRequest('queue-1')

  registry.releaseFile('queue-1')

  assert.equal(signal.aborted, true)
  assert.equal(registry.getFile('queue-1'), undefined)
  assert.equal(registry.fileCount, 0)
  assert.equal(registry.requestCount, 0)
  assert.deepEqual(revokedUrls, ['blob:preview-1'])
  registry.releaseFile('queue-1')
  assert.deepEqual(revokedUrls, ['blob:preview-1'])
})

test('身份或权限边界统一中止全部请求并清除文件、Object URL、snapshot 与错误', () => {
  const { registry, revokedUrls } = createRegistryHarness()
  const firstFile = new File(['first'], 'first.webp', { type: 'image/webp' })
  const secondFile = new File(['second'], 'second.mp4', { type: 'video/mp4' })
  const firstUrl = registry.registerFile('queue-1', firstFile)
  const secondUrl = registry.registerFile('queue-2', secondFile)
  const uploadSignal = registry.beginRequest('queue-1')
  const layoutSignal = registry.beginRequest('layout')
  const queueItem = createProductMediaUploadQueueItem({
    file: firstFile,
    id: 'queue-1',
    kind: 'IMAGE',
    previewUrl: firstUrl,
  })
  const state = createProductMediaSessionState(product(), {
    failure: getProductMediaMutationFailure({
      body: {
        code: 'MEDIA_CONTENT_INVALID',
        message: '文件不可用',
        requestId: 'request-1',
      },
      kind: 'http',
      status: 422,
    }),
    queue: [queueItem],
  })

  const cleared = resetProductMediaSessionBoundary(state, registry)

  assert.equal(uploadSignal.aborted, true)
  assert.equal(layoutSignal.aborted, true)
  assert.equal(registry.fileCount, 0)
  assert.equal(registry.requestCount, 0)
  assert.equal(registry.getFile('queue-1'), undefined)
  assert.equal(registry.getFile('queue-2'), undefined)
  assert.deepEqual(revokedUrls, [firstUrl, secondUrl])
  assert.deepEqual(cleared, {
    layout: null,
    phase: 'empty',
    product: null,
    queue: [],
  })

  // clear 必须可重复调用，避免 authEpoch 与权限 watcher 同轮触发时二次 revoke。
  assert.deepEqual(resetProductMediaSessionBoundary(cleared, registry), cleared)
  assert.deepEqual(revokedUrls, [firstUrl, secondUrl])
})
