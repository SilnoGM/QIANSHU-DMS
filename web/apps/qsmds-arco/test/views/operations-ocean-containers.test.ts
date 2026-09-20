import type { AxiosResponse } from 'axios'
import type { OperationsOceanContainerDto, OperationsOceanContainerLineDto, OperationsOceanContainerLinePageDto, OperationsOceanContainerPageDto } from '../../src/api/generated/types.gen'
import type { OperationsOceanContainerApi } from '../../src/api/modules/operations-ocean-containers'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证身份隔离、按需读取及取消后的旧响应不能回写。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { buildOceanContainerQuery, parseOceanContainerQuery } from '../../src/views/operations/ocean-containers/route-query'
import { useOperationsOceanContainers } from '../../src/views/operations/ocean-containers/use-operations-ocean-containers'

function deferred<T>() {
  let resolve!: (value: AxiosResponse<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<AxiosResponse<T>>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve: (data: T) => resolve({ data } as AxiosResponse<T>), reject }
}
const summary = (id: string): OperationsOceanContainerDto => ({ id, containerBatchNo: `CONTAINER/${id}`, containerBatchName: '0920柜', loadingDate: '2026-09-20', warehouseName: '测试仓库', warehouseValue: 'test', itemCount: 30, myItemCount: 23, grossWeightKgTotal: '100', volumeCaiTotal: '20.00' })
const line = (id = 'line-1'): OperationsOceanContainerLineDto => ({ id, containerBatchId: 'first', version: 1, lineNumber: 1, oceanShippingMarkText: 'L-01~10', goodsName: '测试产品', shipmentNo: 'PKG/01', shippingMark: 'QS/01', salesOrderId: 'sales-1', salesOrderNo: 'SO/01', purchaseOrderId: 'purchase-1', purchaseOrderNo: 'PO/01', recipientName: '收件人', codAmountTwd: null, warehouseReceiptReference: null, recipientPhone: null, recipientAddress: null, packageCount: 10, packageUnit: 'CTN', grossWeightKg: '100', lengthCm: '50', widthCm: '20', heightCm: '30', volumeCai: '20.00', remark: null })

function setup() {
  const enabled = ref(true)
  const epoch = ref(1)
  const query = ref({ page: 1, pageSize: 10, search: undefined as string | undefined })
  const lists: { signal: AbortSignal, result: ReturnType<typeof deferred<OperationsOceanContainerPageDto>> }[] = []
  const items: { id: string, page: number, signal: AbortSignal, result: ReturnType<typeof deferred<OperationsOceanContainerLinePageDto>> }[] = []
  const lines: { id: string, signal: AbortSignal, result: ReturnType<typeof deferred<OperationsOceanContainerLineDto>> }[] = []
  const api: Pick<OperationsOceanContainerApi, 'list' | 'items' | 'item'> = {
    list: (_query, signal) => {
      const result = deferred<OperationsOceanContainerPageDto>()
      lists.push({ signal, result })
      return result.promise
    },
    items: (id, query, signal) => {
      const result = deferred<OperationsOceanContainerLinePageDto>()
      items.push({ id, page: query.page ?? 1, signal, result })
      return result.promise
    },
    item: (_containerId, id, signal) => {
      const result = deferred<OperationsOceanContainerLineDto>()
      lines.push({ id, signal, result })
      return result.promise
    },
  }
  const invalidPages: number[] = []
  const scope = effectScope()
  const state = scope.run(() => useOperationsOceanContainers(enabled, epoch, query, api, page => invalidPages.push(page), { list: '列表失败', items: '明细失败', detail: '详情失败' }))!
  const ready = async () => {
    lists.at(-1)!.result.resolve({ items: [summary('first'), summary('second')], total: 2 })
    await Promise.resolve()
  }
  return { enabled, epoch, query, lists, items, lines, state, ready, invalidPages, stop: () => scope.stop() }
}

test('首次只读概览；明细并行且重复请求合并，往返分页复用缓存', async () => {
  const s = setup()
  assert.equal(s.lists.length, 1)
  assert.equal(s.items.length, 0)
  await s.ready()
  const request = { containerId: 'first', page: 1, pageSize: 20 }
  const first = s.state.requestItems(request)
  await s.state.requestItems(request)
  const second = s.state.requestItems({ ...request, containerId: 'second' })
  assert.equal(s.items.length, 2)
  assert.equal(s.items[0].signal.aborted, false)
  s.items[0].result.resolve({ items: [line()], total: 23 })
  s.items[1].result.resolve({ items: [], total: 0 })
  await Promise.all([first, second])
  const page2 = s.state.requestItems({ ...request, page: 2 })
  s.items[2].result.resolve({ items: [line('line-21')], total: 23 })
  await page2
  await s.state.requestItems(request)
  assert.equal(s.items.length, 3)
  assert.equal(s.state.details.value.first.items[0].id, 'line-1')
  s.stop()
})

