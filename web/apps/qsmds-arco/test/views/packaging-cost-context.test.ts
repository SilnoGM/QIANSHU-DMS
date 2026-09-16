import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证费用表单读取的来源及取消边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { usePackagingCostContext } from '../../src/views/operations/warehouse-arrivals/use-packaging-cost-context'

function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const partId = ref<string | null>(null)
  const calls: string[] = []
  const shipments = { getById: async (id: string, _signal: AbortSignal): Promise<any> => {
    calls.push(`shipment:${id}`)
    return { data: { id, viewStatus: 'WAREHOUSE_RECEIVED', salesSource: { id: 'sale-1' } } }
  } }
  const sales = { getById: async (id: string, _signal: AbortSignal): Promise<any> => {
    calls.push(`sales:${id}`)
    return { data: { id, issuer: { id: 'issuer-1', displayName: '销售出单人' } } }
  } }
  const scope = effectScope()
  const state = scope.run(() => usePackagingCostContext(enabled, epoch, partId, shipments, sales))!
  return { enabled, epoch, partId, shipments, sales, state, calls, scope }
}

test('费用归属读取关联销售订单的出单人，关闭时不请求任何详情', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.deepEqual(f.calls, [])
  f.partId.value = 'part-1'
  await nextTick()
  await nextTick()
  assert.deepEqual(f.calls, ['shipment:part-1', 'sales:sale-1'])
  assert.equal(f.state.owner.value?.displayName, '销售出单人')
  assert.equal(f.state.eligible.value, true)
  f.partId.value = null
  assert.equal(f.state.shipment.value, null)
  assert.equal(f.state.owner.value, null)
})

test('没有销售来源或货件已离开到仓状态时，不伪造归属也不继续读销售单', async (context) => {
  for (const received of [true, false]) {
    const f = fixture()
    context.after(() => f.scope.stop())
    f.shipments.getById = async id => ({ data: { id, viewStatus: received ? 'WAREHOUSE_RECEIVED' : 'SHIPPED', salesSource: received ? null : { id: 'sale-1' } } })
    f.partId.value = 'part-1'
    await nextTick()
    assert.deepEqual(f.calls, [])
    assert.equal(f.state.owner.value, null)
    assert.equal(f.state.eligible.value, false)
    assert.equal(f.state.unavailableReason.value, received ? 'noSalesSource' : 'invalidShipment')
  }
})

test('切换货件、关窗、撤权和身份变化后中止读取且忽略迟到归属响应', async (context) => {
  for (const change of ['part', 'close', 'permission', 'identity']) {
    const f = fixture()
    context.after(() => f.scope.stop())
    let finish!: (value: unknown) => void
    let signal!: AbortSignal
    f.sales.getById = (_id, nextSignal) => {
      signal = nextSignal
      return new Promise(resolve => finish = resolve)
    }
    f.partId.value = 'part-1'
    await nextTick()
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
    finishOld({ data: { issuer: { id: 'stale', displayName: '旧归属人' } } })
    await nextTick()
    assert.equal(f.state.owner.value, null)
  }
})

test('来源详情读取失败保留可重试错误，不能退回当前账号作为归属', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.sales.getById = async () => {
    throw new Error('offline')
  }
  f.partId.value = 'part-1'
  await nextTick()
  await nextTick()
  assert.ok(f.state.error.value)
  assert.equal(f.state.eligible.value, false)
  f.sales.getById = async id => ({ data: { id, issuer: { id: 'issuer-2', displayName: '出单人乙' } } })
  await f.state.reload()
  assert.equal(f.state.error.value, '')
  assert.equal(f.state.owner.value?.displayName, '出单人乙')
})
