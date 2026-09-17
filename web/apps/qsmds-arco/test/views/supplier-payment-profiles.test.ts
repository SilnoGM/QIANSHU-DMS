import type { SupplierPaymentProfileDto } from '../../src/api/modules/payment-recipients'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 使用真实组合式函数验证授权和并发边界。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useSupplierPaymentProfiles } from '../../src/views/admin/supplier-payment-profiles/use-supplier-payment-profiles'

const row: SupplierPaymentProfileDto = { supplierValue: 'supplier/a', supplierName: '供应商', supplierEnabled: true, version: 1, accounts: [], updatedAt: null, updatedBy: null }
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const scope = effectScope()
  const read = ref(false)
  const write = ref(false)
  const epoch = ref(1)
  const listCalls: Array<{ signal?: AbortSignal }> = []
  const saveCalls: Array<{ value: string, data: unknown }> = []
  let respond = async () => ({ data: { items: [row], total: 1 } })
  let mutate = async (): Promise<unknown> => ({ data: row })
  const state = scope.run(() => useSupplierPaymentProfiles(read, write, epoch, {
    list: (_query, signal) => {
      listCalls.push({ signal })
      return respond()
    },
    save: (value, data) => {
      saveCalls.push({ value, data })
      return mutate()
    },
  }))!
  return { scope, read, write, epoch, state, listCalls, saveCalls, respond: (value: typeof respond) => respond = value, mutate: (value: typeof mutate) => mutate = value }
}
test('无权限不请求，读取权限只读；退出身份后清空资料，迟到响应不能回填', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.equal(f.listCalls.length, 0)
  f.read.value = true
  await flush()
  f.state.open(row)
  assert.equal(await f.state.save(), false)
  assert.equal(f.saveCalls.length, 0)
  let finish!: (data: { data: { items: SupplierPaymentProfileDto[], total: number } }) => void
  f.respond(() => new Promise(resolve => finish = resolve))
  const pending = f.state.load()
  const oldRequest = f.listCalls.at(-1)!
  f.read.value = false
  f.epoch.value++
  assert.equal(oldRequest.signal?.aborted, true)
  assert.equal(f.state.selected.value, null)
  finish({ data: { items: [row], total: 1 } })
  await pending
  assert.deepEqual(f.state.rows.value, [])
})
test('无效收款资料不保存，可清空配置，使用供应商稳定值及版本保存', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  f.state.open(row)
  f.state.draft.value = [{ paymentMethod: 'ALIPAY', recipientName: '收款人' }]
  assert.equal(await f.state.save(), false)
  assert.equal(f.saveCalls.length, 0)
  assert.equal(f.state.dirty.value, true)
  f.state.draft.value = []
  assert.equal(await f.state.save(), true)
  assert.deepEqual(f.saveCalls, [{ value: 'supplier/a', data: { expectedVersion: 1, accounts: [] } }])
  assert.equal(f.state.selected.value, null)
})
test('网络未知和版本冲突锁住保存，核对只取准确供应商，不复用同名资料', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  f.state.open(row)
  f.mutate(async () => {
    throw Object.assign(new Error('Network failure'), { kind: 'network' })
  })
  assert.equal(await f.state.save(), false)
  assert.equal(f.state.needsRefresh.value, true)
  assert.equal(await f.state.save(), false)
  assert.equal(f.saveCalls.length, 1)
  f.respond(async () => ({ data: { items: [{ ...row, supplierValue: 'other', version: 9 }, { ...row, version: 2 }], total: 2 } }))
  await f.state.recheck()
  assert.equal(f.state.selected.value?.version, 2)
  assert.equal(f.state.selected.value?.supplierValue, row.supplierValue)
  assert.equal(f.state.needsRefresh.value, false)
})
test('保存期间禁止双击和切换供应商；权限收回后忽略保存结果', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  f.state.open(row)
  let finish!: (value: unknown) => void
  f.mutate(() => new Promise(resolve => finish = resolve))
  const pending = f.state.save()
  assert.equal(await f.state.save(), false)
  f.state.open({ ...row, supplierValue: 'other' })
  assert.equal(f.state.selected.value?.supplierValue, row.supplierValue)
  f.write.value = false
  finish({ data: row })
  assert.equal(await pending, false)
  assert.equal(f.state.selected.value, null)
})