test('修改成功后清除该柜所有分页缓存、取消旧读取并保持展开状态', async () => {
  const s = setup()
  await s.ready()
  s.state.expandedIds.value = ['first', 'second']
  const first = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  s.items[0].result.resolve({ items: [line()], total: 23 })
  await first
  const pending = s.state.requestItems({ containerId: 'first', page: 2, pageSize: 20 })
  const refreshed = s.state.refreshItems('first')
  assert.equal(s.items[1].signal.aborted, true)
  assert.equal(s.items[2].page, 2)
  s.items[2].result.resolve({ items: [{ ...line('updated'), codAmountTwd: '200.00' }], total: 23 })
  s.items[1].result.resolve({ items: [line('stale')], total: 23 })
  await Promise.all([pending, refreshed])
  assert.equal(s.state.details.value.first.items[0].id, 'updated')
  assert.deepEqual(s.state.expandedIds.value, ['first', 'second'])
  const back = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  assert.equal(s.items.length, 4)
  s.items[3].result.resolve({ items: [{ ...line(), recipientName: '新收件人' }], total: 23 })
  await back
  assert.equal(s.state.details.value.first.items[0].recipientName, '新收件人')
  s.stop()
  await s.state.refreshItems('first')
  assert.equal(s.items.length, 4)
})

test('搜索和翻页立即清空旧缓存，取消旧请求；晚到结果不能覆盖新查询', async () => {
  const s = setup()
  await s.ready()
  s.state.expandedIds.value = ['first']
  const pending = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  s.query.value = { page: 1, pageSize: 10, search: '0921' }
  assert.equal(s.items[0].signal.aborted, true)
  assert.deepEqual(s.state.expandedIds.value, [])
  assert.deepEqual(s.state.details.value, {})
  s.items[0].result.resolve({ items: [line()], total: 23 })
  await pending
  assert.deepEqual(s.state.details.value, {})
  s.lists[1].result.resolve({ items: [summary('new')], total: 1 })
  await Promise.resolve()
  assert.equal(s.state.rows.value[0].id, 'new')
  s.stop()
})

test('离开、撤权和换身份同步清除敏感数据并终止全部读取', async () => {
  const s = setup()
  await s.ready()
  const pending = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  const detail = s.state.openLine('first', 'line-1')
  s.epoch.value++
  assert.equal(s.items[0].signal.aborted, true)
  assert.equal(s.lines[0].signal.aborted, true)
  assert.equal(s.state.drawerOpen.value, false)
  assert.deepEqual(s.state.rows.value, [])
  s.items[0].result.resolve({ items: [line()], total: 23 })
  s.lines[0].result.resolve(line())
  await Promise.all([pending, detail])
  assert.equal(s.state.selectedLine.value, null)
  assert.deepEqual(s.state.details.value, {})
  s.enabled.value = false
  assert.equal(s.lists.at(-1)!.signal.aborted, true)
  s.lists.at(-1)!.result.resolve({ items: [summary('late')], total: 1 })
  await Promise.resolve()
  assert.deepEqual(s.state.rows.value, [])
  await s.state.reload()
  await s.state.openLine('first', 'line-1')
  assert.equal(s.lists.length, 2)
  assert.equal(s.lines.length, 1)
  s.stop()
})

test('详情每次打开都请求校验，关闭立即取消；旧详情不能覆盖新选择', async () => {
  const s = setup()
  await s.ready()
  const first = s.state.openLine('first', 'line-1')
  const second = s.state.openLine('first', 'line-2')
  assert.equal(s.lines[0].signal.aborted, true)
  s.lines[1].result.resolve(line('line-2'))
  s.lines[0].result.resolve(line('line-1'))
  await Promise.all([first, second])
  assert.equal(s.state.selectedLine.value?.id, 'line-2')
  s.state.closeDrawer()
  assert.equal(s.state.selectedLine.value, null)
  const reopened = s.state.openLine('first', 'line-2')
  assert.equal(s.lines.length, 3)
  s.state.closeDrawer()
  assert.equal(s.lines[2].signal.aborted, true)
  s.lines[2].result.resolve(line('line-2'))
  await reopened
  assert.equal(s.state.selectedLine.value, null)
  s.stop()
})

