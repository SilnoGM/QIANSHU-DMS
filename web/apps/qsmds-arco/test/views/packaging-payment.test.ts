import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 付款状态机隔离上传和财务写入，核实未知结果重试与撤权。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingPayment } from '../../src/views/workbenches/packaging-payments/use-packaging-payment'

const account = { id: 'alipay', paymentMethod: 'ALIPAY', recipientName: '收款人', qrMediaAssetId: 'qr' }
const record = (status = 'PENDING_PAYMENT', version = 1) => ({ id: 'request', amount: '12.3000', currencyCode: 'CNY', status, version, paymentRecipientProfile: { id: 'profile', version: 3, accounts: [account] }, paymentReceipt: null })
function fixture() {
  const enabled = ref(true)
  const canPay = ref(true)
  const epoch = ref(1)
  const requestId = ref<string | null>('request')
  const calls: Array<{ id: string, body: unknown, signal: AbortSignal }> = []
  const uploads: Array<{ id: string, file: File }> = []
  let detail = async () => ({ data: record() })
  let pay = async () => ({ data: record('PAID', 2) })
  let upload = async () => ({ data: { mediaAssetId: 'voucher' } })
  const api = {
    detail: () => detail(),
    uploadVoucher: (id: string, file: File) => {
      uploads.push({ id, file })
      return upload()
    },
    pay: (id: string, body: unknown, signal: AbortSignal) => {
      calls.push({ id, body: structuredClone(body), signal })
      return pay()
    },
  }
  const scope = effectScope()
  const state = scope.run(() => usePackagingPayment(enabled, canPay, epoch, requestId, api as never))!
  function fill() {
    state.recipientAccountId.value = 'alipay'
    state.voucherFile.value = new File(['png'], 'proof.png', { type: 'image/png' })
    state.remark.value = '  付款备注  '
  }
  return { state, enabled, canPay, epoch, requestId, calls, uploads, fill, setDetail: (value: typeof detail) => detail = value, setPay: (value: typeof pay) => pay = value, setUpload: (value: typeof upload) => upload = value, dispose: () => scope.stop() }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('无收款方式、截图或权限不允许付款；服务端金额不可修改', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  assert.equal(await f.state.confirm(), false)
  f.state.recipientAccountId.value = 'alipay'
  assert.equal(await f.state.confirm(), false)
  f.fill()
  f.canPay.value = false
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.calls.length, 0)
  assert.equal(f.uploads.length, 0)
})

test('单张凭证上传后提交账户和配置版本，重复点击不重复上传或付款', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.fill()
  let finish!: (value: { data: ReturnType<typeof record> }) => void
  f.setPay(() => new Promise(resolve => finish = resolve))
  const first = f.state.confirm()
  await flush()
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]?.body, { expectedVersion: 1, recipientAccountId: 'alipay', recipientProfileVersion: 3, paymentMethod: 'ALIPAY', voucher: { mediaAssetId: 'voucher' }, remark: '付款备注' })
  finish({ data: record('PAID', 2) })
  assert.equal(await first, true)
  assert.equal(f.state.detail.value?.status, 'PAID')
  assert.equal(await f.state.confirm(), false)
})

test('财务结果未知时保留原请求，重试不重复上传，不能刷新覆盖原请求', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.fill()
  f.setPay(async () => {
    throw Object.assign(new Error('offline'), { kind: 'network' })
  })
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.state.unknown.value, true)
  f.state.remark.value = '不能替换原请求'
  await f.state.load()
  assert.equal(f.state.unknown.value, true)
  f.setPay(async () => ({ data: record('PAID', 2) }))
  assert.equal(await f.state.confirm(), true)
  assert.equal(f.uploads.length, 1)
  assert.deepEqual(f.calls[0]?.body, f.calls[1]?.body)
})

test('上传失败不发起付款或锁定未知结果，允许修正后重新上传', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.fill()
  f.setUpload(async () => {
    throw Object.assign(new Error('offline'), { kind: 'network' })
  })
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.calls.length, 0)
  assert.equal(f.state.unknown.value, false)
  f.setUpload(async () => ({ data: { mediaAssetId: 'voucher' } }))
  assert.equal(await f.state.confirm(), true)
})

test('收款资料或费用版本冲突锁定付款，重新核对后才可再次提交', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.fill()
  f.setPay(async () => {
    throw Object.assign(new Error('changed'), { status: 409 })
  })
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.state.stale.value, true)
  assert.equal(await f.state.confirm(), false)
  f.setDetail(async () => ({ data: record('PAID', 2) }))
  await f.state.load()
  assert.equal(f.state.detail.value?.status, 'PAID')
  assert.equal(f.state.stale.value, false)
})

test('没有收款资料的历史提报不可付款，非法类型和超过10MB截图不上传', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.fill()
  f.state.voucherFile.value = new File(['text'], 'proof.txt', { type: 'text/plain' })
  assert.equal(await f.state.confirm(), false)
  f.state.voucherFile.value = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
  assert.equal(await f.state.confirm(), false)
  f.fill()
  f.setDetail(async () => ({ data: { ...record(), paymentRecipientProfile: null } as never }))
  await f.state.load()
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.uploads.length, 0)
})

test('切页、换账号和撤销付款权限均取消晚到上传，不能继续提交财务', async (context) => {
  for (const change of ['route', 'epoch', 'permission']) {
    const f = fixture()
    context.after(f.dispose)
    await flush()
    f.fill()
    let finish!: (value: { data: { mediaAssetId: string } }) => void
    f.setUpload(() => new Promise(resolve => finish = resolve))
    const pending = f.state.confirm()
    if (change === 'route') {
      f.enabled.value = false
    }
    if (change === 'epoch') {
      f.epoch.value++
    }
    if (change === 'permission') {
      f.canPay.value = false
    }
    finish({ data: { mediaAssetId: 'voucher' } })
    assert.equal(await pending, false)
    assert.equal(f.calls.length, 0)
  }
})
