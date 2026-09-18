import type { PurchasePayableRow } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'
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
  const copied: string[] = []
  const navigation: unknown[] = []
  const payments: unknown[] = []
  const focusHandlers = new Map<string, () => void>()
  const calls: Array<{ query: unknown, signal: AbortSignal }> = []
  const callbacks: Record<string, () => void> = {}
  let execute = async () => ({ data: { items: [], total: 0 } })
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ load, openPayment, openBatchPayment, orders, groups, summaryValues, total, loading, error, page })`, {
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
    useRouter: () => ({
      push: (location: unknown) => navigation.push(location),
    }),
    navigator: { clipboard: { writeText: async (text: string) => {
      copied.push(text)
    } } },
    window: {
      addEventListener: (name: string, handler: () => void) => focusHandlers.set(name, handler),
      removeEventListener: (name: string) => focusHandlers.delete(name),
    },
    useAppAuth: () => ({ auth: () => permissions.pay }),
    useAppAccountStore: () => account,
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    onMounted: (fn: () => void) => callbacks.mount = fn,
    onActivated: (fn: () => void) => callbacks.activate = fn,
    onDeactivated: (fn: () => void) => callbacks.deactivate = fn,
    onBeforeUnmount: (fn: () => void) => callbacks.unmount = fn,
    purchaseOrderPayablesApi: {
      list: (query: unknown, signal: AbortSignal) => {
        calls.push({ query, signal })
        return execute()
      },
      pay: (...args: unknown[]) => payments.push(args),
    },
    createPurchasePayableGroups,
    canPayPurchasePayable,
    sumMoneyValues,
    getPurchaseOrderApiFailure: (failure: Error) => ({ message: failure.message }),
    AmountDisplay: {},
  })) as {
    load: () => Promise<void>
    openPayment: (row: PurchasePayableRow) => void
    openBatchPayment: () => void
    orders: { value: unknown[] }
    total: { value: number }
    error: { value: string }
    loading: { value: boolean }
    page: { value: number }
    summaryValues: { value: Record<string, string> }
  }
  return {
    state,
    calls,
    copied,
    navigation,
    payments,
    focusHandlers,
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

test('批量付款入口只在当前页面有权限且已加载时进入独立批量页面', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.state.openBatchPayment()
  assert.equal(f.navigation.length, 0)
  f.callbacks.mount!()
  await flush()
  f.state.openBatchPayment()
  assert.deepEqual(JSON.parse(JSON.stringify(f.navigation)), [{ name: 'qsFinanceRealtimePurchaseBatchPayment' }])
  f.state.loading.value = true
  f.state.openBatchPayment()
  f.state.loading.value = false
  f.permissions.pay = false
  f.state.openBatchPayment()
  assert.equal(f.navigation.length, 1)
})

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
    oldFinish({ data: { items: [], total: 99 } })
    await flush()
    assert.equal(f.state.total.value, 0)
    assert.equal(f.state.error.value, '')
  }
})

test('财务付款按钮直接导航到具体款项，不复制链接也不直接写入付款', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.callbacks.mount!()
  await flush()
  const row = { id: 'payable', order: { orderNo: 'PO/20260916-00016' }, payable: { id: '11111111-1111-4111-8111-111111111111', status: 'PENDING_PAYMENT', remainingAmount: '7.00' } } as PurchasePayableRow
  assert.equal(typeof f.state.openPayment, 'function')
  f.state.openPayment(row)
  assert.deepEqual(JSON.parse(JSON.stringify(f.navigation)), [{
    name: 'qsFinanceRealtimePurchasePayablePayment',
    params: { id: '11111111-1111-4111-8111-111111111111' },
  }])
  assert.deepEqual(f.copied, [])
  assert.deepEqual(f.payments, [])
})

test('财务付款入口在未激活、无权限、加载和不可支付状态下不导航', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const row = { id: 'payable', order: { orderNo: 'PO/20260916-00016' }, payable: { id: '11111111-1111-4111-8111-111111111111', status: 'PENDING_PAYMENT', remainingAmount: '7.00' } } as PurchasePayableRow
  assert.equal(typeof f.state.openPayment, 'function')
  f.state.openPayment(row)
  f.callbacks.mount!()
  await flush()
  f.state.loading.value = true
  f.state.openPayment(row)
  f.state.loading.value = false
  f.state.openPayment({ ...row, payable: null })
  for (const status of ['PAID', 'NO_PAYMENT', 'CANCELLED'] as const) {
    f.state.openPayment({ ...row, payable: { ...row.payable!, status } })
  }
  f.state.openPayment({ ...row, payable: { ...row.payable!, remainingAmount: '0.00' } })
  f.permissions.pay = false
  f.state.openPayment(row)
  f.permissions.pay = true
  await flush()
  f.route.name = 'qsFinanceRealtimePurchasePayablePayment'
  f.state.openPayment(row)
  assert.deepEqual(f.navigation, [])
  assert.deepEqual(f.copied, [])
  assert.deepEqual(f.payments, [])
})

test('从独立付款页返回窗口时刷新待办，最后一页清空后回到有效页码', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  f.callbacks.mount!()
  await flush()
  f.state.page.value = 2
  f.state.total.value = 21
  f.setExecute(async () => ({ data: { items: [], total: 20 } }))
  f.focusHandlers.get('focus')!()
  await flush()
  await flush()
  assert.equal(f.state.total.value, 20)
  assert.equal(f.state.orders.value.length, 0)
  assert.equal(f.state.page.value, 1)
  assert.equal((f.calls.at(-1)?.query as { page: number }).page, 1)
})
