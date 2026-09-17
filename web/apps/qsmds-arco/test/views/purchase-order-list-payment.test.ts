import type { PurchaseOrderListItemDto, PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行真实弹窗状态，验证读取最新款项、显式选择与剪贴板副作用。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, shallowRef, watch } from 'vue'
import { buildPurchasePayableLinkText, canPayPurchasePayable } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)
const order = { id: '11111111-1111-4111-8111-111111111111', orderNo: 'PO/20260916-00016', customerName: '客户甲', purchaseType: 'SALES_LINKED', orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID' } as PurchaseOrderListItemDto
const payableOrder = { id: order.id, orderNo: order.orderNo, items: [
  { id: 'deposit', paymentType: 'DEPOSIT', status: 'PENDING_PAYMENT', dueAmount: '100.00', remainingAmount: '80.50' },
  { id: 'balance', paymentType: 'BALANCE', status: 'PENDING_PAYMENT', dueAmount: '200.00', remainingAmount: '200.00' },
] } as PurchasePayableOrderDto
async function fixture() {
  const source = await readFile(new URL('purchase-order-list-payment-action.vue', ROOT), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const scope = effectScope()
  const props = reactive({ active: true })
  const account = reactive({ authEpoch: 1 })
  const permission = reactive({ allowed: true })
  const copied: string[] = []
  const messages: string[] = []
  const navigation: unknown[] = []
  const reads: { id: string, signal: AbortSignal }[] = []
  const lifecycle: Record<string, () => void> = {}
  let write = async () => {}
  let read = async () => ({ data: structuredClone(payableOrder) })
  let detail = { ...order }
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}; ({ open, reload, copy, reset, visible, selectedId, loadingOrderId, copying, error })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    shallowRef,
    watch,
    AbortController,
    defineProps: () => props,
    defineEmits: () => (name: string) => messages.push(name),
    defineExpose: () => {},
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => permission.allowed }),
    useAppAccountStore: () => account,
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useQsToast: () => ({ success: (message: string) => messages.push(message), warning: (message: string) => messages.push(message), error: (message: string) => messages.push(message) }),
    useRouter: () => ({ resolve: (location: { name: string, params: { id: string } }) => {
      assert.equal(location.name, 'qsFinanceRealtimePurchasePayablePayment')
      return { href: `/dms/#/qs-finance/realtime-payments/purchase-payments/${location.params.id}` }
    }, push: (value: unknown) => navigation.push(value) }),
    purchaseOrderPayablesApi: { getByOrder: (id: string, signal: AbortSignal) => {
      reads.push({ id, signal })
      return read()
    } },
    purchaseOrdersApi: { getById: async () => ({ data: detail }) },
    getPurchaseOrderApiFailure: (error: Error) => ({ message: error.message }),
    isPurchaseOrderAbortError: (error: Error) => error.name === 'AbortError',
    navigator: { clipboard: { writeText: (text: string) => {
      copied.push(text)
      return write()
    } } },
    window: { location: { href: 'https://dms.example/dms/#/qs-operations/pending-purchase-orders' } },
    onDeactivated: (fn: () => void) => lifecycle.deactivate = fn,
    onBeforeUnmount: (fn: () => void) => lifecycle.unmount = fn,
    buildPurchasePayableLinkText,
    canPayPurchasePayable,
  })) as {
    open: (order: PurchaseOrderListItemDto) => Promise<void>
    reload: () => Promise<void>
    copy: () => Promise<void>
    reset: () => void
    loadingOrderId: { value: string | null }
    visible: { value: boolean }
    selectedId: { value: string | undefined }
    copying: { value: boolean }
    error: { value: string | null }
  }
  return { state, props, account, permission, copied, reads, messages, navigation, lifecycle, setRead: (fn: typeof read) => read = fn, setDetail: (value: typeof detail) => detail = value, setWrite: (fn: typeof write) => write = fn, dispose: () => scope.stop() }
}

test('打开先读取最新定金尾款，明确选择后复制对应款项链接与待付金额，不跳转或付款', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.setDetail({ ...order, customerName: '最新客户' })
  await f.state.open(order)
  assert.equal(f.state.visible.value, true)
  assert.equal(f.state.selectedId.value, undefined)
  assert.equal(f.reads.length, 1)
  assert.deepEqual(f.copied, [])
  await f.state.copy()
  assert.deepEqual(f.copied, [])
  f.state.selectedId.value = 'deposit'
  await f.state.copy()
  assert.deepEqual(f.copied, ['我需要为【最新客户】的订单【PO/20260916-00016】付【定金】：80.50 元。\n\n付款链接：\nhttps://dms.example/dms/#/qs-finance/realtime-payments/purchase-payments/deposit'])
  assert.deepEqual(f.navigation, [])
  assert.equal(f.messages.at(-1), 'purchaseOrderList.payment.copied')
  assert.equal(f.state.visible.value, false)
  assert.equal(f.state.selectedId.value, undefined)
  assert.equal(f.state.copying.value, false)
  await f.state.open(order)
  assert.equal(f.state.selectedId.value, undefined)
  f.state.selectedId.value = 'balance'
  await f.state.copy()
  assert.match(f.copied[1]!, /付【尾款】：200\.00 元。/)
  assert.match(f.copied[1]!, /\/balance$/)
})

