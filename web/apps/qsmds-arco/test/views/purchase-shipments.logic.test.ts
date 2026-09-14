import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 验证货件查询状态与显示边界。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parseDate } from '@internationalized/date'
import ts from 'typescript'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { buildShipmentRouteQuery, formatShipmentNumber, parseShipmentQuery, shipmentCountsQuery, shipmentStatusClass } from '../../src/views/workbenches/shipments/logic'

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
  assert.match(shipmentStatusClass('SHIPPED'), /text-primary/u)
  assert.match(shipmentStatusClass('CANCELLED'), /text-destructive/u)
  assert.notEqual(shipmentStatusClass('AWAITING_SHIPMENT'), shipmentStatusClass('PENDING_REVIEW'))
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
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ keyword, filters, dateRange, page, pageSize, search, columns })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    computed,
    reactive,
    ref,
    shallowRef,
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
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useDictionaryCatalog: () => ({ catalog: ref({ items: [] }), error: ref(null) }),
    useShipmentData: () => data,
    buildShipmentRouteQuery,
    formatShipmentNumber,
    parseShipmentQuery,
    shipmentStatusClass,
    SHIPMENT_VIEWS: ['ALL', 'PENDING_REVIEW', 'AWAITING_SHIPMENT', 'SHIPPED', 'CANCELLED'],
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
    columns: { value: Array<{ id: string, fixed?: string, accessorKey?: string }> }
  }
  lifecycle.mount!()
  return { state, route, initialPath, initialQuery, permission, navigations, lifecycle, dispose: () => stops.forEach(stop => stop()) }
}

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
