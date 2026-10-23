import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证货件查询状态与显示边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parseDate } from '@internationalized/date'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { buildWarehouseFilterOptions, warehouseFilterFromQuery, warehouseFilterToQuery } from '../../src/views/operations/warehouse-arrivals/logic'
import { buildShipmentRouteQuery, formatDestinationWarehouse, formatShipmentNumber, parseShipmentQuery, SHIPMENT_VIEWS, shipmentCountsQuery, shipmentRowAction, shipmentStatusClass } from '../../src/views/workbenches/shipments/logic'

test('货件默认待发货；非法 URL 参数不进入查询', () => {
  assert.deepEqual(parseShipmentQuery({}), { view: 'AWAITING_SHIPMENT', page: 1, pageSize: 20 })
  assert.deepEqual(parseShipmentQuery({ view: ['ALL'], page: '-2', pageSize: '999', orderDateFrom: '2026-02-30', createdByUserId: 'bad', purchaseType: 'other' }), { view: 'AWAITING_SHIPMENT', page: 1, pageSize: 20 })
})

test('Tab 切换保留公共筛选并归一到第一页，数量查询排除视图和分页', () => {
  const query = parseShipmentQuery({ view: 'ALL', page: '3', pageSize: '50', keyword: '  唛头  ', supplierValue: 'supplier-1', purchaseType: 'STOCK', orderDateFrom: '2026-09-01', orderDateTo: '2026-09-14' })
  const route = buildShipmentRouteQuery({ ...query, view: 'SHIPPED', page: 1 })
  assert.deepEqual(parseShipmentQuery(route), { ...query, view: 'SHIPPED', page: 1 })
  assert.deepEqual(shipmentCountsQuery(query), { keyword: '唛头', supplierValue: 'supplier-1', purchaseType: 'STOCK', orderDateFrom: '2026-09-01', orderDateTo: '2026-09-14' })
})

test('仓库筛选仅在已到仓视图生效，URL 可恢复且非法仓库参数被忽略', () => {
  const query = parseShipmentQuery({ view: 'WAREHOUSE_RECEIVED', destinationWarehouseValue: 'QITA', keyword: '货件', page: '3' })
  assert.equal(query.destinationWarehouseValue, 'QITA')
  assert.deepEqual(parseShipmentQuery(buildShipmentRouteQuery(query)), query)
  for (const view of SHIPMENT_VIEWS.filter(value => value !== 'WAREHOUSE_RECEIVED')) {
    assert.equal(parseShipmentQuery({ view, destinationWarehouseValue: 'QITA' }).destinationWarehouseValue, undefined)
  }
  for (const value of ['', '  ', ['QITA'], true]) {
    assert.equal(parseShipmentQuery({ view: 'WAREHOUSE_RECEIVED', destinationWarehouseValue: value }).destinationWarehouseValue, undefined)
  }
})

test('货件序号不截断，状态绿色采用主题 primary', () => {
  assert.equal(formatShipmentNumber(1), '货件-01')
  assert.equal(formatShipmentNumber(123), '货件-123')
  assert.match(shipmentStatusClass('WAREHOUSE_RECEIVED'), /text-primary/u)
  assert.match(shipmentStatusClass('CANCELLED'), /text-destructive/u)
  assert.notEqual(shipmentStatusClass('AWAITING_SHIPMENT'), shipmentStatusClass('PENDING_REVIEW'))
  assert.notEqual(shipmentStatusClass('AWAITING_SHIPMENT'), shipmentStatusClass('SHIPPED'))
  assert.equal(parseShipmentQuery({ view: 'WAREHOUSE_RECEIVED' }).view, 'WAREHOUSE_RECEIVED')
})

test('运输视图可从 URL 恢复，保留筛选并具有状态颜色', () => {
  for (const view of ['CONTAINER_LOADED', 'OVERSEAS_STORAGE', 'DELIVERED'] as const) {
    const query = parseShipmentQuery({ view, keyword: '货件', page: '2' })
    assert.equal(query.view, view)
    assert.equal(buildShipmentRouteQuery(query).view, view)
    assert.deepEqual(shipmentCountsQuery(query), { keyword: '货件' })
    assert.ok(shipmentStatusClass(view))
  }
  assert.deepEqual(SHIPMENT_VIEWS.slice(-4), ['CONTAINER_LOADED', 'DELIVERED', 'OVERSEAS_STORAGE', 'CANCELLED'])
})