test('复制期间防止双击，失败后仍可重试原选择', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  await f.state.open(order)
  f.state.selectedId.value = 'deposit'
  let finish!: () => void
  f.setWrite(() => new Promise(resolve => finish = resolve))
  const pending = f.state.copy()
  await f.state.copy()
  assert.equal(f.copied.length, 1)
  assert.equal(f.state.visible.value, true)
  finish()
  await pending
  assert.equal(f.state.visible.value, false)
  await f.state.open(order)
  f.state.selectedId.value = 'deposit'
  f.setWrite(async () => {
    throw new Error('Clipboard denied')
  })
  await f.state.copy()
  assert.equal(f.messages.at(-1), 'purchasePayment.copyFailed')
  assert.equal(f.state.visible.value, true)
  assert.equal(f.state.selectedId.value, 'deposit')
  f.setWrite(async () => {})
  await f.state.copy()
  assert.equal(f.messages.at(-1), 'purchaseOrderList.payment.copied')
  assert.equal(f.state.visible.value, false)
})

test('已付清、零应付、已取消或伪造的款项不能复制，读取失败可以重新加载', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.setRead(async () => {
    throw new Error('读取失败')
  })
  await f.state.open(order)
  assert.equal(f.state.error.value, '读取失败')
  await f.state.copy()
  for (const status of ['PAID', 'NO_PAYMENT', 'CANCELLED'] as const) {
    f.setRead(async () => ({ data: { ...payableOrder, items: payableOrder.items.map(item => ({ ...item, status, remainingAmount: '0.00' })) } }))
    await f.state.reload()
    f.state.selectedId.value = 'deposit'
    await f.state.copy()
  }
  f.setRead(async () => ({ data: structuredClone(payableOrder) }))
  await f.state.reload()
  assert.equal(f.state.error.value, null)
  f.state.selectedId.value = 'foreign-payable'
  await f.state.copy()
  assert.deepEqual(f.copied, [])
})

test('未激活、无权限、未审核或已付清行均不读取付款资料', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.permission.allowed = false
  await f.state.open(order)
  f.permission.allowed = true
  f.props.active = false
  await f.state.open(order)
  f.props.active = true
  for (const orderStatus of ['PENDING_REVIEW', 'CANCELLED', 'COMPLETED'] as const) {
    await f.state.open({ ...order, orderStatus })
  }
  await f.state.open({ ...order, paymentStatus: 'PAID' })
  assert.equal(f.reads.length, 0)
  assert.deepEqual(f.copied, [])
})

test('关闭、身份、权限及页面变化时中断读取，不让迟到数据重新打开弹窗', async (context) => {
  for (const change of ['close', 'identity', 'permission', 'view', 'deactivate', 'unmount']) {
    const f = await fixture()
    context.after(f.dispose)
    let finish!: (value: { data: PurchasePayableOrderDto }) => void
    f.setRead(() => new Promise(resolve => finish = resolve))
    const pending = f.state.open(order)
    if (change === 'close') {
      f.state.reset()
    }
    else if (change === 'identity') {
      f.account.authEpoch++
    }
    else if (change === 'permission') {
      f.permission.allowed = false
    }
    else if (change === 'view') {
      f.props.active = false
    }
    else { f.lifecycle[change]!() }
    assert.equal(f.reads[0]!.signal.aborted, true)
    finish({ data: payableOrder })
    await pending
    assert.equal(f.state.visible.value, false)
    assert.equal(f.state.loadingOrderId.value, null)
    assert.deepEqual(f.copied, [])
  }
})

test('身份变化后丢弃迟到剪贴板反馈', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  await f.state.open(order)
  f.state.selectedId.value = 'deposit'
  let finish!: () => void
  f.setWrite(() => new Promise(resolve => finish = resolve))
  const pending = f.state.copy()
  f.account.authEpoch++
  finish()
  await pending
  assert.equal(f.state.visible.value, false)
  assert.deepEqual(f.messages, [])
})

test('待办付款将当前采购单传给复制入口，发货保留原入口', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')
  const start = source.indexOf('function handlePendingAction(')
  const script = source.slice(start, source.indexOf('\nfunction handleDetailUpdated', start))
  const copied: unknown[] = []
  const shipments: string[] = []
  const handle = runInNewContext(ts.transpileModule(`${script}; handlePendingAction`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    canShowPendingAction: () => true,
    paymentActionRef: { value: { open: (value: unknown) => copied.push(value) } },
    openPurchaseFactoryShipment: (order: { id: string }) => shipments.push(order.id),
  }) as (action: { key: string }, order: PurchaseOrderListItemDto) => void
  handle({ key: 'PAYMENT' }, order)
  assert.deepEqual(copied, [order])
  handle({ key: 'PAYMENT' }, { ...order, orderStatus: 'PENDING_REVIEW' })
  assert.equal(copied.length, 1)
  handle({ key: 'SHIPMENT' }, order)
  assert.deepEqual(shipments, [order.id])
})

test('采购详情付款入口按订单号跳转财务页，权限或忙碌时不跳转', async () => {
  const source = await readFile(new URL('purchase-order-detail-actions.vue', ROOT), 'utf8')
  const start = source.indexOf('function openPaymentDialog()')
  const script = source.slice(start, source.indexOf('\nfunction openWarehouseDialog', start))
  const navigations: unknown[] = []
  const canRecordPayment = { value: true }
  const actionLocked = { value: false }
  const open = runInNewContext(ts.transpileModule(`${script}; openPaymentDialog`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    props: { detail: { orderNo: 'PO/20260916-00016' } },
    router: { push: (location: unknown) => navigations.push(location) },
    canRecordPayment,
    actionLocked,
  }) as () => void
  open()
  assert.deepEqual(JSON.parse(JSON.stringify(navigations)), [{ name: 'qsFinanceRealtimePurchasePayments', query: { keyword: 'PO/20260916-00016' } }])
  canRecordPayment.value = false
  open()
  canRecordPayment.value = true
  actionLocked.value = true
  open()
  assert.equal(navigations.length, 1)
})
