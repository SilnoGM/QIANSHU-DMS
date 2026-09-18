import type { PurchaseShipmentListQuery } from '../../src/api/modules/purchase-shipments'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行页面脚本和实际数据composable，验证操作副作用及读取生命周期。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { compile, computed, createRenderer, defineComponent, effectScope, h, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import * as arrivalLogic from '../../src/views/operations/warehouse-arrivals/logic'
import { useWarehouseArrivalData } from '../../src/views/operations/warehouse-arrivals/use-warehouse-arrival-data'

async function fixture(initialQuery: Record<string, string> = {}) {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const initialPath = '/qs-operations/warehouse-transport/warehouse-arrivals'
  const route = reactive({ name: 'qsOperationsWarehouseArrivals', fullPath: initialPath, query: { ...initialQuery } })
  const account = reactive({ authEpoch: 1 })
  const permission = ref(true)
  const navigations: Array<Record<string, string>> = []
  const calls: Array<{ kind: string, query?: unknown, signal?: AbortSignal }> = []
  const info: string[] = []
  const lifecycle: Record<string, () => void> = {}
  const api = {
    list: async (query: PurchaseShipmentListQuery, signal: AbortSignal): Promise<any> => {
      calls.push({ kind: 'list', query, signal })
      return { data: { items: [{ id: 'part-1', viewStatus: 'WAREHOUSE_RECEIVED' }], total: 1 } }
    },
    statusCounts: async (query: PurchaseShipmentListQuery, signal: AbortSignal): Promise<any> => {
      calls.push({ kind: 'counts', query, signal })
      const totals: Record<string, [number, number]> = { 'WH-01': [2, 3], 'WH-02': [3, 4], 'QITA': [0, 0] }
      const [shipped, received] = query.destinationWarehouseValue ? totals[query.destinationWarehouseValue]! : [5, 7]
      return { data: { items: [{ value: 'SHIPPED', count: shipped }, { value: 'WAREHOUSE_RECEIVED', count: received }], buyerOptions: [] } }
    },
    getById: async (id: string, signal: AbortSignal): Promise<any> => {
      calls.push({ kind: `detail:${id}`, signal })
      return { data: { id } }
    },
  }
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, activeView, activeWarehouse, query, rows, tabs, warehouseTabs, keyword, page, pageSize, packagingShipment, selectView, selectWarehouse, search, paginate, handleAction, refresh, viewOrderFromShipment, shipmentClosed })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    ...arrivalLogic,
    computed,
    ref,
    shallowRef,
    watch,
    useI18n: () => ({ t: (key: string) => key }),
    useRoute: () => route,
    useRouter: () => ({ resolve: () => ({ fullPath: '/next' }), push: (location: { query: Record<string, string> }) => navigations.push(location.query), replace: (location: { query: Record<string, string> }) => navigations.push(location.query) }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ info: (message: string) => info.push(message), success: () => assert.fail('placeholder must not report success') }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useDictionaryCatalog: () => ({ catalog: ref({ items: [
      { value: 'WH-01', label: '长沙仓', effectiveEnabled: true },
      { value: 'WH-02', label: '深圳仓', effectiveEnabled: true },
      { value: 'QITA', label: '其他', effectiveEnabled: true },
    ] }), error: ref(null), missing: ref(false) }),
    useWarehouseArrivalData: (...args: Parameters<typeof useWarehouseArrivalData>) => useWarehouseArrivalData(args[0], args[1], args[2], args[3], args[4], api, api),
    defineOptions: () => {},
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
  })) as {
    enabled: { value: boolean }
    rows: { value: unknown[] }
    tabs: { value: { value: string, count?: number }[] }
    warehouseTabs: { value: { value: string, label: string, count?: number }[] }
    activeView: { value: string }
    activeWarehouse: { value: string }
    query: { value: PurchaseShipmentListQuery }
    keyword: { value: string }
    page: { value: number }
    pageSize: { value: number }
    packagingShipment: { value: { id: string } | null }
    selectView: (value: string) => void
    selectWarehouse: (value: string) => void
    search: () => void
    paginate: (value: { page: number, pageSize: number }) => void
    handleAction: (action: string, row: { id: string, viewStatus: string }) => void
    refresh: () => void
    viewOrderFromShipment: (id: string) => void
    shipmentClosed: () => void
  }
  lifecycle.mount!()
  await nextTick()
  await new Promise<void>(resolve => setImmediate(resolve))
  return { state, route, account, api, calls, permission, info, navigations, lifecycle, initialPath, dispose: () => scope.stop() }
}

