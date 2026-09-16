import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 最小提报上下文避免要求销售单完整读取权限，验证取消边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { usePackagingCostContext } from '../../src/views/operations/warehouse-arrivals/use-packaging-cost-context'

function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const partId = ref<string | null>(null)
  const calls: string[] = []
  const api = { shipmentContext: async (id: string, _signal: AbortSignal): Promise<any> => {
    calls.push(id)
    return { data: { shipmentId: id, owner: { id: 'issuer-1', name: '销售出单人' }, eligible: true, unavailableReason: null } }
  } }
  const scope = effectScope()
  const state = scope.run(() => usePackagingCostContext(enabled, epoch, partId, api))!
  return { enabled, epoch, partId, api, state, calls, scope }
}

test('只读提报专用上下文，归属使用服务端返回的销售出单人；关闭不请求详情', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.deepEqual(f.calls, [])
  f.partId.value = 'part-1'
  await nextTick()
  assert.deepEqual(f.calls, ['part-1'])
  assert.equal(f.state.context.value?.owner?.name, '销售出单人')
  assert.equal(f.state.eligible.value, true)
  f.partId.value = null
  assert.equal(f.state.context.value, null)
})

test('无销售来源或未到仓禁提报，不伪造归属', async (context) => {
  for (const reason of ['noSalesSource', 'invalidShipment']) {
    const f = fixture()
    context.after(() => f.scope.stop())
    f.api.shipmentContext = async shipmentId => ({ data: { shipmentId, owner: null, eligible: false, unavailableReason: reason } })
    f.partId.value = 'part-1'
    await nextTick()
    assert.equal(f.state.context.value?.owner, null)
    assert.equal(f.state.eligible.value, false)
    assert.equal(f.state.unavailableReason.value, reason)
  }
})

test('切换货件、关窗、撤权和身份变化后中止读取且忽略迟到归属', async (context) => {
  for (const change of ['part', 'close', 'permission', 'identity']) {
    const f = fixture()
    context.after(() => f.scope.stop())
    let finish!: (value: unknown) => void
    let signal!: AbortSignal
    f.api.shipmentContext = (_id, nextSignal) => {
      signal = nextSignal
      return new Promise(resolve => finish = resolve)
    }
    f.partId.value = 'part-1'
    const oldSignal = signal
    const finishOld = finish
    if (change === 'part') {
      f.partId.value = 'part-2'
    }
    if (change === 'close') {
      f.partId.value = null
    }
    if (change === 'permission') {
      f.enabled.value = false
    }
    if (change === 'identity') {
      f.epoch.value++
    }
    assert.equal(oldSignal.aborted, true)
    finishOld({ data: { owner: { id: 'stale', name: '旧归属人' } } })
    await nextTick()
    assert.equal(f.state.context.value, null)
  }
})

test('上下文读取失败可重试，不能退回当前账号作为归属', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.api.shipmentContext = async () => {
    throw new Error('offline')
  }
  f.partId.value = 'part-1'
  await nextTick()
  assert.ok(f.state.error.value)
  assert.equal(f.state.eligible.value, false)
  f.api.shipmentContext = async () => ({ data: { owner: { id: 'issuer-2', name: '出单人乙' }, eligible: true } })
  await f.state.reload()
  assert.equal(f.state.error.value, '')
  assert.equal(f.state.context.value?.owner?.name, '出单人乙')
})
