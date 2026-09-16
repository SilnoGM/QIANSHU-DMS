import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行财务页面脚本，核实分页状态、操作权限和缓存页面隔离。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

async function fixture() {
  const source = await readFile(new URL('../../src/views/workbenches/packaging-payments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const account = reactive({ authEpoch: 1 })
  const route = reactive({ name: 'qsFinanceRealtimePackagingPayments' })
  const read = ref(true)
  const pay = ref(false)
  const calls: Array<{ query: Record<string, unknown>, signal: AbortSignal }> = []
  const lifecycle: Record<string, () => void> = {}
  const api = { list: async (query: Record<string, unknown>, signal: AbortSignal): Promise<any> => {
    calls.push({ query, signal })
    return { data: { items: [{ id: 'request', status: query.status }], total: 1, statusCounts: { PENDING_PAYMENT: 1, PAID: 0 } } }
  } }
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, status, page, keyword, items, selectedId, selectStatus, search, openPayment, load })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    AbortController,
    computed,
    ref,
    shallowRef,
    watch,
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: (permission: string) => permission === 'packaging-costs:read' ? read.value : pay.value }),
    useAppAccountStore: () => account,
    useRoute: () => route,
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    packagingCostsApi: api,
    getPurchaseOrderApiFailure: (error: Error) => error,
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
    selectedId: { value: string | null }
    selectStatus: (value: string) => void
    search: () => void
    openPayment: (record: { id: string, status: string }) => void
    load: () => Promise<void>
  }
  lifecycle.mount!()
  await nextTick()
  return { state, account, route, read, pay, calls, lifecycle, api, dispose: () => {
    lifecycle.unmount!()
    scope.stop()
  } }
}

test('默认待付款，已付款视图和搜索均回到第一页；只读权限不开放付款', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.calls[0]?.query.status, 'PENDING_PAYMENT')
  f.state.page.value = 3
  f.state.keyword.value = '  PKG  '
  f.state.selectStatus('PAID')
  assert.equal(f.calls.at(-1)?.query.status, 'PAID')
  assert.equal(f.calls.at(-1)?.query.page, 1)
  assert.equal(f.calls.at(-1)?.query.keyword, 'PKG')
  f.state.openPayment({ id: 'request', status: 'PENDING_PAYMENT' })
  assert.equal(f.state.selectedId.value, null)
  f.pay.value = true
  f.state.openPayment({ id: 'request', status: 'PAID' })
  assert.equal(f.state.selectedId.value, null)
  f.state.openPayment({ id: 'request', status: 'PENDING_PAYMENT' })
  assert.equal(f.state.selectedId.value, 'request')
  f.pay.value = false
  assert.equal(f.state.selectedId.value, null)
})

test('切页、撤权、换账号后清空数据并拒绝迟到列表响应', async (context) => {
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
    finishOld({ data: { items: [{ id: 'stale' }], total: 1, statusCounts: { PENDING_PAYMENT: 1, PAID: 0 } } })
    await pending
    assert.equal(f.state.items.value.length, 0)
  }
})