test('页面默认已到仓；切换视图归一第一页，并保留关键词及目的地仓库', async (context) => {
  const f = await fixture({ page: '3', pageSize: '50', keyword: 'SF123', destinationWarehouseValue: 'WH-01' })
  context.after(f.dispose)
  assert.equal(f.state.activeView.value, 'WAREHOUSE_RECEIVED')
  assert.equal(JSON.stringify(f.state.tabs.value.map(tab => tab.value)), JSON.stringify(['SHIPPED', 'WAREHOUSE_RECEIVED']))
  assert.equal((f.calls.find(call => call.kind === 'list')!.query as PurchaseShipmentListQuery).sort, 'WAREHOUSE_RECEIVED_DESC')
  assert.equal((f.calls.find(call => call.kind === 'counts')!.query as PurchaseShipmentListQuery).sort, undefined)
  f.state.selectView('SHIPPED')
  assert.equal(JSON.stringify(f.navigations.at(-1)), JSON.stringify({ view: 'SHIPPED', page: '1', pageSize: '50', keyword: 'SF123', destinationWarehouseValue: 'WH-01' }))
  f.state.selectWarehouse('warehouse:QITA')
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, 'QITA')
  assert.equal(f.navigations.at(-1)?.destinationWarehouseMissing, undefined)
  f.state.selectWarehouse('__all__')
  assert.equal(f.navigations.at(-1)?.destinationWarehouseMissing, undefined)
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, undefined)
})

test('上方显示全部仓库的状态数量，下方显示当前状态各仓库数量，切换仓库不改变上方数量', async (context) => {
  for (const view of ['SHIPPED', 'WAREHOUSE_RECEIVED']) {
    for (const destinationWarehouseValue of [undefined, 'WH-01', 'WH-02', 'QITA']) {
      const f = await fixture({ view, ...(destinationWarehouseValue ? { destinationWarehouseValue } : {}) })
      context.after(f.dispose)
      assert.deepEqual(Array.from(f.state.tabs.value, item => item.count), [5, 7])
      assert.deepEqual(Array.from(f.state.warehouseTabs.value, item => item.count), view === 'SHIPPED' ? [5, 2, 3, 0] : [7, 3, 4, 0])
      assert.equal((f.calls.find(call => call.kind === 'list')!.query as PurchaseShipmentListQuery).destinationWarehouseValue, destinationWarehouseValue)
    }
  }
})

test('仓库计数失败不显示假零，全局数量和其他仓库数量保持可用', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const statusCounts = f.api.statusCounts
  f.api.statusCounts = async (query, signal) => {
    if (query.destinationWarehouseValue === 'WH-02') {
      throw new Error('warehouse counts unavailable')
    }
    return statusCounts(query, signal)
  }
  f.state.refresh()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(f.state.tabs.value, item => item.count), [5, 7])
  assert.deepEqual(Array.from(f.state.warehouseTabs.value, item => item.count), [7, 3, undefined, 0])
})