test('装柜只出现在已到仓视图，签收只出现在已装柜视图；寄仓及终态不增加操作', () => {
  assert.equal(shipmentRowAction('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED'), 'loadContainer')
  assert.equal(shipmentRowAction('CONTAINER_LOADED', 'CONTAINER_LOADED'), 'sign')
  for (const view of SHIPMENT_VIEWS) {
    if (view === 'WAREHOUSE_RECEIVED' || view === 'CONTAINER_LOADED') {
      continue
    }
    assert.equal(shipmentRowAction(view, 'WAREHOUSE_RECEIVED'), null)
    assert.equal(shipmentRowAction(view, 'CONTAINER_LOADED'), null)
  }
  assert.equal(shipmentRowAction('WAREHOUSE_RECEIVED', 'SHIPPED'), null)
  assert.equal(shipmentRowAction('CONTAINER_LOADED', 'DELIVERED'), null)
})

async function pageFixture() {
  const source = await readFile(new URL('../../src/views/workbenches/shipments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const initialQuery = { view: 'ALL', page: '1', pageSize: '20' }
  const route = reactive({ name: 'qsPurchaseTransportShipments', fullPath: '/qs-purchase-transport/shipments?view=ALL&page=1&pageSize=20', query: { ...initialQuery } })
  const initialPath = route.fullPath
  const account = reactive({ authEpoch: 1 })
  const permission = ref(true)
  const navigations: Array<Record<string, string>> = []
  const info: string[] = []
  const lifecycle: Record<string, () => void> = {}
  const stops: Array<() => void> = []
  const data = {
    rows: ref([]),
    total: ref(0),
    loading: ref(false),
    error: ref(''),
    counts: ref([{ value: 'WAREHOUSE_RECEIVED', count: 7 }, { value: 'SHIPPED', count: 3 }]),
    warehouseCounts: ref([{ value: 'north', items: [{ value: 'WAREHOUSE_RECEIVED', count: 2 }] }, { value: 'QITA', items: [{ value: 'WAREHOUSE_RECEIVED', count: 5 }] }]),
    warehouseCountsError: ref(false),
    countsError: ref(false),
    buyerOptions: ref([]),
    detail: ref(null),
    orderDetail: ref(null),
    detailKind: ref(null),
    detailLoading: ref(false),
    detailError: ref(null),
    refresh: () => {},
    loadCounts: () => {},
    loadDetail: () => {},
    openShipment: () => {},
    openOrder: () => {},
  }
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ keyword, filters, dateRange, page, pageSize, search, columns, handleTransportAction, selectTab, selectWarehouse, activeWarehouse, showWarehouseFilter, warehouseValues, warehouseTabs, tabs, deliverTarget, deliverVisible })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    computed,
    // 页面已不再导出 warehouseValues；保留原探针串以维持既有 VM 测试夹具。
    warehouseValues: undefined,
    reactive,
    ref,
    shallowRef,
    useTemplateRef: () => ref(null),
    parseDate,
    watch: (...args: Parameters<typeof watch>) => stops.push(watch(...args)),
    defineOptions: () => {},
    useRoute: () => route,
    useRouter: () => ({
      resolve: () => ({ fullPath: '/next' }),
      push: (location: { query: Record<string, string> }) => navigations.push(location.query),
      replace: (location: { query: Record<string, string> }) => navigations.push(location.query),
    }),
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => account,
    useQsToast: () => ({ info: (message: string) => info.push(message) }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useDictionaryCatalog: (code: string) => ({ catalog: ref({ items: code === 'mainland.warehouse'
      ? [
          { value: 'north', label: '北仓', effectiveEnabled: true },
          { value: 'QITA', label: '其他', effectiveEnabled: true },
        ]
      : [] }), error: ref(null) }),
    useWarehouseArrivalData: () => data,
    buildWarehouseFilterOptions,
    warehouseFilterFromQuery,
    warehouseFilterToQuery,
    buildShipmentRouteQuery,
    formatDestinationWarehouse,
    formatShipmentNumber,
    parseShipmentQuery,
    shipmentStatusClass,
    shipmentRowAction,
    SHIPMENT_VIEWS,
    getShipmentSourceEmptyKey: () => 'stock',
    onMounted: (callback: () => void) => lifecycle.mount = callback,
    onActivated: (callback: () => void) => lifecycle.activate = callback,
    onDeactivated: (callback: () => void) => lifecycle.deactivate = callback,
    onBeforeUnmount: (callback: () => void) => lifecycle.unmount = callback,
  }) as {
    keyword: { value: string }
    filters: { value: Record<string, unknown> }
    dateRange: { value: { start?: ReturnType<typeof parseDate>, end?: ReturnType<typeof parseDate> } }
    page: { value: number }
    pageSize: { value: number }
    search: () => void
    selectTab: (value: string) => void
    selectWarehouse: (value: string) => void
    activeWarehouse: { value: string }
    showWarehouseFilter: { value: boolean }
    warehouseTabs: { value: Array<{ value: string, count?: number }> }
    tabs: { value: Array<{ value: string, count?: number }> }
    handleTransportAction: (row: { viewStatus: string }, action?: string) => void
    columns: { value: Array<{ id: string, fixed?: string, accessorKey?: string }> }
    deliverTarget: { value: { viewStatus: string } | null }
    deliverVisible: { value: boolean }
  }
  lifecycle.mount!()
  return { state, data, route, initialPath, initialQuery, permission, navigations, info, lifecycle, dispose: () => stops.forEach(stop => stop()) }
}

