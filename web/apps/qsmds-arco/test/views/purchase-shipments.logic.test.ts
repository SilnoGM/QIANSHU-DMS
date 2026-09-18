import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证货件查询状态与显示边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parseDate } from '@internationalized/date'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { buildShipmentRouteQuery, formatDestinationWarehouse, formatShipmentNumber, parseShipmentQuery, SHIPMENT_VIEWS, shipmentCountsQuery, shipmentPlaceholderAction, shipmentStatusClass } from '../../src/views/workbenches/shipments/logic'

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

test('货件序号不截断，状态绿色采用主题 primary', () => {
  assert.equal(formatShipmentNumber(1), '货件-01')
  assert.equal(formatShipmentNumber(123), '货件-123')
  assert.match(shipmentStatusClass('WAREHOUSE_RECEIVED'), /text-primary/u)
  assert.match(shipmentStatusClass('CANCELLED'), /text-destructive/u)
  assert.notEqual(shipmentStatusClass('AWAITING_SHIPMENT'), shipmentStatusClass('PENDING_REVIEW'))
  assert.notEqual(shipmentStatusClass('AWAITING_SHIPMENT'), shipmentStatusClass('SHIPPED'))
  assert.equal(parseShipmentQuery({ view: 'WAREHOUSE_RECEIVED' }).view, 'WAREHOUSE_RECEIVED')
})

test('运输预留视图可从 URL 恢复，保留筛选并具有状态颜色', () => {
  for (const view of ['CONTAINER_LOADED', 'OVERSEAS_STORAGE', 'DELIVERED'] as const) {
    const query = parseShipmentQuery({ view, keyword: '货件', page: '2' })
    assert.equal(query.view, view)
    assert.equal(buildShipmentRouteQuery(query).view, view)
    assert.deepEqual(shipmentCountsQuery(query), { keyword: '货件' })
    assert.ok(shipmentStatusClass(view))
  }
  assert.deepEqual(SHIPMENT_VIEWS.slice(-4), ['CONTAINER_LOADED', 'DELIVERED', 'OVERSEAS_STORAGE', 'CANCELLED'])
})

test('装柜只出现在已到仓视图，签收只出现在已装柜视图；寄仓及终态暂不增加操作', () => {
  assert.equal(shipmentPlaceholderAction('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED'), 'loadContainer')
  assert.equal(shipmentPlaceholderAction('CONTAINER_LOADED', 'CONTAINER_LOADED'), 'sign')
  for (const view of SHIPMENT_VIEWS) {
    if (view === 'WAREHOUSE_RECEIVED' || view === 'CONTAINER_LOADED') {
      continue
    }
    assert.equal(shipmentPlaceholderAction(view, 'WAREHOUSE_RECEIVED'), null)
    assert.equal(shipmentPlaceholderAction(view, 'CONTAINER_LOADED'), null)
  }
  assert.equal(shipmentPlaceholderAction('WAREHOUSE_RECEIVED', 'SHIPPED'), null)
  assert.equal(shipmentPlaceholderAction('CONTAINER_LOADED', 'DELIVERED'), null)
})

async function pageFixture() {
  const source = await readFile(new URL('../../src/views/workbenches/shipments/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const initialQuery = { view: 'ALL', page: '1', pageSize: '20' }
  const route = reactive({ name: 'qsPurchaseShipments', fullPath: '/qs-purchase/shipments?view=ALL&page=1&pageSize=20', query: { ...initialQuery } })
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
    counts: ref([]),
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
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ keyword, filters, dateRange, page, pageSize, search, columns, handleTransportAction })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    computed,
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
    useDictionaryCatalog: () => ({ catalog: ref({ items: [] }), error: ref(null) }),
    useShipmentData: () => data,
    buildShipmentRouteQuery,
    formatDestinationWarehouse,
    formatShipmentNumber,
    parseShipmentQuery,
    shipmentStatusClass,
    shipmentPlaceholderAction,
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
    handleTransportAction: (row: { viewStatus: string }) => void
    columns: { value: Array<{ id: string, fixed?: string, accessorKey?: string }> }
  }
  lifecycle.mount!()
  return { state, route, initialPath, initialQuery, permission, navigations, info, lifecycle, dispose: () => stops.forEach(stop => stop()) }
}

test('装柜和签收仅轻提示，撤权或页面停用不响应', async (context) => {
  const f = await pageFixture()
  context.after(f.dispose)
  for (const [view, message] of [['WAREHOUSE_RECEIVED', 'loadContainer'], ['CONTAINER_LOADED', 'sign']]) {
    f.route.query.view = view!
    f.state.handleTransportAction({ viewStatus: view! })
    assert.equal(f.info.at(-1), `purchaseShipments.${message}Unavailable`)
  }
  f.state.handleTransportAction({ viewStatus: 'DELIVERED' })
  f.permission.value = false
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' })
  f.permission.value = true
  f.lifecycle.deactivate!()
  f.state.handleTransportAction({ viewStatus: 'CONTAINER_LOADED' })
  assert.equal(f.info.length, 2)
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
  route.fullPath = '/qs-purchase/shipments?view=ALL&page=3&pageSize=50'
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
