import type { PurchaseOrderDetailDto, PurchaseOrderImageDraftDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 复制图片必须只使用当前弹窗展示的草稿，并抑制迟到结果。
import test from 'node:test'
import { effectScope, ref, shallowRef } from 'vue'
import { PurchaseOrderImageClipboardError } from '../../src/views/operations/purchase-orders/purchase-order-image-copy.logic'
import { purchaseOrderImageCopyErrorKey, usePurchaseOrderImageCopy } from '../../src/views/operations/purchase-orders/use-purchase-order-image-copy'

function fixture() {
  const detail = shallowRef<PurchaseOrderDetailDto | null>({ id: 'order-1' } as PurchaseOrderDetailDto)
  const orderId = ref<string | null>('order-1')
  const visible = ref(true)
  const canReview = ref(true)
  const loading = ref(false)
  const busy = ref(false)
  const copyInfoVisible = ref(true)
  const epoch = ref(1)
  const draft = shallowRef<PurchaseOrderImageDraftDto | null>({ id: 'draft-1' } as PurchaseOrderImageDraftDto)
  const previewUrl = ref<string | null>('blob:preview')
  const previewBlob = shallowRef<Blob | null>(new Blob(['png'], { type: 'image/png' }))
  const imageReady = ref(true)
  const events: Array<{ type: 'failure', key: string } | { type: 'success' }> = []
  let copyHandler: (blob: Blob) => Promise<void> = async () => {}
  const scope = effectScope()
  const state = scope.run(() => usePurchaseOrderImageCopy({
    busy,
    canReview,
    copyInfoVisible,
    detail,
    draft,
    epoch,
    imageReady,
    loading,
    orderId,
    previewBlob,
    previewUrl,
    visible,
  }, {
    copy: blob => copyHandler(blob),
    onFailure: key => events.push({ type: 'failure', key }),
    onSuccess: () => events.push({ type: 'success' }),
  }))!
  return {
    state,
    scope,
    detail,
    orderId,
    visible,
    canReview,
    loading,
    busy,
    copyInfoVisible,
    epoch,
    draft,
    previewUrl,
    previewBlob,
    imageReady,
    events,
    setCopy: (handler: (blob: Blob) => Promise<void>) => {
      copyHandler = handler
    },
  }
}

test('只有复制弹窗可见、图片就绪且 Blob 存在时才允许复制图片', () => {
  const f = fixture()
  assert.equal(f.state.canCopy.value, true)
  f.copyInfoVisible.value = false
  assert.equal(f.state.canCopy.value, false)
  f.copyInfoVisible.value = true
  f.imageReady.value = false
  assert.equal(f.state.canCopy.value, false)
  f.imageReady.value = true
  f.previewBlob.value = null
  assert.equal(f.state.canCopy.value, false)
  f.previewBlob.value = new Blob(['png'], { type: 'image/png' })
  f.busy.value = true
  assert.equal(f.state.canCopy.value, false)
  f.busy.value = false
  f.detail.value = { id: 'order-2' } as PurchaseOrderDetailDto
  assert.equal(f.state.canCopy.value, false)
  f.scope.stop()
})

test('复制使用当前 Blob，成功与不可用/失败分别提示一次', async () => {
  const f = fixture()
  const blobs: Blob[] = []
  f.setCopy(async (blob) => {
    blobs.push(blob)
  })
  await f.state.copy()
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0], f.previewBlob.value)
  assert.deepEqual(f.events, [{ type: 'success' }])

  f.events.length = 0
  f.setCopy(() => Promise.reject(new PurchaseOrderImageClipboardError('UNAVAILABLE')))
  await f.state.copy()
  assert.deepEqual(f.events, [{ type: 'failure', key: 'purchaseReview.copy.imageClipboardUnavailable' }])

  f.events.length = 0
  f.setCopy(() => Promise.reject(new Error('Permission denied')))
  await f.state.copy()
  assert.deepEqual(f.events, [{ type: 'failure', key: 'purchaseReview.copy.imageFailed' }])
  f.scope.stop()
})

test('关闭复制弹窗、换单、身份变化或 reset 后，迟到的成功和失败都不提示', async () => {
  for (const change of ['copy-modal', 'order', 'identity', 'reset'] as const) {
    for (const result of ['success', 'failure'] as const) {
      const f = fixture()
      let finish!: () => void
      f.setCopy(() => new Promise((resolve, reject) => {
        finish = () => result === 'success' ? resolve() : reject(new Error('Permission denied'))
      }))
      const pending = f.state.copy()
      assert.equal(f.state.copying.value, true)
      if (change === 'copy-modal') {
        f.copyInfoVisible.value = false
      }
      else if (change === 'order') {
        f.orderId.value = 'order-2'
      }
      else if (change === 'identity') {
        f.epoch.value += 1
      }
      else {
        f.state.reset()
      }
      finish()
      await pending
      assert.deepEqual(f.events, [])
      assert.equal(f.state.copying.value, false)
      f.scope.stop()
    }
  }
})

test('错误映射不把剪贴板拒绝误报为浏览器不支持', () => {
  assert.equal(purchaseOrderImageCopyErrorKey(new PurchaseOrderImageClipboardError('UNAVAILABLE')), 'purchaseReview.copy.imageClipboardUnavailable')
  assert.equal(purchaseOrderImageCopyErrorKey(new PurchaseOrderImageClipboardError('FAILED')), 'purchaseReview.copy.imageFailed')
  assert.equal(purchaseOrderImageCopyErrorKey(new Error('Permission denied')), 'purchaseReview.copy.imageFailed')
})