test('第二层仓库切换即时更新筛选，保留到仓视图和搜索并重置页码；无权限或停用页面不跳转', async (context) => {
  for (const view of ['SHIPPED', 'WAREHOUSE_RECEIVED']) {
    const f = await fixture({ view, page: '3', pageSize: '50', keyword: 'SF123', destinationWarehouseMissing: 'true' })
    context.after(f.dispose)
    assert.equal(f.state.activeWarehouse.value, '__all__')
    assert.deepEqual(Array.from(f.state.warehouseTabs.value, item => item.value), ['__all__', 'warehouse:WH-01', 'warehouse:WH-02', 'warehouse:QITA'])
    f.state.selectWarehouse('warehouse:WH-02')
    assert.equal(JSON.stringify(f.navigations.at(-1)), JSON.stringify({ view, page: '1', pageSize: '50', keyword: 'SF123', destinationWarehouseValue: 'WH-02' }))
    f.state.selectWarehouse('warehouse:INVALID')
    f.state.selectWarehouse('__missing__')
    assert.equal(f.navigations.length, 1)
    f.permission.value = false
    f.state.selectWarehouse('__all__')
    assert.equal(f.navigations.length, 1)
    f.permission.value = true
    f.lifecycle.deactivate!()
    f.state.selectWarehouse('__all__')
    assert.equal(f.navigations.length, 1)
  }
})

test('搜索和分页保留仓库筛选，URL 恢复当前仓库，全部仓库不附带仓库条件', async (context) => {
  const f = await fixture({ destinationWarehouseValue: 'WH-02' })
  context.after(f.dispose)
  assert.equal(f.state.activeWarehouse.value, 'warehouse:WH-02')
  f.state.keyword.value = '  PKG  '
  f.state.search()
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, 'WH-02')
  assert.equal(f.navigations.at(-1)?.keyword, 'PKG')
  f.state.paginate({ page: 2, pageSize: 50 })
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, 'WH-02')
  assert.equal(f.navigations.at(-1)?.page, '2')
  const all = await fixture()
  context.after(all.dispose)
  assert.equal(all.state.activeWarehouse.value, '__all__')
  assert.equal(all.state.query.value.destinationWarehouseValue, undefined)
  assert.equal(all.state.query.value.destinationWarehouseMissing, undefined)
})

test('已到仓打木架打开对应货件费用弹窗且不修改列表；待到仓不允许该操作', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const requestCount = f.calls.length
  const before = JSON.stringify(f.state.rows.value)
  f.state.handleAction('woodenFrame', { id: 'part-1', viewStatus: 'WAREHOUSE_RECEIVED' })
  assert.equal(f.state.packagingShipment.value?.id, 'part-1')
  assert.deepEqual(f.info, [])
  assert.equal(f.calls.length, requestCount)
  assert.equal(JSON.stringify(f.state.rows.value), before)
  f.state.handleAction('view', { id: 'part-1', viewStatus: 'WAREHOUSE_RECEIVED' })
  await nextTick()
  assert.equal(f.calls.at(-1)?.kind, 'detail:part-1')
  const pending = await fixture({ view: 'SHIPPED' })
  context.after(pending.dispose)
  pending.state.handleAction('woodenFrame', { id: 'part-1', viewStatus: 'WAREHOUSE_RECEIVED' })
  assert.equal(pending.state.packagingShipment.value, null)
  assert.deepEqual(pending.info, [])
})

test('缓存返回按URL重建筛选草稿，撤权及身份变化取消读取并屏蔽迟到数据', async (context) => {
  const f = await fixture({ keyword: 'original', destinationWarehouseValue: 'QITA' })
  context.after(f.dispose)
  f.state.keyword.value = 'draft'
  f.state.page.value = 3
  f.lifecycle.deactivate!()
  assert.equal(f.state.enabled.value, false)
  f.lifecycle.activate!()
  await nextTick()
  assert.equal(f.state.keyword.value, 'original')
  assert.equal(f.state.activeWarehouse.value, 'warehouse:QITA')
  assert.equal(f.state.page.value, 1)
  let finish!: (value: unknown) => void
  let signal!: AbortSignal
  f.api.list = (_query, nextSignal) => {
    signal = nextSignal
    return new Promise(resolve => finish = resolve)
  }
  f.state.refresh()
  const oldSignal = signal
  const finishOld = finish
  f.account.authEpoch += 1
  assert.equal(oldSignal.aborted, true)
  finishOld({ data: { items: [{ id: 'stale' }], total: 1 } })
  await nextTick()
  assert.equal(f.state.rows.value.length, 0)
  const currentSignal = signal
  f.permission.value = false
  assert.equal(currentSignal.aborted, true)
  assert.equal(f.state.enabled.value, false)
  f.state.handleAction('woodenFrame', { id: 'part-1', viewStatus: 'WAREHOUSE_RECEIVED' })
  assert.deepEqual(f.info, [])
  assert.equal(f.state.packagingShipment.value, null)
})

