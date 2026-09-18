import type { PurchasePayableBatchPayDto, PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 批量付款状态机验证上传、幂等及迟到响应，不执行真实资金写入。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { usePurchaseBatchPayment } from '../../src/views/workbenches/purchase-payments/use-purchase-batch-payment'

function order(id: string): PurchasePayableOrderDto {
  return {
    id,
    orderNo: `PO/${id}`,
    orderDate: '2026-09-17',
    supplierName: '供应商',
    salesOrderNo: null,
    purchaseType: 'STOCK',
    currencyCode: 'CNY',
    accountOwnerType: 'COMPANY',
    owner: null,
    purchaseTotalAmount: '10.00',
    paymentRecipientProfile: { id: 'profile', version: 2, accounts: [{ id: 'bank', paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '123', bankBranch: null, qrMediaAssetId: null, qrContentUrl: null }] },
    items: [
      { id: `${id}-deposit`, paymentType: 'DEPOSIT', dueAmount: '3.00', remainingAmount: '0.00', paidAmount: '3.00', status: 'PAID', version: 2, paidAt: null, paidBy: null, paymentReceipt: null },
      { id: `${id}-balance`, paymentType: 'BALANCE', dueAmount: '7.00', remainingAmount: '7.00', paidAmount: '0.00', status: 'PENDING_PAYMENT', version: 1, paidAt: null, paidBy: null, paymentReceipt: null },
    ],
  }
}

function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const uploads: { id: string, file: File, signal: AbortSignal }[] = []
  const payments: { body: PurchasePayableBatchPayDto, key: string, signal: AbortSignal }[] = []
  const reads: { value: string, signal: AbortSignal }[] = []
  let readOrders = async () => ({ data: { items: [order('a'), order('b')] } })
  let upload = async (id: string) => ({ data: { mediaAssetId: `media-${id}` } })
  let pay = async () => ({ data: { orderIds: ['a', 'b'], paymentCount: 2 } })
  let key = 0
  const scope = effectScope()
  const state = scope.run(() => usePurchaseBatchPayment(enabled, epoch, {
    batchSuppliers: async () => ({ data: { items: [{ value: 'supplier', label: '供应商' }] } }) as never,
    batchOrders: (value, signal) => {
      reads.push({ value, signal })
      return readOrders() as never
    },
    uploadVoucher: (id, file, signal) => {
      uploads.push({ id, file, signal })
      return upload(id) as never
    },
    payBatch: (body, requestKey, signal) => {
      payments.push({ body, key: requestKey, signal })
      return pay() as never
    },
  }, () => `key-${++key}`))!
  const file = new File(['screenshot'], 'voucher.png', { type: 'image/png' })
  const input = () => ({ orders: [...state.orders.value], recipientAccountId: 'bank', recipientProfileVersion: 2, paymentMethod: 'BANK_TRANSFER', file })
  const open = async () => {
    await state.reload()
    await state.changeSupplier('supplier')
  }
  return { enabled, epoch, state, reads, uploads, payments, input, open, file, setRead: (fn: typeof readOrders) => readOrders = fn, setUpload: (fn: typeof upload) => upload = fn, setPay: (fn: typeof pay) => pay = fn, dispose: () => scope.stop() }
}

test('选择供应商读取全部订单，同一截图按未付阶段准备，全部上传完成后只发一次批量请求', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  assert.equal(f.reads[0]?.value, 'supplier')
  const result = await f.state.submit(f.input())
  assert.deepEqual(result, { orderIds: ['a', 'b'], paymentCount: 2 })
  assert.deepEqual(f.uploads.map(item => item.id), ['a-balance', 'b-balance'])
  assert.ok(f.uploads.every(item => item.file === f.file))
  assert.equal(f.payments.length, 1)
  assert.deepEqual(f.payments[0]?.body, { supplierValue: 'supplier', recipientAccountId: 'bank', recipientProfileVersion: 2, paymentMethod: 'BANK_TRANSFER', items: [
    { payableId: 'a-balance', expectedVersion: 1, voucher: { mediaAssetId: 'media-a-balance' } },
    { payableId: 'b-balance', expectedVersion: 1, voucher: { mediaAssetId: 'media-b-balance' } },
  ] })
})