test('单柜明细失败不影响其他柜次，可原页重试；列表越界交给路由修正', async () => {
  const s = setup()
  await s.ready()
  const request = { containerId: 'first', page: 2, pageSize: 20 }
  const failed = s.state.requestItems(request)
  s.items[0].result.reject({ kind: 'network' })
  await failed
  assert.equal(s.state.details.value.first.status, 'error')
  assert.equal(s.state.details.value.first.page, 2)
  assert.equal(s.state.error.value, '')
  const retry = s.state.requestItems(request)
  s.items[1].result.resolve({ items: [line()], total: 23 })
  await retry
  assert.equal(s.state.details.value.first.status, 'ready')
  s.query.value = { page: 9, pageSize: 10, search: undefined }
  s.lists[1].result.resolve({ items: [], total: 12 })
  await Promise.resolve()
  assert.deepEqual(s.invalidPages, [2])
  s.stop()
})

test('作用域销毁清除数据并阻止所有后续请求与回写', async () => {
  const s = setup()
  await s.ready()
  const pending = s.state.openLine('first', 'line-1')
  s.stop()
  assert.equal(s.lines[0].signal.aborted, true)
  assert.deepEqual(s.state.rows.value, [])
  s.lines[0].result.resolve(line())
  await pending
  assert.equal(s.state.selectedLine.value, null)
  await s.state.reload()
  assert.equal(s.lists.length, 1)
})

test('路由查询只接受有效分页，搜索去空格并保留默认每页十柜', () => {
  assert.deepEqual(parseOceanContainerQuery({ search: '  0920  ', page: '-1', pageSize: '999' }), { page: 1, pageSize: 10, search: '0920' })
  assert.deepEqual(parseOceanContainerQuery({ page: '2.5', search: ['x', 'y'] }), { page: 1, pageSize: 10, search: undefined })
  assert.deepEqual(parseOceanContainerQuery({ page: '1000001', search: '柜'.repeat(200) }), { page: 1, pageSize: 10, search: '柜'.repeat(128) })
  assert.deepEqual(buildOceanContainerQuery({ page: 1, pageSize: 10 }), {})
  assert.deepEqual(buildOceanContainerQuery({ search: '0920', page: 3, pageSize: 50 }), { search: '0920', page: '3', pageSize: '50' })
})

test('后发列表响应先到时，不允许旧列表响应覆盖新查询结果', async () => {
  const s = setup()
  s.query.value = { page: 2, pageSize: 10, search: undefined }
  assert.equal(s.lists[0].signal.aborted, true)
  s.lists[1].result.resolve({ items: [summary('new')], total: 12 })
  await Promise.resolve()
  s.lists[0].result.resolve({ items: [summary('old')], total: 20 })
  await Promise.resolve()
  assert.equal(s.state.rows.value[0].id, 'new')
  assert.equal(s.state.total.value, 12)
  s.stop()
})

test('个人明细归属全部移除时，权威零计数清除旧分页缓存和已展示明细', async () => {
  const s = setup()
  await s.ready()
  const firstPage = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  s.items[0].result.resolve({ items: [line('old-owner-line')], total: 23 })
  await firstPage
  const nextPage = s.state.requestItems({ containerId: 'first', page: 2, pageSize: 20 })
  s.items[1].result.resolve({ items: [], total: 0 })
  await nextPage
  assert.equal(s.state.rows.value[0].myItemCount, 0)
  assert.deepEqual(s.state.details.value.first, { status: 'ready', items: [], total: 0, page: 1, pageSize: 20 })
  await s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  assert.deepEqual(s.state.details.value.first.items, [])
  assert.equal(s.items.length, 2)
  s.stop()
})

test('个人明细总数缩减后回到有效页必须重新读取，不能恢复旧归属缓存', async () => {
  const s = setup()
  await s.ready()
  const firstPage = s.state.requestItems({ containerId: 'first', page: 1, pageSize: 20 })
  s.items[0].result.resolve({ items: [line('old-owner-line')], total: 23 })
  await firstPage
  const nextPage = s.state.requestItems({ containerId: 'first', page: 2, pageSize: 20 })
  s.items[1].result.resolve({ items: [], total: 1 })
  await Promise.resolve()
  assert.equal(s.state.rows.value[0].myItemCount, 1)
  assert.equal(s.items.length, 3)
  assert.equal(s.items[2].page, 1)
  assert.deepEqual(s.state.details.value.first.items, [])
  s.items[2].result.resolve({ items: [line('still-owned-line')], total: 1 })
  await nextPage
  assert.equal(s.state.details.value.first.items[0].id, 'still-owned-line')
  assert.equal(s.state.details.value.first.page, 1)
  s.stop()
})
