import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证实际读取流程的取消和权限边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useShipmentData } from '../../src/views/workbenches/shipments/use-shipment-data'

function fixture() {
  const enabled = ref(false)
  const epoch = ref(1)
  const query = ref({ view: 'ALL' as const, page: 1, pageSize: 20 })
  const calls: string[] = []
  const api = {
    list: async (_query: unknown, _signal: AbortSignal): Promise<any> => {
      calls.push('list')
      return { data: { items: [{ id: 'part-1' }], total: 1 } }
    },
    statusCounts: async (_query: unknown, _signal: AbortSignal): Promise<any> => {
      calls.push('counts')
      return { data: { items: [{ value: 'ALL', count: 1 }], buyerOptions: [] } }
    },
    getById: async (_id: string, _signal: AbortSignal): Promise<any> => ({ data: { id: _id } }),
  }
  const scope = effectScope()
  const invalidPages: number[] = []
  const state = scope.run(() => useShipmentData(enabled, epoch, query, page => invalidPages.push(page), api, api))!
  return { enabled, epoch, query, calls, api, scope, state, invalidPages }
}

test('无读取权限不发请求，列表与计数独立处理失败并支持重试', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.deepEqual(f.calls, [])
  f.api.statusCounts = async () => {
    throw new Error('counts failed')
  }
  f.enabled.value = true
  await nextTick()
  assert.equal(f.state.rows.value.length, 1)
  assert.equal(f.state.countsError.value, true)
  f.api.statusCounts = async () => ({ data: { items: [{ value: 'ALL', count: 1 }], buyerOptions: [] } })
  await f.state.loadCounts()
  assert.equal(f.state.countsError.value, false)
  assert.equal(f.state.counts.value[0]?.count, 1)
})

test('新视图、权限撤回或身份变化后迟到响应不得恢复旧数据', async (context) => {
  for (const change of ['view', 'permission', 'identity']) {
    const f = fixture()
    context.after(() => f.scope.stop())
    let finish!: () => void
    let signal!: AbortSignal
    f.api.list = (_query, requestSignal) => new Promise((resolve) => {
      signal = requestSignal
      finish = () => resolve({ data: { items: [{ id: 'old' }], total: 1 } })
    })
    f.enabled.value = true
    const finishOld = finish
    const oldSignal = signal
    if (change === 'view') {
      f.query.value = { ...f.query.value, page: 2 }
    }
    if (change === 'permission') {
      f.enabled.value = false
    }
    if (change === 'identity') {
      f.epoch.value++
    }
    finishOld()
    await nextTick()
    assert.equal(oldSignal.aborted, true)
    assert.equal(f.state.rows.value.length, 0)
  }
})

test('切换货件后忽略旧详情，关闭后取消请求，空尾页归一到有效页', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.enabled.value = true
  await nextTick()
  let finish!: () => void
  f.api.getById = id => new Promise((resolve) => {
    finish = () => resolve({ data: { id } })
  })
  const first = f.state.openShipment('part-old')
  const finishFirst = finish
  const second = f.state.openShipment('part-new')
  const finishSecond = finish
  finishFirst()
  await first
  assert.equal(f.state.detail.value, null)
  f.state.detailKind.value = null
  finishSecond()
  await second
  assert.equal(f.state.detail.value, null)
  f.api.list = async () => ({ data: { items: [], total: 21 } })
  f.query.value = { ...f.query.value, page: 3 }
  await nextTick()
  assert.deepEqual(f.invalidPages, [2])
})
