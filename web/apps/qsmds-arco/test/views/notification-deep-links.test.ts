/* eslint-disable test/no-import-node-test -- 业务页深链契约使用 Node.js 内置 runner。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(pathname: string): Promise<string> {
  return readFile(new URL(pathname, import.meta.url), 'utf8')
}

test('采购、开票、到仓页面从通知链接的 query 自动打开详情', async () => {
  const [purchase, invoice, warehouse] = await Promise.all([
    source('../../src/views/operations/purchase-orders/index.vue'),
    source('../../src/views/workbenches/invoices/records/index.vue'),
    source('../../src/views/operations/warehouse-arrivals/index.vue'),
  ])

  assert.match(purchase, /watch\(\(\) => route\.query\.id/u)
  assert.match(purchase, /openPurchaseOrderById/u)
  assert.match(invoice, /watch\(\(\) => route\.query\.id/u)
  assert.match(invoice, /openDetailById/u)
  assert.match(warehouse, /route\.query\.orderId/u)
  assert.match(warehouse, /openOrder\(orderId\)/u)
})
