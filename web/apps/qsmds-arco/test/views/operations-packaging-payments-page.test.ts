import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行运营木架付款页面脚本，核实本人筛选、改金额入口与复制边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const pendingRecord = {
  id: 'pending-request',
  version: 2,
  shipmentNo: 'PKG/20260918-00001',
  shippingMarkText: '【唛头】木桌×2',
  purchaseOrderNo: 'PO/20260918-00001',
  salesOrderNo: 'SO/20260918-00001',
  packagingTypeName: '木箱',
  packagingVendor: 'CHENGXIN',
  amount: '120.50',
  currencyCode: 'CNY',
  status: 'PENDING_PAYMENT',
  remark: null,
  submittedBy: { id: 'user', name: '提报人', avatarUrl: null },
  submittedAt: '2026-09-18T00:00:00.000Z',
  paidBy: null,
  paidAt: null,
}

async function fixture() {
  const source = await readFile(new URL('../../src/views/operations/packaging-payments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const account = reactive({ authEpoch: 1 })
  const route = reactive({ name: 'qsOperationsWarehousePackagingPayments', fullPath: '/qs-operations/warehouse-transport/packaging-payments' })
  const read = ref(true)
  const create = ref(true)
  const calls: Array<{ query: Record<string, unknown>, signal: AbortSignal }> = []
  const lifecycle: Record<string, () => void> = {}
  const toasts: Array<{ kind: string, message: string }> = []
  const clipboard = { items: [] as string[], fail: false }
  const api = {
    list: async (query: Record<string, unknown>, signal: AbortSignal): Promise<any> => {
      calls.push({ query, signal })
      return {
        data: {
          items: [{ ...pendingRecord, status: query.status ?? 'PENDING_PAYMENT' }],
          total: 1,
          page: 1,
          pageSize: 20,
          statusCounts: { PENDING_PAYMENT: 2, PAID: 3, CANCELLED: 1 },
        },
      }
    },
  }
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, status, page, keyword, items, total, counts, tabs, columns, actionColumnWidth, canChangeAmount, amountTarget, selectStatus, search, load, openAmount, closeAmount, copyRequest })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    watch,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: (permission: string) => permission === 'packaging-costs:read' ? read.value : create.value }),
    useAppAccountStore: () => account,
    useRoute: () => route,
    useRouter: () => ({ resolve: () => ({ href: '/qs-finance/realtime-payments/packaging-payments/pending-request/payment' }) }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useQsToast: () => ({
      success: (message: string) => toasts.push({ kind: 'success', message }),
      warning: (message: string) => toasts.push({ kind: 'warning', message }),
    }),
    buildPackagingPaymentRequestText: (record: { shippingMarkText: string, amount: string }) => `申请 ${record.shippingMarkText} ${record.amount}`,
    resolveActionColumnWidth: () => 176,
    packagingCostsApi: api,
    getPurchaseOrderApiFailure: (error: Error) => error,
    navigator: { clipboard: { writeText: async (text: string) => {
      if (clipboard.fail) {
        throw new Error('denied')
      }
      clipboard.items.push(text)
    } } },
    window: { location: { href: 'http://localhost/qs-operations/warehouse-transport/packaging-payments' } },
    defineOptions: () => {},
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
  })) as {
    enabled: { value: boolean }
    status: { value: string }
    page: { value: number }
    keyword: { value: string }
    items: { value: unknown[] }
    total: { value: number }
    counts: { value: Record<string, number> }
    tabs: { value: Array<{ value: string, count: number }> }
    columns: { value: Array<{ id: string }> }
    actionColumnWidth: { value: number }
    canChangeAmount: { value: boolean }
    amountTarget: { value: { id: string } | null }
    selectStatus: (value: string | number) => void
    search: () => void
    load: () => Promise<void>
    openAmount: (record: { id: string, status: string }) => void
    closeAmount: () => void
    copyRequest: (record: { id: string, shippingMarkText: string, amount: string }) => Promise<void>
  }
  lifecycle.mount!()
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  return { state, account, route, read, create, calls, lifecycle, toasts, clipboard, api, dispose: () => {
    lifecycle.unmount!()
    scope.stop()
  } }
}

