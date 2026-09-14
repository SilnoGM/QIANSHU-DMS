import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 使用实际页面事件验证付款入口接线。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

async function createFixture() {
  const source = await readFile(new URL('purchase-order-list-payment-action.vue', ROOT), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ active: true, currencies: [] })
  const account = reactive({ authEpoch: 1 })
  const permission = reactive({ allowed: true })
  const current = { id: 'order-1', orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID', outstandingAmount: '100.00' }
  const events: Array<{ name: string, value: unknown }> = []
  const warnings: string[] = []
  const errors: string[] = []
  const requests: Array<{ id: string, signal: AbortSignal }> = []
  const stops: Array<() => void> = []
  const lifecycle: Record<string, () => void> = {}
  let opened = 0
  const api = {
    getById: async (id: string, signal: AbortSignal) => {
      requests.push({ id, signal })
      return { data: current }
    },
  }
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ open, detail, loadingOrderId, busy, applyUpdatedDetail })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    computed,
    nextTick,
    ref,
    shallowRef,
    watch: (...args: Parameters<typeof watch>) => stops.push(watch(...args)),
    defineProps: () => props,
    defineEmits: () => (name: string, value: unknown) => events.push({ name, value }),
    defineExpose: () => {},
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => permission.allowed }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ warning: (message: string) => warnings.push(message), error: (message: string) => errors.push(message) }),
    useTemplateRef: () => ({ value: { openPaymentDialog: () => opened++, cancelPendingRequests: () => {} } }),
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
    purchaseOrdersApi: api,
    getPurchaseOrderApiFailure: (failure: Error) => ({ message: failure.message }),
    isPurchaseOrderAbortError: (failure: Error) => failure.name === 'AbortError',
  }) as {
    open: (id: string) => Promise<void>
    detail: { value: typeof current | null }
    loadingOrderId: { value: string | null }
    busy: { value: boolean }
    applyUpdatedDetail: (value: typeof current) => void
  }
  return {
    state,
    props,
    account,
    permission,
    current,
    events,
    warnings,
    errors,
    requests,
    api,
    lifecycle,
    opened: () => opened,
    dispose: () => stops.forEach(stop => stop()),
  }
}

test('读取最新详情后打开共用表单，加载与提交期间阻止重复入口', async (context) => {
  const fixture = await createFixture()
  context.after(fixture.dispose)
  const pending = fixture.state.open('order-1')
  assert.equal(fixture.state.loadingOrderId.value, 'order-1')
  await fixture.state.open('order-2')
  await pending
  assert.equal(fixture.requests.length, 1)
  assert.equal(fixture.state.detail.value, fixture.current)
  assert.equal(fixture.opened(), 1)
  assert.equal(fixture.state.loadingOrderId.value, null)
  fixture.state.busy.value = true
  await fixture.state.open('order-2')
  assert.equal(fixture.requests.length, 1)
  const updated = { ...fixture.current, paymentStatus: 'PARTIAL', outstandingAmount: '50.00' }
  fixture.state.applyUpdatedDetail(updated)
  assert.equal(fixture.state.detail.value, updated)
  assert.deepEqual(fixture.events, [{ name: 'detailUpdated', value: updated }])
})

test('最新订单已付清或状态不再可付款时提示并请求刷新，读取失败允许重试', async (context) => {
  for (const status of ['PAID', 'CANCELLED', 'PENDING_REVIEW', 'COMPLETED']) {
    const fixture = await createFixture()
    context.after(fixture.dispose)
    if (status === 'PAID') {
      fixture.current.paymentStatus = status
    }
    else {
      fixture.current.orderStatus = status
    }
    await fixture.state.open('order-1')
    assert.equal(fixture.opened(), 0)
    assert.equal(fixture.state.detail.value, null)
    assert.equal(fixture.warnings.length, 1)
    assert.equal(fixture.events[0]?.name, 'stale')
  }
  const fixture = await createFixture()
  context.after(fixture.dispose)
  const getById = fixture.api.getById
  fixture.api.getById = async () => {
    throw new Error('读取失败')
  }
  await fixture.state.open('order-1')
  assert.deepEqual(fixture.errors, ['读取失败'])
  assert.equal(fixture.state.loadingOrderId.value, null)
  fixture.api.getById = getById
  await fixture.state.open('order-1')
  assert.equal(fixture.opened(), 1)
})

