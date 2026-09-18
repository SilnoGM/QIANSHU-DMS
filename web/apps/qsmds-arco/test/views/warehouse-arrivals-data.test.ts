import type { PurchaseShipmentStatusCountsDto } from '../../src/api/generated/types.gen'
import type { PurchaseShipmentCountsQuery, PurchaseShipmentListQuery } from '../../src/api/modules/purchase-shipments'
import type { ShipmentListQuery } from '../../src/views/workbenches/shipments/logic'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证到仓页两层统计的隔离、失败和取消边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useWarehouseArrivalData } from '../../src/views/operations/warehouse-arrivals/use-warehouse-arrival-data'

function counts(shipped: number, received: number): PurchaseShipmentStatusCountsDto {
  return { items: [{ value: 'SHIPPED', count: shipped }, { value: 'WAREHOUSE_RECEIVED', count: received }], buyerOptions: [] }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index++) {
    await nextTick()
  }
}

function fixture(values: string[] = ['north', 'other']) {
  const enabled = ref(false)
  const epoch = ref(1)
  const query = ref<ShipmentListQuery>({ view: 'WAREHOUSE_RECEIVED', page: 1, pageSize: 20 })
  const warehouseValues = ref<readonly string[]>(values)
  const calls: { query: PurchaseShipmentCountsQuery, signal: AbortSignal }[] = []
  const listCalls: PurchaseShipmentListQuery[] = []
  const api = {
    list: async (value: PurchaseShipmentListQuery): Promise<any> => {
      listCalls.push(value)
      return { data: { items: [{ id: 'part-1' }], total: 1 } }
    },
    statusCounts: async (value: PurchaseShipmentCountsQuery, signal: AbortSignal): Promise<any> => {
      calls.push({ query: value, signal })
      const data = value.destinationWarehouseValue === 'north' ? counts(3, 1) : value.destinationWarehouseValue === 'other' ? counts(2, 6) : counts(5, 7)
      return { data }
    },
    getById: async (id: string): Promise<any> => ({ data: { id } }),
  }
  const scope = effectScope()
  const state = scope.run(() => useWarehouseArrivalData(enabled, epoch, query, () => {}, warehouseValues, api, api))!
  return { enabled, epoch, query, warehouseValues, calls, listCalls, api, scope, state }
}

test('无权限或失活时不请求；仓库统计不修改列表仓库条件，全局统计剥离仓库条件', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.warehouseValues.value = ['north', 'other', 'third']
  await flush()
  assert.deepEqual(f.calls, [])
  f.query.value = { ...f.query.value, keyword: '椅子', destinationWarehouseValue: 'north', destinationWarehouseMissing: true }
  f.enabled.value = true
  await flush()
  assert.equal(f.listCalls[0]?.destinationWarehouseValue, 'north')
  assert.deepEqual(f.calls.map(call => call.query), [
    { keyword: '椅子' },
    { keyword: '椅子', destinationWarehouseValue: 'north' },
    { keyword: '椅子', destinationWarehouseValue: 'other' },
    { keyword: '椅子', destinationWarehouseValue: 'third' },
  ])
  assert.deepEqual(f.state.counts.value, counts(5, 7).items)
  assert.equal(f.state.warehouseCounts.value.length, 3)
})

test('切换仓库不缩小上层总数，单仓库同时保留待到仓和已到仓计数', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.enabled.value = true
  await flush()
  const original = f.state.counts.value
  for (const view of ['SHIPPED', 'WAREHOUSE_RECEIVED'] as const) {
    f.query.value = { ...f.query.value, view, destinationWarehouseValue: 'other' }
    await flush()
    assert.deepEqual(f.state.counts.value, original)
    assert.deepEqual(f.state.warehouseCounts.value, [
      { value: 'north', items: counts(3, 1).items },
      { value: 'other', items: counts(2, 6).items },
    ])
  }
})

