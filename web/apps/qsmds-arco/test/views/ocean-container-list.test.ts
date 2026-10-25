import type { OceanContainerDetailPage, OceanContainerItemsRequest, OceanContainerSummary } from '../../src/components/business/QsOceanContainerList/types'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证卡片按需加载、独立展开和分页边界。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useOceanContainerList } from '../../src/components/business/QsOceanContainerList/use-ocean-container-list'

const summary = (id: string, myItemCount = 22): OceanContainerSummary => ({ id, myItemCount, itemCount: 30, containerBatchName: '0917柜', containerBatchNo: `CTN/${id}`, loadingDate: '2026-09-17', warehouseName: '测试仓库', grossWeightKgTotal: '1234', volumeCaiTotal: '150.125' })
function setup(detailScopeValue: 'mine' | 'all' = 'mine') {
  const items = ref([summary('first'), summary('second'), summary('empty', 0)])
  const details = ref<Record<string, OceanContainerDetailPage | undefined>>({})
  const expanded = ref<string[]>([])
  const disabled = ref(false)
  const detailScope = ref<'mine' | 'all'>(detailScopeValue)
  const requests: OceanContainerItemsRequest[] = []
  const scope = effectScope()
  const state = scope.run(() => useOceanContainerList(items, details, expanded, disabled, request => requests.push(request), detailScope))!
  return { items, details, expanded, disabled, detailScope, requests, state, stop: () => scope.stop() }
}

test('默认收起；首次展开才加载，重复展开或收起不触发请求', () => {
  const s = setup()
  assert.deepEqual(s.requests, [])
  s.state.toggle('first', true)
  s.state.toggle('first', true)
  assert.deepEqual(s.requests, [{ containerId: 'first', page: 1, pageSize: 20 }])
  s.details.value.first = { status: 'loading', items: [], total: 22, page: 1, pageSize: 20 }
  s.state.toggle('first', false)
  s.state.toggle('first', true)
  assert.equal(s.requests.length, 1)
  s.stop()
})

test('多个柜次独立展开；缓存的明细页在收起再展开后保留', () => {
  const s = setup()
  s.details.value.first = { status: 'ready', items: [], total: 22, page: 2, pageSize: 20 }
  s.state.toggle('first', true)
  s.state.toggle('second', true)
  s.state.toggle('first', false)
  assert.deepEqual(s.expanded.value, ['second'])
  s.state.toggle('first', true)
  assert.equal(s.requests.length, 1)
  assert.equal(s.requests[0].containerId, 'second')
  assert.equal(s.details.value.first.page, 2)
  s.stop()
})

test('无本人明细仍可展开整柜空态，未知柜次不触发加载', () => {
  const s = setup()
  s.state.toggle('empty', true)
  s.state.toggle('unknown', true)
  assert.deepEqual(s.expanded.value, ['empty'])
  assert.deepEqual(s.requests, [])
  s.stop()
})

test('全部柜次模式按整柜计数加载，零明细柜次不请求', () => {
  const s = setup('all')
  s.state.toggle('empty', true)
  assert.deepEqual(s.requests, [{ containerId: 'empty', page: 1, pageSize: 20 }])
  s.items.value = [...s.items.value, { ...summary('zero', 0), itemCount: 0 }]
  s.state.toggle('zero', true)
  assert.equal(s.requests.length, 1)
  assert.deepEqual(s.expanded.value, ['empty', 'zero'])
  s.stop()
})

test('明细失败保持局部状态，显式重试加载原页；加载中不重复请求', () => {
  const s = setup()
  s.details.value.first = { status: 'error', items: [], total: 22, page: 2, pageSize: 20, error: '测试错误' }
  s.state.toggle('first', true)
  assert.equal(s.requests.length, 0)
  s.state.retry('first')
  assert.deepEqual(s.requests, [{ containerId: 'first', page: 2, pageSize: 20 }])
  s.details.value.first.status = 'loading'
  s.state.retry('first')
  s.state.paginate('first', 1)
  assert.equal(s.requests.length, 1)
  s.stop()
})

test('按本人明细总数限制分页，不用整柜条数生成额外页面', () => {
  const s = setup()
  s.details.value.first = { status: 'ready', items: [], total: 22, page: 1, pageSize: 20 }
  s.state.toggle('first', true)
  s.state.paginate('first', 1)
  s.state.paginate('first', 99)
  assert.deepEqual(s.requests, [{ containerId: 'first', page: 2, pageSize: 20 }])
  s.state.paginate('first', Number.NaN)
  assert.equal(s.requests.length, 1)
  s.stop()
})

test('列表换页或清空时移除失效展开项，禁用时停止所有请求', () => {
  const s = setup()
  s.state.toggle('first', true)
  s.state.toggle('second', true)
  s.items.value = [summary('second')]
  assert.deepEqual(s.expanded.value, ['second'])
  s.disabled.value = true
  s.state.toggle('second', false)
  s.state.retry('second')
  s.state.paginate('second', 2)
  assert.deepEqual(s.expanded.value, ['second'])
  assert.equal(s.requests.length, 2)
  s.items.value = []
  assert.deepEqual(s.expanded.value, [])
  s.stop()
})
