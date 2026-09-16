import type { PurchaseShipmentListQuery } from '../../src/api/modules/purchase-shipments'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行页面脚本和实际数据composable，验证操作副作用及读取生命周期。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { compile, computed, createRenderer, defineComponent, effectScope, h, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import * as arrivalLogic from '../../src/views/operations/warehouse-arrivals/logic'
import { useShipmentData } from '../../src/views/workbenches/shipments/use-shipment-data'

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
    statusCounts: async (query: unknown, signal: AbortSignal): Promise<any> => {
      calls.push({ kind: 'counts', query, signal })
      return { data: { items: [{ value: 'SHIPPED', count: 2 }, { value: 'WAREHOUSE_RECEIVED', count: 1 }], buyerOptions: [] } }
    },
    getById: async (id: string, signal: AbortSignal): Promise<any> => {
      calls.push({ kind: `detail:${id}`, signal })
      return { data: { id } }
    },
  }
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ enabled, activeView, query, rows, tabs, keyword, filters, page, pageSize, packagingShipment, selectView, search, paginate, handleAction, refresh, viewOrderFromShipment, shipmentClosed })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
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
    useDictionaryCatalog: () => ({ catalog: ref({ items: [] }), error: ref(null), missing: ref(false) }),
    useShipmentData: (...args: Parameters<typeof useShipmentData>) => useShipmentData(args[0], args[1], args[2], args[3], api, api),
    defineOptions: () => {},
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
  })) as {
    enabled: { value: boolean }
    rows: { value: unknown[] }
    tabs: { value: { value: string }[] }
    activeView: { value: string }
    query: { value: PurchaseShipmentListQuery }
    keyword: { value: string }
    filters: { value: Record<string, string | undefined> }
    page: { value: number }
    pageSize: { value: number }
    packagingShipment: { value: { id: string } | null }
    selectView: (value: string) => void
    search: () => void
    paginate: (value: { page: number, pageSize: number }) => void
    handleAction: (action: string, row: { id: string, viewStatus: string }) => void
    refresh: () => void
    viewOrderFromShipment: (id: string) => void
    shipmentClosed: () => void
  }
  lifecycle.mount!()
  await nextTick()
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
  f.state.filters.value = { warehouse: '__missing__' }
  f.state.search()
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, undefined)
  assert.equal(f.navigations.at(-1)?.destinationWarehouseMissing, 'true')
  f.state.filters.value = { warehouse: undefined }
  f.state.search()
  assert.equal(f.navigations.at(-1)?.destinationWarehouseMissing, undefined)
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
  const f = await fixture({ keyword: 'original', destinationWarehouseMissing: 'true' })
  context.after(f.dispose)
  f.state.keyword.value = 'draft'
  f.state.filters.value = { warehouse: 'warehouse:WH-01' }
  f.state.page.value = 3
  f.lifecycle.deactivate!()
  assert.equal(f.state.enabled.value, false)
  f.lifecycle.activate!()
  await nextTick()
  assert.equal(f.state.keyword.value, 'original')
  assert.equal(f.state.filters.value.warehouse, '__missing__')
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
  const alerts = [...page.matchAll(/<FaAlert v-if="(?:countsError|warehouseCatalog.error.value)"[\s\S]*?<\/FaAlert>/gu)].map(match => match[0]).join('')
  const passthrough = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  const FaAlert = defineComponent({
    props: ['icon', 'title', 'description', 'variant', 'class'],
    components: { Alert: passthrough, AlertTitle: passthrough, AlertDescription: passthrough, Icon: passthrough },
    setup: props => ({ props }),
    render: compile(alertTemplate),
  })
  const calls: string[] = []
  const Root = defineComponent({
    components: { FaAlert, FaButton: defineComponent({ setup: (_, { attrs, slots }) => () => h('button', attrs, slots.default?.()) }) },
    setup: () => ({ countsError: true, warehouseCatalog: { error: { value: 'offline' }, retry: () => calls.push('warehouse') }, loadCounts: () => calls.push('counts'), t: (key: string) => key }),
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
  }
  finally {
    app.unmount()
  }
})
