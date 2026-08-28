import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购来源选择器结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/views/operations/purchase-orders/purchase-source-sales-order-selector.vue',
  import.meta.url,
)

test('销售来源选择器使用局部搜索、AbortSignal、分页和订单摘要', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsGenericModal/u)
  assert.match(source, /选择销售订单/u)
  assert.match(source, /loadSalesOrders/u)
  assert.match(source, /new AbortController/u)
  assert.match(source, /搜索销售订单号或客户名/u)
  assert.match(source, /销售币种不写入采购订单/u)
  assert.doesNotMatch(source, /currency="CNY"/u)
  assert.match(source, /<FaPagination/u)
  assert.match(source, /emit\('confirm', \{ \.\.\.item \}\)/u)
})
