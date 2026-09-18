import type { PackagingCostRequestSummaryDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 金额编辑必须覆盖状态、版本及迟到响应边界。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingAmountEditor } from '../../src/views/operations/warehouse-arrivals/use-packaging-amount-editor'

function record(id: string, status: 'PENDING_PAYMENT' | 'PAID'): PackagingCostRequestSummaryDto {
  return { id, status, version: 2, amount: '123.4500', currencyCode: 'CNY', packagingTypeName: '木箱', packagingVendor: 'CHENGXIN', submittedBy: { id: 'user', name: '提报人' }, submittedAt: '2026-09-18T00:00:00.000Z', paidBy: null, paidAt: null, remark: null }
}
function fixture() {
  const records = ref([record('paid', 'PAID'), record('pending', 'PENDING_PAYMENT')])
  const enabled = ref(true)
  const epoch = ref(1)
  const calls: unknown[][] = []
  const api = { updateAmount: async (...args: unknown[]): Promise<any> => {
    calls.push(args)
    return { data: { ...record('pending', 'PENDING_PAYMENT'), amount: '200.0000', version: 3 } }
  } }
  const scope = effectScope()
  const state = scope.run(() => usePackagingAmountEditor(records, enabled, epoch, api))!
  return { records, enabled, epoch, calls, api, state, scope }
}

test('默认选待付款提报，保存两位金额及读取版本；已付款不可编辑', async (t) => {
  const f = fixture()
  t.after(() => f.scope.stop())
  assert.equal(f.state.selectedId.value, 'pending')
  f.state.start()
  assert.equal(f.state.amount.value, '123.45')
  f.state.amount.value = '200.00'
  const saved = await f.state.save()
  assert.deepEqual(f.calls[0]?.slice(0, 2), ['pending', { amount: '200.00', expectedVersion: 2 }])
  assert.equal(saved?.version, 3)
  assert.equal(f.state.editing.value, false)
  f.state.selectedId.value = 'paid'
  assert.equal(f.state.canEdit.value, false)
  f.state.start()
  assert.equal(f.state.editing.value, false)
  assert.equal(await f.state.save(), null)
  assert.equal(f.calls.length, 1)
})

test('空值、非正数和超两位小数不发请求；取消保留原记录', async (t) => {
  const f = fixture()
  t.after(() => f.scope.stop())
  f.state.start()
  for (const value of [null, '', '0', '-1', '1.001', '1e2']) {
    f.state.amount.value = value
    assert.equal(await f.state.save(), null)
    assert.equal(f.state.invalidAmount.value, true)
  }
  f.state.cancel()
  assert.equal(f.state.editing.value, false)
  assert.equal(f.records.value[1]?.amount, '123.4500')
  assert.equal(f.calls.length, 0)
})

test('重复点击只保存一次；网络失败或状态冲突必须重新读取后再编辑', async (t) => {
  const f = fixture()
  t.after(() => f.scope.stop())
  let reject!: (error: Error) => void
  let count = 0
  f.api.updateAmount = () => {
    count++
    return new Promise((_resolve, fail) => {
      reject = fail
    })
  }
  f.state.start()
  const saving = f.state.save()
  assert.equal(f.state.busy.value, true)
  assert.equal(await f.state.save(), null)
  reject(new Error('offline'))
  await saving
  assert.equal(f.state.needsReload.value, true)
  assert.ok(f.state.error.value)
  assert.equal(await f.state.save(), null)
  assert.equal(count, 1)
  f.records.value = [record('pending', 'PAID')]
  assert.equal(f.state.needsReload.value, false)
  assert.equal(f.state.canEdit.value, false)
})

test('关闭、换身份、撤权或换记录后丢弃旧保存结果', async (t) => {
  for (const change of ['close', 'identity', 'records', 'selection']) {
    const f = fixture()
    t.after(() => f.scope.stop())
    let resolve!: (data: unknown) => void
    let signal!: AbortSignal
    f.api.updateAmount = (...args) => {
      signal = args[2] as AbortSignal
      return new Promise((finish) => {
        resolve = finish
      })
    }
    f.state.start()
    const saving = f.state.save()
    if (change === 'close') {
      f.enabled.value = false
    }
    if (change === 'identity') {
      f.epoch.value++
    }
    if (change === 'records') {
      f.records.value = []
    }
    if (change === 'selection') {
      f.state.selectedId.value = 'paid'
    }
    assert.equal(signal.aborted, true)
    resolve({ data: record('pending', 'PENDING_PAYMENT') })
    assert.equal(await saving, null)
    assert.equal(f.state.busy.value, false)
  }
})