test('默认「全部」不带状态参数，切页签回到第一页并 trim 关键词', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.status.value, 'ALL')
  assert.equal('status' in f.calls[0]!.query, false)
  assert.equal(f.calls[0]?.query.page, 1)
  assert.equal(f.calls[0]?.query.pageSize, 20)
  f.state.page.value = 3
  f.state.keyword.value = '  PKG  '
  f.state.selectStatus('PENDING_PAYMENT')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.at(-1)?.query.status, 'PENDING_PAYMENT')
  assert.equal(f.calls.at(-1)?.query.page, 1)
  assert.equal(f.calls.at(-1)?.query.keyword, 'PKG')
  assert.equal(f.state.counts.value.ALL, 6)
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.tabs.value.map(item => [item.value, item.count]))), [
    ['ALL', 6],
    ['PENDING_PAYMENT', 2],
    ['PAID', 3],
    ['CANCELLED', 1],
  ])
  // 非法页签值不改筛选，避免 URL 或外部调用扩大查询。
  f.state.selectStatus('OTHER')
  assert.equal(f.state.status.value, 'PENDING_PAYMENT')
})

test('本人视图保留状态列；无提报权限时不提供改金额，已付款记录不可改', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.ok(f.state.columns.value.some(column => column.id === 'status'))
  assert.equal(f.state.canChangeAmount.value, true)
  f.state.openAmount({ id: 'pending-request', status: 'PENDING_PAYMENT' })
  assert.equal(f.state.amountTarget.value?.id, 'pending-request')
  f.state.closeAmount()
  assert.equal(f.state.amountTarget.value, null)
  f.state.openAmount({ id: 'paid-request', status: 'PAID' })
  assert.equal(f.state.amountTarget.value, null)
  f.create.value = false
  assert.equal(f.state.canChangeAmount.value, false)
  f.state.openAmount({ id: 'pending-request', status: 'PENDING_PAYMENT' })
  assert.equal(f.state.amountTarget.value, null)
  assert.equal(f.state.actionColumnWidth.value > 0, true)
})

test('复制付款申请写入剪贴板并提示；剪贴板失败只提示重试', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  await f.state.copyRequest({ id: 'pending-request', shippingMarkText: '【唛头】木桌×2', amount: '120.50' })
  assert.deepEqual(f.clipboard.items, ['申请 【唛头】木桌×2 120.50'])
  assert.equal(f.toasts.at(-1)?.kind, 'success')
  f.clipboard.fail = true
  await f.state.copyRequest({ id: 'pending-request', shippingMarkText: '【唛头】木桌×2', amount: '120.50' })
  assert.equal(f.toasts.at(-1)?.kind, 'warning')
  assert.equal(f.clipboard.items.length, 1)
})

test('撤权、切路由、换账号后清空数据并拒绝迟到列表响应', async (context) => {
  for (const change of ['route', 'read', 'epoch', 'deactivate']) {
    const f = await fixture()
    context.after(f.dispose)
    let finish!: (value: unknown) => void
    f.api.list = (query, signal) => {
      f.calls.push({ query, signal })
      return new Promise(resolve => finish = resolve)
    }
    const pending = f.state.load()
    const old = f.calls.at(-1)!
    const finishOld = finish
    if (change === 'route') {
      f.route.name = 'other'
    }
    if (change === 'read') {
      f.read.value = false
    }
    if (change === 'epoch') {
      f.account.authEpoch++
    }
    if (change === 'deactivate') {
      f.lifecycle.deactivate!()
    }
    assert.equal(old.signal.aborted, true)
    finishOld({ data: { items: [{ id: 'stale' }], total: 1, page: 1, pageSize: 20, statusCounts: { PENDING_PAYMENT: 0, PAID: 0, CANCELLED: 0 } } })
    await pending
    assert.equal(f.state.items.value.length, 0)
  }
})
