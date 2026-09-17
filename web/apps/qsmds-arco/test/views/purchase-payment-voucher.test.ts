import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 付款截图上传只使用内存 API，验证切款项及账号隔离。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePurchasePaymentVoucher } from '../../src/views/workbenches/purchase-payments/use-purchase-payment-voucher'

function fixture() {
  const id = ref('deposit')
  const enabled = ref(true)
  const epoch = ref(1)
  const locked = ref(false)
  const ids: Array<string | null> = []
  const calls: Array<{ id: string, signal: AbortSignal }> = []
  const revoked: string[] = []
  let execute = async () => ({ data: { mediaAssetId: 'screenshot' } })
  const scope = effectScope()
  const state = scope.run(() => usePurchasePaymentVoucher(id, enabled, epoch, locked, value => ids.push(value), {
    uploadVoucher: (payableId, _file, signal) => {
      calls.push({ id: payableId, signal })
      return execute() as never
    },
  }, { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) }))!
  return { id, epoch, enabled, locked, ids, calls, revoked, state, execute: (handler: typeof execute) => execute = handler, stop: () => scope.stop() }
}
const file = () => new File(['image'], 'voucher.png', { type: 'image/png' })

test('仅成功上传图片才能设置付款凭证，替换和销毁回收预览', async (context) => {
  const f = fixture()
  context.after(f.stop)
  await f.state.upload(new File(['pdf'], 'file.pdf', { type: 'application/pdf' }))
  assert.equal(f.calls.length, 0)
  assert.equal(f.ids.at(-1), null)
  await f.state.upload(file())
  assert.equal(f.ids.at(-1), 'screenshot')
  assert.equal(f.state.previewUrl.value, 'blob:preview')
  f.execute(async () => {
    throw new Error('upload failed')
  })
  await f.state.upload(file())
  assert.equal(f.ids.at(-1), null)
  assert.equal(f.state.previewUrl.value, null)
  assert.deepEqual(f.revoked, ['blob:preview'])
})

test('切换定金尾款、权限或登录账号中止上传，晚到结果不污染新款项', async (context) => {
  for (const action of ['stage', 'account', 'permission']) {
    const f = fixture()
    context.after(f.stop)
    let finish!: (value: { data: { mediaAssetId: string } }) => void
    f.execute(() => new Promise(resolve => finish = resolve))
    const pending = f.state.upload(file())
    if (action === 'stage') {
      f.id.value = 'balance'
    }
    else if (action === 'account') {
      f.epoch.value++
    }
    else { f.enabled.value = false }
    assert.equal(f.calls[0]?.signal.aborted, true)
    finish({ data: { mediaAssetId: 'late' } })
    await pending
    assert.equal(f.ids.at(-1), null)
    assert.equal(f.state.previewUrl.value, null)
    assert.equal(f.state.uploading.value, false)
  }
})

test('结果未知锁定后，不能更换或移除原截图', async (context) => {
  const f = fixture()
  context.after(f.stop)
  await f.state.upload(file())
  f.locked.value = true
  f.state.remove()
  await f.state.upload(file())
  assert.equal(f.calls.length, 1)
  assert.equal(f.ids.at(-1), 'screenshot')
  assert.equal(f.revoked.length, 0)
})