test('未选订单、伪造订单、收款资料不符或截图无效不上传也不付款', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  for (const input of [
    { ...f.input(), orders: [] },
    { ...f.input(), orders: [order('foreign')] },
    { ...f.input(), recipientAccountId: 'foreign' },
    { ...f.input(), recipientProfileVersion: 1 },
    { ...f.input(), paymentMethod: 'ALIPAY' },
    { ...f.input(), file: new File([], 'empty.png', { type: 'image/png' }) },
    { ...f.input(), file: new File(['text'], 'text.txt', { type: 'text/plain' }) },
  ]) { assert.equal(await f.state.submit(input), null) }
  assert.equal(f.uploads.length, 0)
  assert.equal(f.payments.length, 0)
})

test('成功后阻止原批次再次提交，重新核对剩余订单后可发起下一批', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  assert.ok(await f.state.submit(f.input()))
  assert.equal(await f.state.submit(f.input()), null)
  assert.equal(f.payments.length, 1)
  f.setRead(async () => ({ data: { items: [order('next')] } }))
  f.setPay(async () => ({ data: { orderIds: ['next'], paymentCount: 1 } }))
  await f.state.reload()
  assert.ok(await f.state.submit(f.input()))
  assert.equal(f.payments.length, 2)
  assert.notEqual(f.payments[0]?.key, f.payments[1]?.key)
  assert.deepEqual(f.payments[1]?.body.items.map(item => item.payableId), ['next-balance'])
})

test('上传阶段失败不会执行批量付款，用户可以修正后重试', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  f.setUpload(async () => {
    throw Object.assign(new Error('上传失败'), { kind: 'network' })
  })
  assert.equal(await f.state.submit(f.input()), null)
  assert.equal(f.state.unknown.value, false)
  assert.equal(f.payments.length, 0)
  f.setUpload(async id => ({ data: { mediaAssetId: `media-${id}` } }))
  assert.ok(await f.state.submit(f.input()))
})

test('未知付款结果锁住原始输入与幂等键，重试不再上传凭证也不接受改选订单', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  f.setPay(async () => {
    throw Object.assign(new Error('连接中断'), { kind: 'network' })
  })
  await f.state.submit(f.input())
  assert.equal(f.state.unknown.value, true)
  await f.state.changeSupplier(null)
  assert.equal(f.state.supplier.value, 'supplier')
  await f.state.reload()
  assert.equal(f.reads.length, 1)
  f.setPay(async () => ({ data: { orderIds: ['a', 'b'], paymentCount: 2 } }))
  await f.state.retrySubmit()
  assert.equal(f.uploads.length, 2)
  assert.equal(f.payments[0]?.key, f.payments[1]?.key)
  assert.deepEqual(f.payments[0]?.body, f.payments[1]?.body)
})

test('重复点击只发一批；版本冲突要求重新核对后再选择', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.open()
  let reject!: (reason: unknown) => void
  f.setPay(() => new Promise((_, fail) => reject = fail))
  const first = f.state.submit(f.input())
  assert.equal(await f.state.submit(f.input()), null)
  await new Promise(resolve => setImmediate(resolve))
  reject(Object.assign(new Error('状态已变化'), { status: 409 }))
  assert.equal(await first, null)
  assert.equal(f.state.stale.value, true)
  assert.equal(f.payments.length, 1)
  assert.equal(await f.state.submit(f.input()), null)
  await f.state.reload()
  assert.equal(f.state.stale.value, false)
  assert.equal(f.reads.length, 2)
})

test('供应商切换隔离迟到订单，退出或权限变化中断上传且不得继续记账', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  await f.state.reload()
  let finishRead!: (value: { data: { items: PurchasePayableOrderDto[] } }) => void
  f.setRead(() => new Promise(resolve => finishRead = resolve))
  const first = f.state.changeSupplier('supplier')
  await f.state.changeSupplier(null)
  finishRead({ data: { items: [order('late')] } })
  await first
  assert.deepEqual(f.state.orders.value, [])
  assert.equal(f.reads[0]?.signal.aborted, true)
  f.setRead(async () => ({ data: { items: [order('a')] } }))
  await f.state.changeSupplier('supplier')
  let finishUpload!: (value: { data: { mediaAssetId: string } }) => void
  f.setUpload(() => new Promise(resolve => finishUpload = resolve))
  const payment = f.state.submit(f.input())
  f.epoch.value++
  assert.equal(f.uploads[0]?.signal.aborted, true)
  finishUpload({ data: { mediaAssetId: 'late-media' } })
  await payment
  assert.equal(f.state.supplier.value, null)
  assert.equal(f.payments.length, 0)
  assert.deepEqual(f.state.orders.value, [])
})