test('计数与仓库错误的重试按钮通过真实 FaAlert description 插槽显示并可点击', async () => {
  const page = await readFile(new URL('../../src/views/operations/warehouse-arrivals/index.vue', import.meta.url), 'utf8')
  const alertSource = await readFile(new URL('../../../../packages/components/src/basic/alert/index.vue', import.meta.url), 'utf8')
  const alertTemplate = alertSource.split('<template>')[1]!.split('</template>')[0]!
  const alerts = [...page.matchAll(/<FaAlert v-if="(?:countsError \|\| warehouseCountsError|warehouseCatalog.error.value)"[\s\S]*?<\/FaAlert>/gu)].map(match => match[0]).join('')
  const passthrough = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  const FaAlert = defineComponent({
    props: ['icon', 'title', 'description', 'variant', 'class'],
    components: { Alert: passthrough, AlertTitle: passthrough, AlertDescription: passthrough, Icon: passthrough },
    setup: props => ({ props }),
    render: compile(alertTemplate),
  })
  const calls: string[] = []
  const countsError = ref(true)
  const warehouseCountsError = ref(false)
  const Root = defineComponent({
    components: { FaAlert, FaButton: defineComponent({ setup: (_, { attrs, slots }) => () => h('button', attrs, slots.default?.()) }) },
    setup: () => ({ countsError, warehouseCountsError, warehouseCatalog: { error: { value: 'offline' }, retry: () => calls.push('warehouse') }, loadCounts: () => calls.push('counts'), t: (key: string) => key }),
    render: compile(`<div>${alerts}</div>`),
  })
  interface HostNode { tag: string, parent: HostNode | null, children: HostNode[], props: Record<string, unknown>, text: string }
  const node = (tag = '', text = ''): HostNode => ({ tag, text, parent: null, children: [], props: {} })
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag),
    createText: text => node('', text),
    createComment: text => node('', text),
    insert: (child, parent) => {
      child.parent = parent
      parent.children.push(child)
    },
    remove: () => {},
    parentNode: child => child.parent,
    nextSibling: () => null,
    patchProp: (target, key, _previous, value) => { target.props[key] = value },
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => { target.text = text },
  })
  const root = node('root')
  const app = renderer.createApp(Root)
  app.mount(root)
  const flatten = (current: HostNode): HostNode[] => [current, ...current.children.flatMap(flatten)]
  const nodes = flatten(root)
  const buttons = nodes.filter(item => item.tag === 'button')
  try {
    assert.equal(buttons.length, 2)
    assert.match(nodes.map(item => item.text).join(' '), /warehouseArrivals.countsErrorDescription/u)
    assert.match(nodes.map(item => item.text).join(' '), /warehouseArrivals.warehouseErrorDescription/u)
    for (const button of buttons) {
      (button.props.onClick as () => void)()
    }
    assert.deepEqual(calls, ['counts', 'warehouse'])
    countsError.value = false
    warehouseCountsError.value = true
    await nextTick()
    assert.match(flatten(root).map(item => item.text).join(' '), /warehouseArrivals.warehouseCountsErrorDescription/u)
  }
  finally {
    app.unmount()
  }
})
