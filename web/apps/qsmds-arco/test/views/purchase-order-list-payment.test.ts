import type { PurchaseOrderListItemDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行实际待办采购付款入口，区分复制与财务导航。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import { buildPurchasePayableLinkText } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)
const order = { id: '11111111-1111-4111-8111-111111111111', orderNo: 'PO/20260916-00016', orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID' } as PurchaseOrderListItemDto
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
  const lifecycle: Record<string, () => void> = {}
  let write = async () => {}
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}; ({ open, loadingOrderId })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    defineProps: () => props,
    defineEmits: () => (name: string) => messages.push(name),
    defineExpose: () => {},
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => permission.allowed }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ success: (message: string) => messages.push(message), warning: (message: string) => messages.push(message), error: (message: string) => messages.push(message) }),
    useRouter: () => ({ resolve: (location: { name: string, params: { id: string } }) => {
      assert.equal(location.name, 'qsFinanceRealtimePurchaseOrderPayment')
      return { href: `/dms/#/qs-finance/realtime-payments/purchase-payments/orders/${location.params.id}` }
    }, push: (value: unknown) => navigation.push(value) }),
    navigator: { clipboard: { writeText: (text: string) => {
      copied.push(text)
      return write()
    } } },
    window: { location: { href: 'https://dms.example/dms/#/qs-operations/pending-purchase-orders' } },
    onDeactivated: (fn: () => void) => lifecycle.deactivate = fn,
    onBeforeUnmount: (fn: () => void) => lifecycle.unmount = fn,
    buildPurchasePayableLinkText,
  })) as { open: (order: PurchaseOrderListItemDto) => Promise<void>, loadingOrderId: { value: string | null } }
  return { state, props, account, permission, copied, messages, navigation, lifecycle, setWrite: (fn: typeof write) => write = fn, dispose: () => scope.stop() }
}

test('待办采购付款只复制采购单链接，不导航或读取付款接口，重复点击仅复制一次', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  let finish!: () => void
  f.setWrite(() => new Promise(resolve => finish = resolve))
  const pending = f.state.open(order)
  assert.equal(f.state.loadingOrderId.value, order.id)
  await f.state.open(order)
  finish()
  await pending
  assert.deepEqual(f.copied, [`【PO/20260916-00016付款】https://dms.example/dms/#/qs-finance/realtime-payments/purchase-payments/orders/${order.id}`])
  assert.deepEqual(f.navigation, [])
  assert.equal(f.messages.at(-1), 'purchasePayment.linkCopied')
  assert.equal(f.state.loadingOrderId.value, null)
})

test('剪贴板失败可重试，未激活、无权限、未审核和已付清均不能复制', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.setWrite(async () => {
    throw new Error('Clipboard denied')
  })
  await f.state.open(order)
  assert.equal(f.messages.at(-1), 'purchasePayment.copyFailed')
  f.setWrite(async () => {})
  await f.state.open(order)
  assert.equal(f.messages.at(-1), 'purchasePayment.linkCopied')
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
  assert.equal(f.copied.length, 2)
})

test('身份、权限或页面生命周期变化后不显示迟到复制结果', async (context) => {
  for (const change of ['identity', 'permission', 'view', 'deactivate', 'unmount']) {
    const f = await fixture()
    context.after(f.dispose)
    let finish!: () => void
    f.setWrite(() => new Promise(resolve => finish = resolve))
    const pending = f.state.open(order)
    if (change === 'identity') {
      f.account.authEpoch++
    }
    else if (change === 'permission') {
      f.permission.allowed = false
    }
    else if (change === 'view') {
      f.props.active = false
    }
    else { f.lifecycle[change]!() }
    finish()
    await pending
    assert.deepEqual(f.messages, [])
    assert.equal(f.state.loadingOrderId.value, null)
  }
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