test('装柜轻提示，签收打开确认弹窗；撤权或页面停用不响应', async (context) => {
  const f = await pageFixture()
  context.after(f.dispose)
  f.route.query.view = 'WAREHOUSE_RECEIVED'
  f.state.handleTransportAction({ viewStatus: 'WAREHOUSE_RECEIVED' })
  assert.equal(f.info.at(-1), 'purchaseShipments.loadContainerUnavailable')
  f.route.query.view = 'CONTAINER_LOADED'
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' })
  assert.equal(f.state.deliverTarget.value?.viewStatus, 'CONTAINER_LOADED')
  f.state.deliverVisible.value = false
  assert.equal(f.state.deliverTarget.value, null)
  f.state.handleTransportAction({ viewStatus: 'DELIVERED' })
  f.permission.value = false
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' })
  f.permission.value = true
  f.lifecycle.deactivate!()
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' })
  assert.equal(f.info.length, 1)
  assert.equal(f.navigations.length, 0)
})

test('缓存页面后退及重新授权后按 URL 恢复筛选、日期和分页，不保留上次提交的本地状态', async (context) => {
  const fixture = await pageFixture()
  context.after(fixture.dispose)
  const { state, route, lifecycle } = fixture
  const editControls = () => {
    state.keyword.value = 'changed'
    state.filters.value = { supplierValue: 'SUPPLIER_A', purchaseType: 'STOCK' }
    state.dateRange.value = { start: parseDate('2026-09-01'), end: parseDate('2026-09-14') }
    state.page.value = 3
    state.pageSize.value = 50
  }
  editControls()
  lifecycle.deactivate!()
  route.query = { view: 'ALL', page: '3', pageSize: '50' }
  route.fullPath = '/qs-purchase-transport/shipments?view=ALL&page=3&pageSize=50'
  route.query = { ...fixture.initialQuery }
  route.fullPath = fixture.initialPath
  lifecycle.activate!()
  assert.equal(state.page.value, 1)
  assert.equal(state.pageSize.value, 20)
  assert.equal(state.keyword.value, '')
  assert.equal(state.filters.value.supplierValue, undefined)
  assert.equal(state.filters.value.purchaseType, undefined)
  assert.equal(state.dateRange.value.start, undefined)
  assert.equal(state.dateRange.value.end, undefined)
  editControls()
  fixture.permission.value = false
  fixture.permission.value = true
  assert.equal(state.page.value, 1)
  assert.equal(state.keyword.value, '')
})

test('选择自定义供应商来源时清空具体供应商；冲突 URL 也不发送拒绝组合', async (context) => {
  const fixture = await pageFixture()
  context.after(fixture.dispose)
  fixture.state.filters.value = { supplierValue: 'SUPPLIER_A', supplierSource: 'CUSTOM_TEXT' }
  fixture.state.search()
  assert.equal(fixture.state.filters.value.supplierValue, undefined)
  assert.equal(fixture.navigations.at(-1)?.supplierSource, 'CUSTOM_TEXT')
  assert.equal(fixture.navigations.at(-1)?.supplierValue, undefined)
  assert.equal(parseShipmentQuery({ supplierSource: 'CUSTOM_TEXT', supplierValue: 'SUPPLIER_A' }).supplierValue, undefined)
  assert.equal(parseShipmentQuery({ supplierSource: 'DICTIONARY', supplierValue: 'SUPPLIER_A' }).supplierValue, 'SUPPLIER_A')
})

test('正式货件编号位于最左并固定，所属采购单和产品列保持独立', async (context) => {
  const fixture = await pageFixture()
  context.after(fixture.dispose)
  const columns = fixture.state.columns.value
  assert.equal(columns[0]?.id, 'shipmentNo')
  assert.equal(columns[0]?.accessorKey, 'shipmentNo')
  assert.equal(columns[0]?.fixed, 'left')
  assert.equal(columns[1]?.id, 'part')
  assert.equal(columns.some(column => column.id === 'products'), true)
  assert.equal(columns.some(column => column.id === 'delivered'), true)
  assert.equal(columns.some(column => column.id === 'quantity'), false)
})

