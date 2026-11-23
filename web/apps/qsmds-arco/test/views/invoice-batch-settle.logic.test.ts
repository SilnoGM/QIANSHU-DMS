import type { InvoiceBatchSettleRow } from '../../src/views/workbenches/invoices/invoice-batch-settle.logic'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它 views 测试同一范式：直接校验纯函数。
import test from 'node:test'
import {
  buildBatchSettlePreview,
  canBatchSettleRow,
  INVOICE_BATCH_SETTLE_LIMIT,
  isBatchSettleSelectionDisabled,
  reconcileBatchSettleSelection,
  resolveBatchSettlePageSelection,
  resolveBatchSettleSelectedPageIds,
} from '../../src/views/workbenches/invoices/invoice-batch-settle.logic'

const NOW = new Date('2026-11-23T00:00:00.000Z')

function row(id: string, overrides: Partial<InvoiceBatchSettleRow> = {}): InvoiceBatchSettleRow {
  return {
    id,
    status: 'ISSUED',
    documentUploadedAt: '2026-11-10T00:00:00.000Z',
    invoiceNo: ['INV/', id].join(''),
    buyerName: ['客户', id].join(''),
    totalAmount: '1000',
    ...overrides,
  }
}

test('批量结算资格：已开出邮寄且照片上传满 120 小时', () => {
  assert.equal(canBatchSettleRow(row('a'), NOW), true)
  assert.equal(canBatchSettleRow(row('a', { status: 'NOTIFIED' }), NOW), false)
  assert.equal(canBatchSettleRow(row('a', { status: 'SETTLED' }), NOW), false)
  assert.equal(canBatchSettleRow(row('a', { documentUploadedAt: '2026-11-20T00:00:00.000Z' }), NOW), false)
  assert.equal(canBatchSettleRow(row('a', { documentUploadedAt: null }), NOW), false)
})

test('已选行始终可取消，不可结算行与超额新增被禁用', () => {
  const selected = new Map([['a', row('a')]])
  // 状态在别处变化后仍要能取消勾选，否则复选框会卡住。
  assert.equal(isBatchSettleSelectionDisabled(selected, row('a', { status: 'SETTLED' }), NOW), false)
  assert.equal(isBatchSettleSelectionDisabled(selected, row('b', { status: 'NOTIFIED' }), NOW), true)

  const full = new Map(
    Array.from({ length: INVOICE_BATCH_SETTLE_LIMIT }, (_, index) => [String(index), row(String(index))]),
  )
  assert.equal(isBatchSettleSelectionDisabled(full, row('extra'), NOW), true)
})

test('跨页选择保留其他页快照，并在超过上限时标记 limited', () => {
  const selected = new Map([['page-2', row('page-2')]])
  const result = reconcileBatchSettleSelection(selected, [row('a'), row('b')], { 'page-2': true, 'a': true })
  assert.deepEqual([...result.selected.keys()].sort(), ['a', 'page-2'])
  assert.equal(result.limited, false)

  const full = new Map(
    Array.from({ length: INVOICE_BATCH_SETTLE_LIMIT }, (_, index) => [String(index), row(String(index))]),
  )
  const rowSelection = Object.fromEntries([...full.keys()].map(key => [key, true]))
  rowSelection.overflow = true
  const overflow = reconcileBatchSettleSelection(full, [row('overflow')], rowSelection)
  assert.equal(overflow.limited, true)
  assert.equal(overflow.selected.size, INVOICE_BATCH_SETTLE_LIMIT)
  assert.equal(overflow.selected.has('overflow'), false)
})

test('选择本页只补足剩余额度，跳过已选与不可结算行', () => {
  const selected = new Map([['a', row('a')]])
  const plan = resolveBatchSettlePageSelection(
    [row('a'), row('b'), row('c', { status: 'NOTIFIED' }), row('d', { documentUploadedAt: null })],
    selected,
    NOW,
  )
  assert.deepEqual(plan.ids, ['b'])
  assert.equal(plan.count, 1)
  assert.equal(plan.remaining, INVOICE_BATCH_SETTLE_LIMIT - 2)
})

test('取消本页只返回当前页已选中的行', () => {
  const selected = new Map([['a', row('a')], ['other-page', row('other-page')]])
  assert.deepEqual(resolveBatchSettleSelectedPageIds([row('a'), row('b')], selected), ['a'])
})

test('批量预览逐单向上取整后相加，汇率非法时不展示数字', () => {
  // 1000 ÷ 4.5 × 0.06 + 30 = 43.33… → 44；2000 → 56.67… → 57；合计 101。
  const preview = buildBatchSettlePreview(
    [row('a', { totalAmount: '1000' }), row('b', { totalAmount: '2000' })],
    '4.5',
  )
  assert.deepEqual(preview?.items.map(item => item.settleAmountCny), ['44', '57'])
  assert.equal(preview?.totalAmountCny, '101.00')
  // 先合计 3000 再套公式会得到 70，少收一单的取整差，不能这样算。
  assert.equal(buildBatchSettlePreview([row('a', { totalAmount: '3000' })], '4.5')?.items[0]?.settleAmountCny, '70')
  assert.equal(buildBatchSettlePreview([row('a')], '0'), null)
  assert.equal(buildBatchSettlePreview([row('a')], 'not-a-rate'), null)
})
