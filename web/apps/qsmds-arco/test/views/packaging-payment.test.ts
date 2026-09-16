import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 付款确认读取服务端金额和版本，防止重复付款及旧会话响应。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingPayment } from '../../src/views/workbenches/packaging-payments/use-packaging-payment'

const record = (status = 'PENDING_PAYMENT', version = 1) => ({ id: 'request', amount: '12.3000', currencyCode: 'CNY', status, version })
function fixture() {
  const enabled = ref(true)
  const canPay = ref(true)
  const epoch = ref(1)
  const requestId = ref<string | null>('request')
  const calls: unknown[] = []
  let detail = async () => ({ data: record() })
  let pay = async () => ({ data: record('PAID', 2) })
  const api = { detail: () => detail(), pay: (id: string, body: unknown) => {
    calls.push({ id, body })
    return pay()
  } }
  const scope = effectScope()
  const state = scope.run(() => usePackagingPayment(enabled, canPay, epoch, requestId, api as never))!
  return { state, enabled, canPay, epoch, requestId, calls, setDetail: (value: typeof detail) => detail = value, setPay: (value: typeof pay) => pay = value, dispose: () => scope.stop(),
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('只读用户不可付款，确认固定服务端金额且只传最新版本，重复点击只写一次', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.canPay.value = false
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.calls.length, 0)
  f.canPay.value = true
  let finish!: (value: { data: ReturnType<typeof record> }) => void
  f.setPay(() => new Promise(resolve => finish = resolve))
  const first = f.state.confirm()
  assert.equal(await f.state.confirm(), false)
  assert.deepEqual(f.calls, [{ id: 'request', body: { expectedVersion: 1 } }])
  finish({ data: record('PAID', 2) })
  assert.equal(await first, true)
  assert.equal(f.state.detail.value?.amount, '12.3000')
  assert.equal(f.state.detail.value?.status, 'PAID')
})

test('版本冲突刷新付款状态，不会继续使用旧版本付款', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  f.setPay(async () => {
    throw Object.assign(new Error('changed'), { status: 409 })
  })
  f.setDetail(async () => ({ data: record('PAID', 2) }))
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.state.detail.value?.status, 'PAID')
  assert.equal(await f.state.confirm(), false)
  assert.equal(f.calls.length, 1)
})

test('切页与换账号取消晚到确认结果，不能在新会话显示付款成功', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await flush()
  let finish!: (value: { data: ReturnType<typeof record> }) => void
  f.setPay(() => new Promise(resolve => finish = resolve))
  const first = f.state.confirm()
  f.epoch.value += 1
  finish({ data: record('PAID', 2) })
  assert.equal(await first, false)
  f.enabled.value = false
  await flush()
  assert.equal(f.state.detail.value, null)
})
