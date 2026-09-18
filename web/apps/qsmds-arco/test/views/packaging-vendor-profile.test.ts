import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证固定厂商配置的异步加载与会话隔离。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingVendorProfile } from '../../src/views/operations/warehouse-arrivals/use-packaging-vendor-profile'

function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const vendor = ref<string | null>(null)
  const calls: Array<{ signal: AbortSignal, resolve: (response: unknown) => void, reject: (error: unknown) => void }> = []
  const api = { getPackagingProfile: (_vendor: string, signal: AbortSignal) => new Promise((resolve, reject) => calls.push({ signal, resolve, reject })) }
  const scope = effectScope()
  const state = scope.run(() => usePackagingVendorProfile(enabled, epoch, vendor, api as never))!
  return { enabled, epoch, vendor, calls, state, dispose: () => scope.stop() }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('选择诚信木箱后加载配置；切走、撤权、换账号会取消且忽略旧资料', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  assert.equal(f.calls.length, 0)
  f.vendor.value = 'CHENGXIN'
  assert.equal(f.state.loading.value, true)
  f.vendor.value = 'OTHER'
  assert.equal(f.calls[0]?.signal.aborted, true)
  f.calls[0]!.resolve({ data: { accounts: [{ id: 'late' }] } })
  await tick()
  assert.equal(f.state.profile.value, null)
  f.vendor.value = 'CHENGXIN'
  f.calls[1]!.resolve({ data: { accounts: [{ id: 'a', paymentMethod: 'ALIPAY', qrMediaAssetId: 'qr' }] } })
  await tick()
  assert.equal(f.state.ready.value, true)
  f.epoch.value += 1
  assert.equal(f.state.profile.value, null)
  f.enabled.value = false
  f.calls[2]!.resolve({ data: { accounts: [{ id: 'old-account' }] } })
  await tick()
  assert.equal(f.state.profile.value, null)
  assert.equal(f.state.ready.value, false)
})

test('无配置及读取失败都禁止固定厂商提报，重新加载可以恢复', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.vendor.value = 'CHENGXIN'
  f.calls[0]!.resolve({ data: { accounts: [] } })
  await tick()
  assert.equal(f.state.ready.value, false)
  const failed = f.state.reload()
  f.calls[1]!.reject(new Error('offline'))
  await failed
  assert.ok(f.state.error.value)
  const recovered = f.state.reload()
  f.calls[2]!.resolve({ data: { accounts: [{ id: 'a', paymentMethod: 'WECHAT', qrMediaAssetId: 'qr' }] } })
  await recovered
  assert.equal(f.state.ready.value, true)
  assert.equal(f.state.error.value, '')
})
