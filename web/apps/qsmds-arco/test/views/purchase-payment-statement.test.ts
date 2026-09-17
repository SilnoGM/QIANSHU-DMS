import type { PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import type { PurchasePaymentStatement, StatementImageLabels } from '../../src/views/workbenches/purchase-payments/purchase-payment-statement-image'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 执行生成步骤与剪贴板状态，不写真实付款或系统剪贴板。
import test from 'node:test'
import { effectScope, ref, shallowRef } from 'vue'
import { usePurchasePaymentStatement } from '../../src/views/workbenches/purchase-payments/use-purchase-payment-statement'

function order(id = 'a'): PurchasePayableOrderDto {
  return { id, orderNo: `PO/${id}`, orderDate: '2026-09-17', supplierName: '供应商', currencyCode: 'CNY', purchaseTotalAmount: '100.00', items: [
    { id: `${id}-deposit`, paymentType: 'DEPOSIT', dueAmount: '30.00', paidAmount: '30.00', remainingAmount: '0.00', status: 'PAID', version: 2 },
    { id: `${id}-balance`, paymentType: 'BALANCE', dueAmount: '70.00', paidAmount: '0.00', remainingAmount: '70.00', status: 'PENDING_PAYMENT', version: 1 },
  ] } as PurchasePayableOrderDto
}
function fixture() {
  const enabled = ref(true)
  const epoch = ref(1)
  const orders = shallowRef([order()])
  const supplier = ref('供应商')
  const calls: string[] = []
  const waits: number[] = []
  const revoked: string[] = []
  const copies: Blob[] = []
  const rendered: PurchasePaymentStatement[] = []
  const png = new Blob(['png'], { type: 'image/png' })
  let clock = 0
  let read = async (id: string) => order(id)
  let write = async () => {}
  const scope = effectScope()
  const state = scope.run(() => usePurchasePaymentStatement({ enabled, epoch, orders, supplierName: supplier }, {
    readOrder: (id, signal) => {
      assert.equal(signal.aborted, false)
      calls.push(id)
      return read(id)
    },
    render: async (statement) => {
      rendered.push(statement)
      return png
    },
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    createUrl: () => 'blob:statement',
    revokeUrl: url => revoked.push(url),
    writeClipboard: async (blob) => {
      copies.push(blob)
      await write()
    },
  }))!
  const start = () => state.start(['获取', '计算', '生成'], {} as StatementImageLabels, '2026-09-17 18:00')
  const finish = async () => {
    for (const step of state.steps.value) {
      await step.action()
    }
    state.complete()
    state.markLoaded(state.previewUrl.value!)
  }
  return { state, enabled, epoch, orders, supplier, calls, waits, revoked, copies, rendered, png, start, finish, setRead: (fn: typeof read) => read = fn, setWrite: (fn: typeof write) => write = fn, dispose: () => scope.stop() }
}

test('三步读取所选订单最新详情并计算，两秒后打开单张图片预览，复制成功保持打开', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.setRead(async () => {
    const latest = order()
    latest.items[1]!.paidAmount = '20.00'
    latest.items[1]!.remainingAmount = '50.00'
    return latest
  })
  f.start()
  assert.equal(f.state.generating.value, true)
  assert.equal(f.state.visible.value, false)
  await f.finish()
  assert.deepEqual(f.calls, ['a'])
  assert.equal(f.rendered[0]?.totals.remainingAmount, '50.00')
  assert.ok(f.waits.reduce((sum, ms) => sum + ms, 0) >= 2000)
  assert.equal(f.state.visible.value, true)
  assert.equal(await f.state.copy(), true)
  assert.equal(f.copies[0], f.png)
  assert.equal(f.state.visible.value, true)
})

test('没有选择或没有权限不能生成，重复点击不能开启第二个任务', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.orders.value = []
  f.start()
  assert.equal(f.state.generating.value, false)
  f.orders.value = [order()]
  f.enabled.value = false
  f.start()
  assert.equal(f.state.generating.value, false)
  f.enabled.value = true
  f.start()
  const steps = f.state.steps.value
  f.start()
  assert.equal(f.state.steps.value, steps)
  assert.equal(await f.state.copy(), false)
})

test('身份或选中订单变化后废弃旧读取，不允许迟到任务打开预览', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  let finish!: (value: PurchasePayableOrderDto) => void
  f.setRead(() => new Promise(resolve => finish = resolve))
  f.start()
  const running = f.state.steps.value[0]!.action()
  f.epoch.value++
  finish(order())
  await assert.rejects(running, { name: 'AbortError' })
  assert.equal(f.state.generating.value, false)
  assert.equal(f.state.previewUrl.value, null)
  assert.equal(f.state.visible.value, false)
})

test('剪贴板失败可重试，复制期间阻止重复操作；关闭或换供应商回收图片', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.start()
  await f.finish()
  let reject!: (error: Error) => void
  f.setWrite(() => new Promise((_, fail) => reject = fail))
  const copying = f.state.copy()
  assert.equal(await f.state.copy(), false)
  reject(new Error('Clipboard denied'))
  assert.equal(await copying, false)
  assert.equal(f.state.visible.value, true)
  assert.equal(f.state.copying.value, false)
  f.setWrite(async () => {})
  assert.equal(await f.state.copy(), true)
  f.supplier.value = '另一供应商'
  assert.equal(f.state.visible.value, false)
  assert.deepEqual(f.revoked, ['blob:statement'])
})

test('任一详情读取失败停止生成，不以旧金额或部分订单生成对账单', async (context) => {
  const f = fixture()
  context.after(f.dispose)
  f.setRead(async () => {
    throw new Error('Read failed')
  })
  f.start()
  await assert.rejects(f.state.steps.value[0]!.action(), /Read failed/)
  f.state.fail(new Error('Read failed'))
  assert.equal(f.state.generating.value, false)
  assert.equal(f.state.visible.value, false)
  assert.equal(f.state.previewUrl.value, null)
})
