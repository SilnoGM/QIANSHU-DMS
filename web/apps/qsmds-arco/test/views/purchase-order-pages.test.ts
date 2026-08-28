import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购订单 View 契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

test('待办采购复用共享列表且固定 pending 语义', async () => {
  const source = await readFile(new URL('pending.vue', ROOT), 'utf8')

  assert.match(source, /import PurchaseOrderListPage from '.\/index\.vue'/u)
  assert.match(source, /<PurchaseOrderListPage view-mode="pending"/u)
})

test('采购列表接入真实查询、全量筛选、日期范围和双创建入口', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /viewMode\?: PurchaseOrderListViewMode/u)
  assert.match(source, /purchaseOrdersApi\.list/u)
  assert.match(source, /buildPurchaseOrderListQuery/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<FaCalendarDateRange/u)
  assert.match(source, /<QsGenericTable/u)
  assert.match(source, /service_provider\.supplier/u)
  assert.match(source, /auth\('purchase-orders:read'\)/u)
  assert.match(source, /auth\('purchase-orders:create'\)/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, /新增销售关联采购/u)
  assert.match(source, /新增备货采购/u)
  assert.match(source, /name: 'operationsPurchaseOrderCreate'/u)
  assert.match(source, /@click="navigateCreate\('SALES_LINKED'\)"/u)
  assert.match(source, /@click="navigateCreate\('STOCK'\)"/u)
  assert.match(source, /query: \{ type \}/u)
  assert.match(source, /<AmountDisplay/u)
  assert.match(source, /<DateTimeDisplay/u)
  assert.match(source, /#mobile-row/u)
  assert.match(source, /订单状态/u)
  assert.match(source, /履约状态/u)
  assert.match(source, /付款状态/u)
})

test('采购创建页作为受保护隐藏路由并保持全部采购菜单激活', async () => {
  const router = await readFile(new URL(
    '../../src/router/modules/operations.workbench.ts',
    import.meta.url,
  ), 'utf8')

  assert.match(router, /path: 'purchase-orders\/create'/u)
  assert.match(router, /name: 'operationsPurchaseOrderCreate'/u)
  assert.match(router, /auth: 'purchase-orders:create'/u)
  assert.match(router, /activeMenu: '\/qs-operations\/purchase\/purchase-orders'/u)
  assert.match(router, /menu: false/u)
})
