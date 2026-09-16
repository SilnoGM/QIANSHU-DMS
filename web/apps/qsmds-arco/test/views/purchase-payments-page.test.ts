import type { PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行实际页面脚本，验证采购单分页、权限清理和迟到响应隔离。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import { sumMoneyValues } from '../../src/components/base/MoneyInput/logic'
import { canPayPurchasePayable, createPurchasePayableGroups } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

async function fixture() {
  const source = await readFile(new URL('../../src/views/workbenches/purchase-payments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const route = reactive({ name: 'qsFinanceRealtimePurchasePayments', query: { keyword: 'PO/target' } })
  const account = reactive({ authEpoch: 1 })
  const permissions = reactive({ pay: true })
  const calls: Array<{ query: unknown, signal: AbortSignal }> = []
  const callbacks: Record<string, () => void> = {}
  let execute = async () => ({ data: { items: [], total: 0 } })
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ load, openPayment, applyPayment, orders, groups, summaryValues, total, selection, loading, error, page })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    watch,
    defineOptions: () => {},
    useI18n: () => ({ t: (key: string) => key }),
    useRoute: () => route,
    useAppAuth: () => ({ auth: () => permissions.pay }),
    useAppAccountStore: () => account,
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    onMounted: (fn: () => void) => callbacks.mount = fn,
    onActivated: (fn: () => void) => callbacks.activate = fn,
    onDeactivated: (fn: () => void) => callbacks.deactivate = fn,
    onBeforeUnmount: (fn: () => void) => callbacks.unmount = fn,
    purchaseOrderPayablesApi: { list: (query: unknown, signal: AbortSignal) => {
      calls.push({ query, signal })
      return execute()
    } },
    createPurchasePayableGroups,
    canPayPurchasePayable,
    sumMoneyValues,
    getPurchaseOrderApiFailure: (failure: Error) => ({ message: failure.message }),
    AmountDisplay: {},
  })) as {
    load: () => Promise<void>
    applyPayment: (order: PurchasePayableOrderDto) => void
    orders: { value: unknown[] }
    total: { value: number }
    error: { value: string }
    loading: { value: boolean }
    page: { value: number }
    selection: { value: unknown }
    summaryValues: { value: Record<string, string> }
  }
  return {
    state,
    calls,
    route,
    account,
    permissions,
    callbacks,
    setExecute: (fn: typeof execute) => execute = fn,
    dispose: () => {
      callbacks.unmount?.()
      scope.stop()
    },
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('采购付款读取路由搜索词，API 分页按采购单且金额汇总只计算子行', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.callbacks.mount!()
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0]?.query)), { page: 1, pageSize: 20, keyword: 'PO/target' })
  f.state.orders.value = [{ id: 'order', purchaseTotalAmount: '100.00', items: [
    { dueAmount: '30.00', paidAmount: '30.00', remainingAmount: '0.00' },
    { dueAmount: '70.00', paidAmount: '0.00', remainingAmount: '70.00' },
  ] }]
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.summaryValues.value)), { dueAmount: '100.00', paidAmount: '30.00', remainingAmount: '70.00' })
  f.route.query.keyword = 'PO/second'
  await nextTick()
  await flush()
  assert.equal((f.calls.at(-1)?.query as { keyword: string }).keyword, 'PO/second')
})

test('关闭页面、切账号和撤销付款权限清空旧订单并忽略迟到列表', async (context) => {
  for (const reason of ['leave', 'account', 'permission']) {
    const f = await fixture()
    context.after(f.dispose)
    let finish!: (value: { data: { items: never[], total: number } }) => void
    f.setExecute(() => new Promise(resolve => finish = resolve))
    f.callbacks.mount!()
    f.state.selection.value = { id: 'old-selection' }
    const request = f.calls[0]!
    const oldFinish = finish
    if (reason === 'leave') {
      f.callbacks.deactivate!()
    }
    else if (reason === 'account') {
      f.account.authEpoch++
    }
    else {
      f.permissions.pay = false
    }
    assert.equal(request.signal.aborted, true)
    assert.equal(f.state.selection.value, null)
    oldFinish({ data: { items: [], total: 99 } })
    await flush()
    assert.equal(f.state.total.value, 0)
    assert.equal(f.state.error.value, '')
  }
})

test('部分付款保留整组，付清后立即移除且刷新失败也不恢复已处理订单', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.callbacks.mount!()
  await flush()
  f.setExecute(async () => {
    throw new Error('Refresh unavailable')
  })
  const partial = { id: 'order', items: [{ status: 'PAID' }, { status: 'PENDING_PAYMENT' }] } as PurchasePayableOrderDto
  f.state.orders.value = [partial, { id: 'other' }]
  f.state.total.value = 2
  f.state.applyPayment(partial)
  assert.equal(f.state.orders.value.length, 2)
  assert.equal(f.state.total.value, 2)
  await flush()
  for (const status of ['PAID', 'NO_PAYMENT'] as const) {
    f.state.orders.value = [partial, { id: 'other' }]
    f.state.total.value = 2
    f.state.applyPayment({ ...partial, items: partial.items.map(item => ({ ...item, status })) })
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.orders.value)), [{ id: 'other' }])
    assert.equal(f.state.total.value, 1)
    await flush()
    assert.equal(f.state.orders.value.length, 1)
  }
})

test('最后一页订单处理完后自动返回仍有数据的页码', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.callbacks.mount!()
  await flush()
  const paid = { id: 'last', items: [{ status: 'PAID' }, { status: 'PAID' }] } as PurchasePayableOrderDto
  f.state.page.value = 2
  f.state.total.value = 21
  f.state.orders.value = [paid]
  f.setExecute(async () => ({ data: { items: [], total: 20 } }))
  f.state.applyPayment(paid)
  assert.equal(f.state.total.value, 20)
  assert.equal(f.state.orders.value.length, 0)
  await flush()
  await flush()
  assert.equal(f.state.page.value, 1)
  assert.equal((f.calls.at(-1)?.query as { page: number }).page, 1)
})
