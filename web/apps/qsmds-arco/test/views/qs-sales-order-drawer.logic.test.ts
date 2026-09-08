import type { SalesOrderAmountRevisionDto, SalesOrderDocumentDto, SalesOrderStatusHistoryDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证只读抽屉的凭证分流及变更时间线。
import test from 'node:test'
import { buildSalesOrderTimeline, getOrderDocuments } from '../../src/components/business/QsSalesOrderDrawer/logic'

test('订单凭证排除收款凭证及已解除关联记录，且不修改原数组', () => {
  const documents = [
    { id: 'payment', documentType: 'PAYMENT_VOUCHER', detachedAt: null },
    { id: 'issuance', documentType: 'ORDER_ISSUANCE_VOUCHER', detachedAt: null },
    { id: 'removed', documentType: 'DELIVERY_RECEIPT', detachedAt: '2026-09-05' },
    { id: 'receipt', documentType: 'DELIVERY_RECEIPT', detachedAt: null },
  ] as SalesOrderDocumentDto[]
  assert.deepEqual(getOrderDocuments(documents).map(item => item.id), ['issuance', 'receipt'])
  assert.equal(documents.length, 4)
})

test('状态与金额变更合并后按时间倒序排列，保留不同类型的同名 ID', () => {
  const statuses = [{ id: 'same', changedAt: '2026-09-06T01:00:00Z' }] as SalesOrderStatusHistoryDto[]
  const amounts = [{ id: 'same', changedAt: '2026-09-06T02:00:00Z' }] as SalesOrderAmountRevisionDto[]
  const timeline = buildSalesOrderTimeline({ statusHistory: statuses, amountRevisions: amounts })
  assert.deepEqual(timeline.map(item => item.key), ['amount-same', 'status-same'])
  assert.equal(timeline[0]?.record, amounts[0])
  assert.equal(statuses[0]?.id, 'same')
  assert.deepEqual(buildSalesOrderTimeline({ statusHistory: [], amountRevisions: [] }), [])
})
