import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Object URL 生命周期使用 Node.js 内置 runner。
import test from 'node:test'

import { createSalesOrderDocumentPreviewRegistry } from '../../src/views/operations/sales-orders/sales-order-document-previews'

function createRegistryHarness() {
  const createdFiles: File[] = []
  const revokedUrls: string[] = []
  const registry = createSalesOrderDocumentPreviewRegistry({
    createObjectURL(file) {
      createdFiles.push(file)
      return `blob:sales-order-document-${createdFiles.length}`
    },
    revokeObjectURL(url) {
      revokedUrls.push(url)
    },
  })

  return { createdFiles, registry, revokedUrls }
}

test('注册表通过 stable key 独占 Object URL，并提供不可变快照', () => {
  const { createdFiles, registry, revokedUrls } = createRegistryHarness()
  const file = new File(['voucher'], 'voucher.png', { type: 'image/png' })

  const previewUrl = registry.register('document-1', file)
  const snapshot = registry.snapshot()

  assert.equal(previewUrl, 'blob:sales-order-document-1')
  assert.deepEqual(createdFiles, [file])
  assert.equal(registry.get('document-1'), previewUrl)
  assert.equal(registry.size, 1)
  assert.deepEqual(snapshot, { 'document-1': previewUrl })
  assert.equal(Object.isFrozen(snapshot), true)
  assert.deepEqual(revokedUrls, [])
})

test('空 key、重复 key 与空 Object URL 均拒绝且不覆盖既有预览', () => {
  const { createdFiles, registry } = createRegistryHarness()
  const file = new File(['voucher'], 'voucher.png', { type: 'image/png' })

  assert.throws(
    () => registry.register('   ', file),
    /documentKey 必须是唯一非空 stable key/u,
  )
  registry.register('document-1', file)
  assert.throws(
    () => registry.register('document-1', file),
    /documentKey 必须是唯一非空 stable key/u,
  )
  assert.equal(createdFiles.length, 1)
  assert.equal(registry.size, 1)

  const invalidRegistry = createSalesOrderDocumentPreviewRegistry({
    createObjectURL: () => '   ',
    revokeObjectURL: () => {},
  })
  assert.throws(
    () => invalidRegistry.register('document-2', file),
    /createObjectURL 必须返回非空地址/u,
  )
  assert.equal(invalidRegistry.get('document-2'), null)
  assert.equal(invalidRegistry.size, 0)
})

test('release 立即回收单项且可重复调用，不会重复 revoke', () => {
  const { registry, revokedUrls } = createRegistryHarness()
  const previewUrl = registry.register(
    'document-1',
    new File(['voucher'], 'voucher.png', { type: 'image/png' }),
  )

  registry.release('document-1')

  assert.equal(registry.get('document-1'), null)
  assert.equal(registry.size, 0)
  assert.deepEqual(registry.snapshot(), {})
  assert.deepEqual(revokedUrls, [previewUrl])

  registry.release('document-1')
  assert.deepEqual(revokedUrls, [previewUrl])
})

test('clear 先清空全部强引用再逐项回收，重复清理保持幂等', () => {
  const { registry, revokedUrls } = createRegistryHarness()
  const firstUrl = registry.register(
    'document-1',
    new File(['first'], 'first.png', { type: 'image/png' }),
  )
  const secondUrl = registry.register(
    'document-2',
    new File(['second'], 'second.png', { type: 'image/png' }),
  )

  registry.clear()

  assert.equal(registry.size, 0)
  assert.deepEqual(registry.snapshot(), {})
  assert.deepEqual(revokedUrls, [firstUrl, secondUrl])

  registry.clear()
  registry.release('document-1')
  assert.deepEqual(revokedUrls, [firstUrl, secondUrl])
})