test('目的地仓库列默认展示，历史空值、有效、停用与未知仓库保留可辨识回显', async (context) => {
  const fixture = await pageFixture()
  context.after(fixture.dispose)
  assert.equal(fixture.state.columns.value.some(column => column.id === 'destinationWarehouse'), true)
  const t = (key: string) => ({ 'purchaseShipments.warehouseMissing': '未记录', 'purchaseShipments.warehouseUnknown': '未知仓库', 'purchaseShipments.disabled': '已停用' })[key] ?? key
  assert.equal(formatDestinationWarehouse({ destinationWarehouseValue: null, destinationWarehouse: null }, t), '未记录')
  assert.equal(formatDestinationWarehouse({ destinationWarehouseValue: 'OLD-WH', destinationWarehouse: { value: 'OLD-WH', label: null, known: false, effectiveEnabled: false } }, t), 'OLD-WH（未知仓库）')
  assert.equal(formatDestinationWarehouse({ destinationWarehouseValue: 'WH-01', destinationWarehouse: { value: 'WH-01', label: '长沙仓', known: true, effectiveEnabled: true } }, t), '长沙仓')
  assert.equal(formatDestinationWarehouse({ destinationWarehouseValue: 'WH-01', destinationWarehouse: { value: 'WH-01', label: '长沙仓', known: true, effectiveEnabled: false } }, t), '长沙仓（已停用）')
})

test('已到仓显示两层数量，切仓保留查询并回第一页；其他视图不读取仓库统计', async (context) => {
  const f = await pageFixture()
  context.after(f.dispose)
  assert.equal(f.state.showWarehouseFilter.value, false)
  f.state.selectWarehouse('warehouse:north')
  assert.equal(f.navigations.length, 0)
  f.route.query = { view: 'WAREHOUSE_RECEIVED', page: '3', pageSize: '50', keyword: '柜子', supplierValue: 'supplier-1', orderDateFrom: '2026-09-01' } as typeof f.route.query
  assert.equal(f.state.showWarehouseFilter.value, true)
  assert.deepEqual(Array.from(f.state.warehouseTabs.value, item => item.count), [7, 2, 5])
  f.state.selectWarehouse('warehouse:north')
  assert.deepEqual({ ...f.navigations.at(-1) }, { ...f.route.query, page: '1', destinationWarehouseValue: 'north' })
  f.route.query = { ...f.route.query, destinationWarehouseValue: 'north' } as typeof f.route.query
  assert.equal(f.state.activeWarehouse.value, 'warehouse:north')
  assert.equal(f.state.tabs.value.find(item => item.value === 'WAREHOUSE_RECEIVED')?.count, 7)
  f.state.search()
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, 'north')
  f.state.selectWarehouse('__all__')
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, undefined)
  f.state.selectTab('SHIPPED')
  assert.equal(f.navigations.at(-1)?.destinationWarehouseValue, undefined)
  assert.equal(f.navigations.at(-1)?.page, '1')
  f.route.query = { ...f.route.query, view: 'SHIPPED' }
  assert.equal(f.state.showWarehouseFilter.value, false)
})

test('未知选择不导航，仓库统计未完成或失败时不伪造零；失活及撤权不允许切换', async (context) => {
  const f = await pageFixture()
  context.after(f.dispose)
  f.route.query.view = 'WAREHOUSE_RECEIVED'
  f.data.warehouseCounts.value = []
  assert.deepEqual(Array.from(f.state.warehouseTabs.value, item => item.count), [7, undefined, undefined])
  f.data.countsError.value = true
  assert.equal(f.state.warehouseTabs.value[0]?.count, undefined)
  f.state.selectWarehouse('warehouse:non-existent')
  f.permission.value = false
  f.state.selectWarehouse('warehouse:north')
  f.permission.value = true
  f.lifecycle.deactivate!()
  f.state.selectWarehouse('warehouse:north')
  assert.equal(f.navigations.length, 0)
})

test('采运已到仓海快只轻提示，错误视图、货件状态、撤权和停用均不响应', async (context) => {
  const f = await pageFixture()
  context.after(f.dispose)
  f.route.query.view = 'WAREHOUSE_RECEIVED'
  f.state.handleTransportAction({ viewStatus: 'WAREHOUSE_RECEIVED' }, 'seaExpress')
  assert.deepEqual(f.info, ['purchaseShipments.seaExpressUnavailable'])
  f.state.handleTransportAction({ viewStatus: 'SHIPPED' }, 'seaExpress')
  f.route.query.view = 'CONTAINER_LOADED'
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' }, 'seaExpress')
  f.route.query.view = 'WAREHOUSE_RECEIVED'
  f.permission.value = false
  f.state.handleTransportAction({ viewStatus: 'WAREHOUSE_RECEIVED' }, 'seaExpress')
  f.permission.value = true
  f.lifecycle.deactivate!()
  f.state.handleTransportAction({ viewStatus: 'WAREHOUSE_RECEIVED' }, 'seaExpress')
  assert.equal(f.info.length, 1)
  assert.equal(f.navigations.length, 0)
})
