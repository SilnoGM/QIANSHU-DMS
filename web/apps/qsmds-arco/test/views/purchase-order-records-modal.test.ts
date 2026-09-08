import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 沿用采购页面 Node.js 测试入口。
import test from 'node:test'
import { getPurchaseOrderRecordCount } from '../../src/views/operations/purchase-orders/purchase-order-records-modal.logic'

const root = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

test('入口总数包含作废付款，不改变有效计数；其他两类使用服务端计数', () => {
  const order = {
    paymentRecordSummary: { totalCount: 3, count: 1, byType: [] },
    documentSummary: { count: 2, byType: [] },
    changeSummary: { statusCount: 4, amountCount: 2, latest: null },
  }
  assert.equal(getPurchaseOrderRecordCount('payments', order), 3)
  assert.equal(getPurchaseOrderRecordCount('documents', order), 2)
  assert.equal(getPurchaseOrderRecordCount('changes', order), 6)
  assert.equal(getPurchaseOrderRecordCount('payments', { ...order, paymentRecordSummary: { ...order.paymentRecordSummary, totalCount: 0 } }), 0)
})

test('记录弹窗按需读取详情、阻止旧订单响应回填并提供重试和只读视图', async () => {
  const source = await readFile(new URL('purchase-order-records-modal.vue', root), 'utf8')
  assert.match(source, /<QsGenericModal/u)
  assert.match(source, /purchaseOrdersApi.getById\(orderId, controller.signal\)/u)
  assert.match(source, /version !== requestVersion/u)
  assert.match(source, /authEpoch !== appAccountStore.authEpoch/u)
  assert.match(source, /props.order\?\.id !== orderId/u)
  assert.match(source, /onBeforeUnmount\(cancelDetailRequest\)/u)
  assert.match(source, /#error-actions/u)
  assert.match(source, /@click="loadDetail"/u)
  assert.match(source, /<PurchaseOrderRecordList/u)
  assert.match(source, /<PurchaseOrderChangeRecords/u)
  assert.doesNotMatch(source, /\.createPayment\(|\.attachDocument\(|\.voidPayment\(|\.detachDocument\(/u)
})

test('付款保留作废历史，凭证过滤解除关联，变更弹窗含状态与金额两个标签', async () => {
  const records = await readFile(new URL('purchase-order-record-list.vue', root), 'utf8')
  assert.match(records, /v-for="payment in detail.payments"/u)
  assert.match(records, /document.detachedAt === null/u)
  assert.match(records, /document.paymentId === payment.id/u)
  assert.match(records, /<FaImagePreview/u)
  assert.match(records, /payment.voidReason/u)
  assert.match(records, /noVoucher/u)
  const changes = await readFile(new URL('purchase-order-change-records.vue', root), 'utf8')
  assert.match(changes, /<FaTabs/u)
  assert.match(changes, /#status/u)
  assert.match(changes, /#amount/u)
  assert.match(changes, /revisionAmounts\(revision\)/u)
  assert.match(changes, /history.reason/u)
})
