import type { SalesOrderAmountRevisionDto, SalesOrderDocumentDto, SalesOrderStatusHistoryDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证只读抽屉的凭证分流及变更时间线。
import test from 'node:test'
import { buildSalesOrderTimeline, describeCompletionHold, getOrderDocuments } from '../../src/components/business/QsSalesOrderDrawer/logic'

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

test('停留原因映射到标签与解释文案：无停留返回空，对账进行中按未核对行数选解释模板', () => {
  assert.equal(describeCompletionHold(null), null)
  assert.deepEqual(describeCompletionHold({
    reason: 'PAYMENT_INCOMPLETE',
    pendingBatchCount: 0,
    unreconciledMemberCount: 0,
  }), {
    labelKey: 'salesOrderDrawer.completionHolds.PAYMENT_INCOMPLETE',
    hintKey: 'salesOrderDrawer.completionHolds.PAYMENT_INCOMPLETE_HINT',
    hintParams: {},
  })
  assert.deepEqual(describeCompletionHold({
    reason: 'RECONCILIATION_IN_PROGRESS',
    pendingBatchCount: 2,
    unreconciledMemberCount: 5,
  }), {
    labelKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS',
    hintKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS_HINT',
    hintParams: { batchCount: 2, lineCount: 5 },
  })
  // 批次内所有行都已核对、只等完成批次时，不再提「0 行待核对」。
  assert.deepEqual(describeCompletionHold({
    reason: 'RECONCILIATION_IN_PROGRESS',
    pendingBatchCount: 1,
    unreconciledMemberCount: 0,
  }), {
    labelKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS',
    hintKey: 'salesOrderDrawer.completionHolds.RECONCILIATION_IN_PROGRESS_HINT_NO_LINES',
    hintParams: { batchCount: 1 },
  })
  assert.deepEqual(describeCompletionHold({
    reason: 'AWAITING_RECONCILIATION_COVERAGE',
    pendingBatchCount: 0,
    unreconciledMemberCount: 0,
  }), {
    labelKey: 'salesOrderDrawer.completionHolds.AWAITING_RECONCILIATION_COVERAGE',
    hintKey: 'salesOrderDrawer.completionHolds.AWAITING_RECONCILIATION_COVERAGE_HINT',
    hintParams: {},
  })
})
