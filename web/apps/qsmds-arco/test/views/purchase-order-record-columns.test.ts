import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购记录列契约使用现有 Node.js runner。
import test from 'node:test'

const root = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

test('采购记录三列使用服务端摘要，并保留原有金额、固定列和移动视图', async () => {
  const source = await readFile(new URL('index.vue', root), 'utf8')
  assert.match(source, /id: 'paymentAmountSummary',[\s\S]*?id: 'paymentRecordsSummary',\s+minWidth: 180/u)
  assert.match(source, /id: 'statusSummary',[\s\S]*?id: 'documentRecordsSummary',\s+minWidth: 170/u)
  assert.match(source, /id: 'changeRecordsSummary',\s+minWidth: 190,[\s\S]*?id: 'auditSummary'/u)
  for (const kind of ['payments', 'documents', 'changes']) {
    assert.match(source, new RegExp(`<PurchaseOrderRecordSummaryCell[^>]+kind="${kind}"[^>]+:order="row.original"`, 'u'))
    assert.match(source, new RegExp(`<PurchaseOrderRecordSummaryCell[^>]+kind="${kind}"[^>]+:order="row"`, 'u'))
  }
  assert.match(source, /fixed: 'right'/u)
})

test('摘要单元格准确展示类型、金额、次数和最近原因，不自行请求或重算付款', async () => {
  const source = await readFile(new URL('purchase-order-record-summary-cell.vue', root), 'utf8')
  assert.match(source, /paymentRecordSummary\.byType\.filter\(item => item\.count > 0\)/u)
  assert.match(source, /documentSummary\.byType\.filter\(item => item\.count > 0\)/u)
  assert.match(source, /<AmountDisplay :value="item.amount"/u)
  assert.match(source, /changeSummary\.statusCount \+ props\.order\.changeSummary\.amountCount/u)
  assert.match(source, /latest\.reason\?\.trim\(\) \|\| t\('purchaseOrderDrawer.reasonNotRecorded'\)/u)
  assert.match(source, /<DateTimeDisplay/u)
  assert.match(source, /v-else[^>]*>—</u)
  assert.doesNotMatch(source, /purchaseOrdersApi|parseFloat|Number\(item\.amount\)|fetch\(/u)
})
