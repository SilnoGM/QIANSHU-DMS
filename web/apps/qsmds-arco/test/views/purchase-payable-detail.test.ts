import type { PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 运行详情读取的真实组合式函数，验证深链与身份生命周期。
import test from 'node:test'
import { computed, effectScope, ref } from 'vue'
import { usePurchasePayableDetail } from '../../src/views/workbenches/purchase-payments/use-purchase-payable-detail'

const id = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const flush = () => new Promise(resolve => setImmediate(resolve))
function order(status = 'PENDING_PAYMENT', payableId = id) {
  return { id: 'order', items: [{ id: payableId, status, remainingAmount: '7.00' }] } as PurchasePayableOrderDto
}
function fixture() {
  const scope = effectScope()
  const enabled = ref(false)
  const epoch = ref(1)
  const routeId = ref(id)
  const kind = ref<'payable' | 'order'>('payable')
  const calls: Array<{ id: string, signal: AbortSignal, kind?: string }> = []
  let response = async () => ({ data: order() })
  const state = scope.run(() => usePurchasePayableDetail(computed(() => ({ id: routeId.value, kind: kind.value })), enabled, epoch, {
    getByOrder: (id, signal) => {
      calls.push({ id, signal, kind: 'order' })
      return response()
    },
    get: (id, signal) => {
      calls.push({ id, signal })
      return response()
    },
  }))!
  return { scope, enabled, epoch, routeId, kind, calls, state, respond: (fn: typeof response) => response = fn }
}

test('授权后按链接 UUID 精确读取，已付款的旧链接仍展示状态，加载不会付款', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.equal(f.calls.length, 0)
  f.enabled.value = true
  await flush()
  assert.equal(f.calls[0]?.id, id)
  assert.equal(f.state.selection.value?.item.id, id)
  f.respond(async () => ({ data: order('PAID') }))
  await f.state.load()
  assert.equal(f.state.selection.value?.item.status, 'PAID')
  assert.equal(f.state.loading.value, false)
})

test('切换款项、账号或撤销权限时清除旧数据，迟到响应不能回填', async (context) => {
  for (const reason of ['id', 'epoch', 'permission']) {
    const f = fixture()
    context.after(() => f.scope.stop())
    let finish!: (value: { data: PurchasePayableOrderDto }) => void
    f.respond(() => new Promise(resolve => finish = resolve))
    f.enabled.value = true
    const oldFinish = finish
    const oldRequest = f.calls[0]!
    if (reason === 'id') {
      f.routeId.value = secondId
    }
    if (reason === 'epoch') {
      f.epoch.value++
    }
    if (reason === 'permission') {
      f.enabled.value = false
    }
    assert.equal(oldRequest.signal.aborted, true)
    oldFinish({ data: order() })
    await flush()
    assert.equal(f.state.selection.value, null)
  }
})

test('畸形链接不请求接口，接口失败和错配的款项不能显示付款表单', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.routeId.value = 'invalid'
  f.enabled.value = true
  await flush()
  assert.equal(f.calls.length, 0)
  assert.equal(f.state.invalid.value, true)
  f.respond(async () => {
    throw Object.assign(new Error('Purchase payable not found'), { status: 404 })
  })
  f.routeId.value = id
  await flush()
  assert.equal(f.state.selection.value, null)
  assert.equal(f.state.error.value, 'Purchase payable not found')
  f.respond(async () => ({ data: order('PENDING_PAYMENT', secondId) }))
  await f.state.load()
  assert.equal(f.state.selection.value, null)
  assert.equal(f.state.invalid.value, true)
})

test('订单链接按精确订单读取，优先待付款项并允许在定金和尾款间切换，成功后保留当前款项', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.kind.value = 'order'
  const data = { ...order(), id, items: [
    { id: secondId, paymentType: 'BALANCE', status: 'PENDING_PAYMENT', remainingAmount: '7.00' },
    { id: 'deposit', paymentType: 'DEPOSIT', status: 'PAID', remainingAmount: '0.00' },
  ] } as PurchasePayableOrderDto
  f.respond(async () => ({ data }))
  f.enabled.value = true
  await flush()
  assert.equal(f.calls[0]?.kind, 'order')
  assert.equal(f.calls[0]?.id, id)
  assert.equal(f.state.selection.value?.item.id, secondId)
  f.state.selectPayable('deposit')
  assert.equal(f.state.selection.value?.item.id, 'deposit')
  f.state.selectPayable('unrelated')
  assert.equal(f.state.selection.value?.item.id, 'deposit')
  f.state.selectPayable(secondId)
  f.state.applyOrder({ ...data, items: data.items.map(item => ({ ...item, status: 'PAID' })) })
  assert.equal(f.state.selection.value?.item.id, secondId)
  assert.equal(f.state.selection.value?.item.status, 'PAID')
  f.respond(async () => ({ data: { ...data, id: 'wrong-order' } }))
  await f.state.load()
  assert.equal(f.state.selection.value, null)
  assert.equal(f.state.order.value, null)
  assert.equal(f.state.invalid.value, true)
})
