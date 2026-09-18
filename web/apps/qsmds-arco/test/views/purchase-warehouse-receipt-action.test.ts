import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证入仓异步生命周期与写入重试边界。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useWarehouseReceipt } from '../../src/views/operations/purchase-orders/use-warehouse-receipt'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (value: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const detail = { id: 'order', version: 4 } as PurchaseOrderDetailDto
const payload = { expectedVersion: 4, partIds: ['part'], receivedAt: '2026-09-15T06:30:00.000Z' }
function setup(api: Parameters<typeof useWarehouseReceipt>[3]) {
  const enabled = ref(true)
  const epoch = ref(1)
  const saved: PurchaseOrderDetailDto[] = []
  const scope = effectScope()
  const action = scope.run(() => useWarehouseReceipt(enabled, epoch, value => saved.push(value), api))!
  return { action, enabled, epoch, saved, stop: () => scope.stop() }
}

test('单件入口读最新订单、保留范围；成功先解锁再关闭且只回调一次', async () => {
  const request = deferred<{ data: PurchaseOrderDetailDto }>()
  let writes = 0
  const state = setup({ getById: async () => ({ data: detail }), recordWarehouseReceipt: async () => {
    writes++
    return request.promise
  } })
  await state.action.open('order', ['part'])
  assert.equal(state.action.detail.value?.version, 4)
  assert.deepEqual(state.action.scopeIds.value, ['part'])
  const pending = state.action.submit(payload)
  await state.action.submit(payload)
  assert.equal(writes, 1)
  assert.equal(state.action.submitting.value, true)
  request.resolve({ data: { ...detail, version: 5 } })
  await pending
  assert.equal(state.action.submitting.value, false)
  assert.equal(state.action.visible.value, false)
  assert.equal(state.saved[0]?.version, 5)
  state.stop()
})

test('不确定写入失败禁止直接重发，必须重新读取最新版本和状态', async () => {
  let writes = 0
  let version = 4
  const state = setup({ getById: async () => ({ data: { ...detail, version } }), recordWarehouseReceipt: async () => {
    writes++
    throw new Error('网络中断')
  } })
  await state.action.open('order')
  await state.action.submit(payload)
  assert.equal(state.action.needsReload.value, true)
  assert.equal(state.action.visible.value, true)
  await state.action.submit(payload)
  assert.equal(writes, 1)
  version = 5
  await state.action.reload()
  assert.equal(state.action.detail.value?.version, 5)
  assert.equal(state.action.needsReload.value, false)
  state.stop()
})

test('无权限不读写；关闭与身份变更取消请求并丢弃迟到结果', async () => {
  const request = deferred<{ data: PurchaseOrderDetailDto }>()
  let calls = 0
  let signal: AbortSignal | undefined
  const state = setup({ getById: async (_id, value) => {
    calls++
    signal = value
    return request.promise
  }, recordWarehouseReceipt: async () => ({ data: detail }) })
  state.enabled.value = false
  await nextTick()
  await state.action.open('order')
  assert.equal(calls, 0)
  state.enabled.value = true
  await nextTick()
  const pending = state.action.open('order')
  state.epoch.value++
  await nextTick()
  assert.equal(signal?.aborted, true)
  request.resolve({ data: detail })
  await pending
  assert.equal(state.action.detail.value, null)
  assert.equal(state.action.visible.value, false)
  assert.equal(state.saved.length, 0)
  state.stop()
})
