import type { PackagingPaymentProfileDto } from '../../src/api/modules/payment-recipients'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 真实组合式函数验证包装配置权限、版本和并发边界。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePackagingPaymentProfile } from '../../src/views/admin/supplier-payment-profiles/use-packaging-payment-profile'

const row: PackagingPaymentProfileDto = { vendor: 'CHENGXIN', vendorName: '沙井·诚信木箱', version: 1, accounts: [], updatedAt: null, updatedBy: null }
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const scope = effectScope()
  const read = ref(false)
  const write = ref(false)
  const epoch = ref(1)
  const reads: Array<{ vendor: string, signal?: AbortSignal }> = []
  const saves: Array<{ vendor: string, data: unknown, signal?: AbortSignal }> = []
  let respond = async () => ({ data: row })
  let mutate = async () => ({ data: { ...row, version: 2 } })
  const state = scope.run(() => usePackagingPaymentProfile(read, write, epoch, {
    getPackagingProfile: (vendor, signal) => {
      reads.push({ vendor, signal })
      return respond()
    },
    savePackagingProfile: (vendor, data, signal) => {
      saves.push({ vendor, data, signal })
      return mutate()
    },
  }))!
  return { scope, read, write, epoch, state, reads, saves, respond: (value: typeof respond) => respond = value, mutate: (value: typeof mutate) => mutate = value }
}

test('包装配置按权限读取，身份改变时清空草稿且忽略迟到响应', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  assert.equal(f.reads.length, 0)
  f.read.value = true
  await flush()
  assert.equal(f.state.profile.value?.vendor, 'CHENGXIN')
  assert.equal(await f.state.save(), false)
  let finish!: (value: { data: PackagingPaymentProfileDto }) => void
  f.respond(() => new Promise(resolve => finish = resolve))
  const pending = f.state.load()
  const request = f.reads.at(-1)!
  f.read.value = false
  f.epoch.value++
  assert.equal(request.signal?.aborted, true)
  finish({ data: row })
  await pending
  assert.equal(f.state.profile.value, null)
  assert.deepEqual(f.state.draft.value, [])
})

test('包装配置拒绝银行及未完成二维码，仅保存当前版本的完整支付宝/微信资料', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  f.state.draft.value = [{ paymentMethod: 'BANK_TRANSFER', recipientName: '厂商', bankName: '银行', bankAccount: '123' }]
  assert.equal(await f.state.save(), false)
  assert.equal(f.state.error.value, 'paymentRecipient.errors.method')
  f.state.draft.value = [{ paymentMethod: 'ALIPAY', recipientName: '厂商' }]
  assert.equal(await f.state.save(), false)
  assert.equal(f.saves.length, 0)
  const account = { paymentMethod: 'WECHAT' as const, recipientName: ' 诚信 ', qrMediaAssetId: 'qr' }
  f.state.draft.value = [account]
  f.mutate(async () => ({ data: { ...row, version: 2, accounts: [{ ...account, recipientName: '诚信', id: 'account', bankName: null, bankAccount: null, bankBranch: null, qrContentUrl: null }] } }))
  assert.equal(f.state.dirty.value, true)
  assert.equal(await f.state.save(), true)
  assert.deepEqual(f.saves[0]?.data, { expectedVersion: 1, accounts: [{ paymentMethod: 'WECHAT', recipientName: '诚信', qrMediaAssetId: 'qr', bankName: null, bankAccount: null, bankBranch: null }] })
  assert.equal(f.state.profile.value?.version, 2)
  assert.equal(f.state.dirty.value, false)
})

test('版本冲突和未知保存结果锁定重试，核对新版本后才能继续保存', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  f.mutate(async () => {
    throw Object.assign(new Error('Conflict'), { kind: 'http', status: 409 })
  })
  assert.equal(await f.state.save(), false)
  assert.equal(f.state.needsRefresh.value, true)
  assert.equal(await f.state.save(), false)
  assert.equal(f.saves.length, 1)
  f.respond(async () => ({ data: { ...row, version: 3 } }))
  await f.state.load()
  assert.equal(f.state.needsRefresh.value, false)
  assert.equal(f.state.profile.value?.version, 3)
  f.mutate(async () => {
    throw Object.assign(new Error('Offline'), { kind: 'network' })
  })
  assert.equal(await f.state.save(), false)
  assert.equal(f.state.error.value, 'supplierPaymentProfile.unknown')
})

test('保存中拒绝重复提交，失去写权限取消并忽略结果', async (context) => {
  const f = fixture()
  context.after(() => f.scope.stop())
  f.read.value = true
  f.write.value = true
  await flush()
  let finish!: (value: { data: PackagingPaymentProfileDto }) => void
  f.mutate(() => new Promise(resolve => finish = resolve))
  const pending = f.state.save()
  assert.equal(await f.state.save(), false)
  f.write.value = false
  assert.equal(f.saves[0]?.signal?.aborted, true)
  finish({ data: { ...row, version: 2 } })
  assert.equal(await pending, false)
})
