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
    assert.match(source, new RegExp(`@open="openRecordsModal\\('${kind}', row.original\\)"`, 'u'))
    assert.match(source, new RegExp(`@open="openRecordsModal\\('${kind}', row\\)"`, 'u'))
  }
  assert.match(source, /<PurchaseOrderRecordsModal/u)
  assert.match(source, /fixed: 'right'/u)
})

test('三列与销售一致使用可点击的图标数量按钮，零记录不禁用', async () => {
  const source = await readFile(new URL('purchase-order-record-summary-cell.vue', root), 'utf8')
  assert.match(source, /<FaButton[\s\S]*?variant="ghost"/u)
  assert.match(source, /@click="emit\('open'\)"/u)
  assert.match(source, /getPurchaseOrderRecordCount/u)
  assert.match(source, /:aria-label=/u)
  assert.match(source, /<FaIcon/u)
  assert.doesNotMatch(source, /disabled|purchaseOrdersApi|fetch\(|<AmountDisplay|<DateTimeDisplay/u)
})
