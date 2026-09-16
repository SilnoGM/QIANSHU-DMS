import type { PurchasePayableDto, PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 真实付款状态机验证幂等重试、权限和迟到响应，不发起财务写入。
import test from 'node:test'
import { effectScope, ref, shallowRef } from 'vue'
import { canPayPurchasePayable, createPurchasePayableGroups } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'
import { usePurchasePayablePayment } from '../../src/views/workbenches/purchase-payments/use-purchase-payable-payment'

const payable = (overrides: Partial<PurchasePayableDto> = {}): PurchasePayableDto => ({ id: 'deposit', paymentType: 'DEPOSIT', dueAmount: '30.00', paidAmount: '0.00', remainingAmount: '30.00', status: 'PENDING_PAYMENT', version: 1, paidAt: null, paidBy: null, ...overrides })
const order = (): PurchasePayableOrderDto => ({ id: 'order', orderNo: 'PO/20260916-00016', orderDate: '2026-09-16', purchaseType: 'SALES_LINKED', supplierName: '供应商', salesOrderNo: 'SO/20260916-00001', purchaseTotalAmount: '100.00', currencyCode: 'CNY', accountOwnerType: 'USER', owner: { id: 'user', name: '张三' }, items: [payable({ id: 'balance', paymentType: 'BALANCE', dueAmount: '70.00', remainingAmount: '70.00' }), payable()] })

function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const selection = shallowRef({ order: order(), item: payable() })
  const calls: Array<{ id: string, body: unknown, key: string, signal: AbortSignal }> = []
  let execute = async () => ({ data: order() })
  let keys = 0
  const scope = effectScope()
  const state = scope.run(() => usePurchasePayablePayment(enabled, epoch, selection, {
    pay: (id, body, key, signal) => {
      calls.push({ id, body, key, signal })
      return execute() as never
    },
  }, () => `key-${++keys}`))!
  return { enabled, epoch, selection, state, calls, setExecute: (value: typeof execute) => execute = value, dispose: () => scope.stop() }
}

test('按采购单保留完整两行并固定定金尾款顺序，父组金额不成为第三条明细', () => {
  const source = order()
  const groups = createPurchasePayableGroups([source])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.id, 'order')
  assert.deepEqual(groups[0]?.children?.map(row => row.payable?.paymentType), ['DEPOSIT', 'BALANCE'])
  assert.deepEqual(source.items.map(item => item.paymentType), ['BALANCE', 'DEPOSIT'])
})

test('仅待付款且余额为正的有效两位金额可付款', () => {
  assert.equal(canPayPurchasePayable(payable()), true)
  for (const status of ['PAID', 'NO_PAYMENT', 'CANCELLED'] as const) {
    assert.equal(canPayPurchasePayable(payable({ status })), false)
  }
  for (const remainingAmount of ['0.00', '-1.00', 'bad', '1.001']) {
    assert.equal(canPayPurchasePayable(payable({ remainingAmount })), false)
  }
})

test('付款方式必填；确认只传版本、字典值与备注，重复点击只发一笔', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  assert.equal(await f.state.submit(), null)
  assert.equal(f.state.fieldError.value, 'paymentMethod')
  assert.equal(f.calls.length, 0)
  f.state.paymentMethod.value = 'BANK_TRANSFER'
  f.state.remark.value = '  采购定金  '
  let finish!: (value: { data: PurchasePayableOrderDto }) => void
  f.setExecute(() => new Promise(resolve => finish = resolve))
  const first = f.state.submit()
  assert.equal(await f.state.submit(), null)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0]?.body, { expectedVersion: 1, paymentMethod: 'BANK_TRANSFER', remark: '采购定金' })
  finish({ data: order() })
  assert.deepEqual(await first, order())
})

test('未知付款结果固定原幂等键和输入快照，重试不会变成第二笔付款', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.state.paymentMethod.value = 'CASH'
  f.setExecute(async () => {
    throw Object.assign(new Error('连接中断'), { kind: 'network' })
  })
  assert.equal(await f.state.submit(), null)
  assert.equal(f.state.unknown.value, true)
  f.state.paymentMethod.value = 'BANK_TRANSFER'
  f.state.remark.value = '变更后的输入'
  f.setExecute(async () => ({ data: order() }))
  await f.state.submit()
  assert.equal(f.calls[0]?.key, f.calls[1]?.key)
  assert.deepEqual(f.calls[0]?.body, f.calls[1]?.body)
})

test('权限或账号变化中止请求并忽略晚到成功，版本冲突阻止继续付款', async (context) => {
  for (const change of ['permission', 'account']) {
    const f = fixture()
    context.after(f.dispose)
    f.state.paymentMethod.value = 'CASH'
    let finish!: (value: { data: PurchasePayableOrderDto }) => void
    f.setExecute(() => new Promise(resolve => finish = resolve))
    const pending = f.state.submit()
    if (change === 'account') {
      f.epoch.value++
    }
    else {
      f.enabled.value = false
    }
    assert.equal(f.calls[0]?.signal.aborted, true)
    finish({ data: order() })
    assert.equal(await pending, null)
  }
  const f = fixture()
  context.after(f.dispose)
  f.state.paymentMethod.value = 'CASH'
  f.setExecute(async () => {
    throw Object.assign(new Error('状态已更新'), { status: 409 })
  })
  await f.state.submit()
  assert.equal(f.state.unknown.value, false)
  assert.equal(f.state.stale.value, true)
  assert.equal(await f.state.submit(), null)
  assert.equal(f.calls.length, 1)
})