test('离开视图、身份或权限变化、卸载后忽略迟到详情与错误', async (context) => {
  for (const change of ['view', 'identity', 'permission', 'deactivate', 'unmount']) {
    for (const outcome of ['success', 'failure']) {
      const fixture = await createFixture()
      context.after(fixture.dispose)
      let finish!: () => void
      let signal!: AbortSignal
      fixture.api.getById = (_id, requestSignal) => new Promise((resolve, reject) => {
        signal = requestSignal
        finish = () => outcome === 'success' ? resolve({ data: fixture.current }) : reject(new Error('迟到错误'))
      })
      const pending = fixture.state.open('order-1')
      if (change === 'view') {
        fixture.props.active = false
      }
      else if (change === 'identity') {
        fixture.account.authEpoch++
      }
      else if (change === 'permission') {
        fixture.permission.allowed = false
      }
      else {
        fixture.lifecycle[change]!()
      }
      await nextTick()
      assert.equal(signal.aborted, true)
      finish()
      await pending
      assert.equal(fixture.opened(), 0)
      assert.equal(fixture.state.detail.value, null)
      assert.deepEqual(fixture.errors, [])
      assert.deepEqual(fixture.events, [])
    }
  }
})

test('待付款列表进入共用付款流程，发货仍保留原入口', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')
  const start = source.indexOf('function handlePendingAction(')
  const script = source.slice(start, source.indexOf('\nfunction handleDetailUpdated', start))
  const opened: string[] = []
  const messages: string[] = []
  const shipments: string[] = []
  const handle = runInNewContext(ts.transpileModule(`${script}; handlePendingAction`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    canShowPendingAction: () => true,
    paymentActionRef: { value: { open: (id: string) => opened.push(id) } },
    openPurchaseFactoryShipment: (order: { id: string }) => shipments.push(order.id),
    toast: { info: (message: string) => messages.push(message) },
  }) as (action: { key: string, label: string }, order: { id: string, orderStatus: string }) => void
  handle({ key: 'PAYMENT', label: '付款' }, { id: 'order-1', orderStatus: 'CONFIRMED' })
  assert.deepEqual(opened, ['order-1'])
  assert.deepEqual(messages, [])
  handle({ key: 'PAYMENT', label: '付款' }, { id: 'pending', orderStatus: 'PENDING_REVIEW' })
  assert.deepEqual(opened, ['order-1'])
  handle({ key: 'SHIPMENT', label: '发货' }, { id: 'order-2', orderStatus: 'CONFIRMED' })
  assert.deepEqual(shipments, ['order-2'])
})

test('付款完成沿现有详情更新事件刷新列表与待办数量', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')
  assert.match(source, /<PurchaseOrderListPaymentAction[\s\S]*?@detail-updated="handleDetailUpdated"[\s\S]*?@stale="refreshOrdersAndCounts"/u)
  const updateStart = source.indexOf('function handleDetailUpdated(')
  const refreshStart = source.indexOf('function refreshOrdersAndCounts(')
  const script = [
    source.slice(updateStart, source.indexOf('\nfunction openRecordsModal', updateStart)),
    source.slice(refreshStart, source.indexOf('\nfunction retryOrders', refreshStart)),
  ].join('\n')
  const calls: string[] = []
  const onUpdated = runInNewContext(ts.transpileModule(`${script}; handleDetailUpdated`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    loadOrders: () => calls.push('orders'),
    loadStatusCounts: () => calls.push('counts'),
  }) as () => void
  onUpdated()
  assert.deepEqual(calls, ['orders', 'counts'])
})
