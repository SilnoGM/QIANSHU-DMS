import type { PurchaseShipmentStatusCountsDto } from '../../src/api/generated/types.gen'
import type { PurchaseShipmentCountsQuery, PurchaseShipmentListQuery } from '../../src/api/modules/purchase-shipments'
import type { ShipmentListQuery } from '../../src/views/workbenches/shipments/logic'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证到仓页计数快照、失败和取消边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useWarehouseArrivalData } from '../../src/views/operations/warehouse-arrivals/use-warehouse-arrival-data'

function counts(): PurchaseShipmentStatusCountsDto {
  return {
    items: [{ value: 'SHIPPED', count: 5 }, { value: 'WAREHOUSE_RECEIVED', count: 7 }],
    buyerOptions: [],
    warehouseCounts: [
      { value: 'north', items: [{ value: 'SHIPPED', count: 3 }, { value: 'WAREHOUSE_RECEIVED', count: 1 }] },
      { value: 'other', items: [{ value: 'SHIPPED', count: 2 }, { value: 'WAREHOUSE_RECEIVED', count: 6 }] },
    ],
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index++) {
    await nextTick()
  }
}

function fixture(enabledValue = true) {
  const enabled = ref(enabledValue)
  const epoch = ref(1)
  const query = ref<ShipmentListQuery>({
    view: 'WAREHOUSE_RECEIVED',
    page: 1,
    pageSize: 20,
    keyword: '椅子',
    destinationWarehouseValue: 'north',
    destinationWarehouseMissing: true,
  })
  const calls: { query: PurchaseShipmentCountsQuery, signal: AbortSignal }[] = []
  const listCalls: PurchaseShipmentListQuery[] = []
  const api = {
    list: async (value: PurchaseShipmentListQuery): Promise<any> => {
      listCalls.push(value)
      return { data: { items: [{ id: 'part-1' }], total: 1 } }
    },
    statusCounts: async (value: PurchaseShipmentCountsQuery, signal: AbortSignal): Promise<any> => {
      calls.push({ query: value, signal })
      return { data: counts() }
    },
    getById: async (id: string): Promise<any> => ({ data: { id } }),
  }
  const scope = effectScope()
  const state = scope.run(() => useWarehouseArrivalData(enabled, epoch, query, () => {}, api, api))!
  return { enabled, epoch, query, calls, listCalls, api, scope, state }
}

test('失活时不请求；列表保留仓库条件，计数请求剥离仓库条件并一次带回归属仓库计数', async (context) => {
  const f = fixture(false)
  context.after(() => f.scope.stop())
  await flush()
  assert.deepEqual(f.calls, [])

  f.enabled.value = true
  await flush()
  assert.equal(f.listCalls[0]?.destinationWarehouseValue, 'north')
  assert.deepEqual(f.calls.map(call => call.query), [{ keyword: '椅子' }])
  assert.deepEqual(f.state.counts.value, counts().items)
  assert.deepEqual(f.state.warehouseCounts.value, counts().warehouseCounts)
})

test('切换仓库不缩小上层总数，仓库计数保持不变', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  await flush()
  const originalCounts = f.state.counts.value
  const originalWarehouseCounts = f.state.warehouseCounts.value

  f.query.value = { ...f.query.value, destinationWarehouseValue: 'other' }
  await flush()

  assert.deepEqual(f.state.counts.value, originalCounts)
  assert.deepEqual(f.state.warehouseCounts.value, originalWarehouseCounts)
  assert.equal(f.calls.at(-1)?.query.destinationWarehouseValue, undefined)
})

test('计数失败时不显示假零，重试可恢复', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  await flush()
  const statusCounts = f.api.statusCounts
  let fail = true
  f.api.statusCounts = async (query, signal) => {
    if (fail) {
      throw new Error('counts unavailable')
    }
    return statusCounts(query, signal)
  }

  await f.state.loadCounts()
  await flush()
  assert.equal(f.state.countsError.value, true)
  assert.equal(f.state.warehouseCountsError.value, true)
  assert.deepEqual(f.state.warehouseCounts.value, [])

  fail = false
  await f.state.loadCounts()
  await flush()
  assert.equal(f.state.countsError.value, false)
  assert.equal(f.state.warehouseCountsError.value, false)
  assert.deepEqual(f.state.warehouseCounts.value, counts().warehouseCounts)
})

test('重取、改筛选、撤权、身份变化和销毁均取消旧计数读取并忽略迟到结果', async (context) => {
  for (const change of ['refresh', 'query', 'permission', 'identity', 'dispose'] as const) {
    const f = fixture()
    context.after(() => f.scope.stop())
    await flush()
    let finish!: () => void
    let oldSignal!: AbortSignal
    f.api.statusCounts = async (_query, signal) => {
      oldSignal = signal
      return new Promise(resolve => finish = () => resolve({ data: counts() }))
    }

    const pending = f.state.loadCounts()
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
    if (change === 'dispose') {
      f.scope.stop()
    }
    await flush()
    finishOld()
    await flush()
    await pending.catch(() => undefined)
    assert.equal(signal.aborted, true, change)
    assert.deepEqual(f.state.warehouseCounts.value, [], change)
    assert.equal(f.state.warehouseCountsError.value, false, change)
  }
})