test('全局统计和列表不等待慢速仓库统计完成', async (context) => {
  const f = fixture(['north'])
  context.after(() => f.scope.stop())
  let finish!: () => void
  f.api.statusCounts = async (query) => {
    if (!query.destinationWarehouseValue) {
      return { data: counts(5, 7) }
    }
    return new Promise(resolve => finish = () => resolve({ data: counts(3, 1) }))
  }
  f.enabled.value = true
  await flush()
  assert.deepEqual(f.state.counts.value, counts(5, 7).items)
  assert.equal(f.state.rows.value.length, 1)
  assert.deepEqual(f.state.warehouseCounts.value, [])
  finish()
  await flush()
  assert.deepEqual(f.state.warehouseCounts.value, [{ value: 'north', items: counts(3, 1).items }])
})

test('字典延迟返回或新增仓库后重读统计，相同仓库只查询一次', async (context) => {
  const f = fixture([])
  context.after(() => f.scope.stop())
  f.enabled.value = true
  await flush()
  assert.equal(f.calls.length, 1)
  f.warehouseValues.value = ['north', 'other', 'north']
  await flush()
  assert.equal(f.calls.length, 4)
  assert.deepEqual(f.state.warehouseCounts.value.map(item => item.value), ['north', 'other'])
  f.warehouseValues.value = ['north', 'other']
  await flush()
  assert.equal(f.calls.length, 4)
  f.warehouseValues.value = ['other']
  await flush()
  assert.deepEqual(f.state.warehouseCounts.value.map(item => item.value), ['other'])
})

test('某仓库失败不会伪装为零，也不影响全局和其他仓库；重试可恢复', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  let fail = true
  f.api.statusCounts = async (query) => {
    if (fail && query.destinationWarehouseValue === 'other') {
      throw new Error('warehouse unavailable')
    }
    return { data: query.destinationWarehouseValue ? counts(0, 0) : counts(5, 7) }
  }
  f.enabled.value = true
  await flush()
  assert.deepEqual(f.state.warehouseCounts.value, [{ value: 'north', items: counts(0, 0).items }])
  assert.equal(f.state.warehouseCountsError.value, true)
  assert.equal(f.state.countsError.value, false)
  assert.equal(f.state.rows.value.length, 1)
  fail = false
  await f.state.loadCounts()
  await flush()
  assert.equal(f.state.warehouseCountsError.value, false)
  assert.deepEqual(f.state.warehouseCounts.value.map(item => item.value), ['north', 'other'])
})

test('全局统计失败时仓库统计仍可完成', async (context) => {
  const f = fixture(['north'])
  context.after(() => f.scope.stop())
  f.api.statusCounts = async (query) => {
    if (!query.destinationWarehouseValue) {
      throw new Error('global unavailable')
    }
    return { data: counts(3, 1) }
  }
  f.enabled.value = true
  await flush()
  assert.equal(f.state.countsError.value, true)
  assert.equal(f.state.warehouseCountsError.value, false)
  assert.equal(f.state.warehouseCounts.value.length, 1)
})

test('重取、改筛选、撤权、身份变化、字典变化和销毁均取消旧仓库读取并忽略迟到结果', async (context) => {
  for (const change of ['refresh', 'query', 'permission', 'identity', 'catalog', 'dispose']) {
    const f = fixture(['north'])
    context.after(() => f.scope.stop())
    f.enabled.value = true
    await flush()
    let finish!: () => void
    let oldSignal!: AbortSignal
    f.api.statusCounts = async (query, signal) => {
      if (!query.destinationWarehouseValue) {
        return { data: counts(5, 7) }
      }
      oldSignal = signal
      return new Promise(resolve => finish = () => resolve({ data: counts(99, 99) }))
    }
    await f.state.loadCounts()
    assert.deepEqual(f.state.warehouseCounts.value, [])
    const finishOld = finish
    const signal = oldSignal
    if (change === 'refresh') {
      void f.state.loadCounts()
    }
    if (change === 'query') {
      f.query.value = { ...f.query.value, destinationWarehouseValue: 'other' }
    }
    if (change === 'permission') {
      f.enabled.value = false
    }
    if (change === 'identity') {
      f.epoch.value++
    }
    if (change === 'catalog') {
      f.warehouseValues.value = ['other']
    }
    if (change === 'dispose') {
      f.scope.stop()
    }
    await flush()
    finishOld()
    await flush()
    assert.equal(signal.aborted, true, change)
    assert.deepEqual(f.state.warehouseCounts.value, [], change)
    assert.equal(f.state.warehouseCountsError.value, false, change)
  }
})
