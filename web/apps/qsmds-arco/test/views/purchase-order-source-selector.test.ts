import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购来源选择器结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/views/operations/purchase-orders/purchase-source-sales-order-selector.vue',
  import.meta.url,
)

test('销售来源选择器以采购域适配器接入公共选择弹窗', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /QsSalesOrderSelectorModal/u)
  assert.match(source, /<QsSalesOrderSelectorModal/u)
  assert.doesNotMatch(source, /<QsGenericModal/u)
  assert.match(source, /loadSalesOrders/u)
  assert.match(source, /UNPURCHASED/u)
  assert.match(source, /PARTIALLY_PURCHASED/u)
  assert.match(source, /未采购订单-采购/u)
  assert.match(source, /部分采购订单-采购/u)
  assert.doesNotMatch(source, /COMPLETED_PURCHASE_ADD_ON/u)
  assert.doesNotMatch(source, /已完成采购-加购产品/u)
  assert.doesNotMatch(source, /canAddSalesOrderProducts/u)
  assert.match(source, /withStatusSwitchCounts/u)
  assert.match(source, /view: selectedView\.value/u)
  assert.match(source, /function handleViewChange/u)
  assert.match(source, /page\.value = 1/u)
  assert.match(source, /selectedView\.value = value/u)
  assert.match(source, /@view-change="handleViewChange"/u)
  assert.match(source, /new AbortController/u)
  assert.match(source, /:selected-order-id="selectedOrderId"/u)
  assert.match(source, /@search="handleSearch"/u)
  assert.match(source, /@page-change="handlePageChange"/u)
  assert.match(source, /@retry="loadPage"/u)
  assert.match(source, /@confirm="confirmSelection"/u)
  assert.match(source, /emit\('confirm', \{ item: sourceItem, view: selectedView\.value \}\)/u)
  assert.match(source, /confirm-text="确认选择"/u)
})
