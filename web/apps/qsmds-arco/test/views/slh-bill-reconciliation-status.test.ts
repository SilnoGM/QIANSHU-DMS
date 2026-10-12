import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账状态的取值映射与两处页面的展示接线。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import { buildSlhBillLineColumns } from '../../src/views/workbenches/slh-bills/line-columns.logic'
import {
  isSlhBillReconciliationStartBlocked,
  resolveSlhBillReconciliationEntry,
  resolveSlhBillReconciliationEntryLabelKey,
  resolveSlhBillReconciliationLabelKey,
  resolveSlhBillReconciliationTone,
} from '../../src/views/workbenches/slh-bills/reconciliation-status.logic'

const ALL_STATUSES = ['PENDING', 'PARTIAL', 'COMPLETED', 'RECONCILED'] as const
const ALL_LABEL_VALUES = [...ALL_STATUSES, 'all'] as const

async function readPageSource(name: string) {
  return readFile(new URL(`../../src/views/workbenches/slh-bills/${name}`, import.meta.url), 'utf8')
}

test('两处取值共用同一份文案映射，且每个取值都有译文', () => {
  const messages = [zhCn, zhTw, en] as const
  for (const status of ALL_LABEL_VALUES) {
    const key = resolveSlhBillReconciliationLabelKey(status)
    assert.equal(key, `slhBill.reconciliationStatus.${status}`)
    for (const message of messages) {
      // 文案键是动态拼的，类型检查管不到，缺译文只能在这里挡住。
      const label = (message.slhBill.reconciliationStatus as Record<string, string>)[status]
      assert.equal(typeof label, 'string')
      assert.notEqual(label.trim(), '')
    }
  }
})

test('状态颜色按需求固定：未对账红、部分对账黄、完成与已对账绿', () => {
  const tones = ALL_STATUSES.map(status => resolveSlhBillReconciliationTone(status))
  for (const tone of tones) {
    assert.notEqual(tone.trim(), '')
  }
  assert.match(resolveSlhBillReconciliationTone('PENDING'), /text-destructive/u)
  assert.match(resolveSlhBillReconciliationTone('PARTIAL'), /text-amber-700/u)
  assert.match(resolveSlhBillReconciliationTone('COMPLETED'), /text-emerald-700/u)
  assert.match(resolveSlhBillReconciliationTone('RECONCILED'), /text-emerald-700/u)
})

test('列表操作列的对账入口按「有没有进行中批次」出现，三态只决定没有批次时给不给入口', () => {
  const entry = (overrides: Partial<Parameters<typeof resolveSlhBillReconciliationEntry>[0]> = {}) => resolveSlhBillReconciliationEntry({
    countsKnown: true,
    inProgressBatchId: null,
    reconciliationStatus: 'PENDING',
    superseded: false,
    ...overrides,
  })

  // 有进行中批次：一律「继续对账」，与明细行核对到什么程度无关——
  // 刚建批次还没核对（PENDING）是继续，全部核对完但没结束（COMPLETED）也是继续。
  assert.equal(entry({ inProgressBatchId: 'batch-1' }), 'CONTINUE')
  assert.equal(entry({ inProgressBatchId: 'batch-1', reconciliationStatus: 'PARTIAL' }), 'CONTINUE')
  assert.equal(entry({ inProgressBatchId: 'batch-1', reconciliationStatus: 'COMPLETED' }), 'CONTINUE')
  // 没有批次：全部核对完的账单没有可开的活，其余（未对账 / 上一轮结束后剩下没核对的）都能开新一轮。
  assert.equal(entry(), 'START')
  assert.equal(entry({ reconciliationStatus: 'PARTIAL' }), 'START')
  assert.equal(entry({ reconciliationStatus: 'COMPLETED' }), null)
  // 已被取代的账单不给入口；计数与批次信息还没取到（或取不到）时也不给：宁可少给，也不给错的。
  assert.equal(entry({ superseded: true }), null)
  assert.equal(entry({ superseded: true, inProgressBatchId: 'batch-1' }), null)
  assert.equal(entry({ countsKnown: false }), null)
  assert.equal(entry({ countsKnown: false, inProgressBatchId: 'batch-1' }), null)
  // 「开始对账」没有可核对的行时按钮照常出现（软禁用），点了说明原因；继续对账不受这条影响。
  assert.equal(isSlhBillReconciliationStartBlocked({ inProgressBatchId: null, reconcilableLineCount: 0 }), true)
  assert.equal(isSlhBillReconciliationStartBlocked({ inProgressBatchId: null, reconcilableLineCount: 3 }), false)
  assert.equal(isSlhBillReconciliationStartBlocked({ inProgressBatchId: 'batch-1', reconcilableLineCount: 0 }), false)
  // 两个入口的文案三语都要有。
  assert.equal(resolveSlhBillReconciliationEntryLabelKey('START'), 'slhBill.startReconciliation')
  assert.equal(resolveSlhBillReconciliationEntryLabelKey('CONTINUE'), 'slhBill.continueReconciliation')
  for (const message of [zhCn, zhTw, en] as const) {
    for (const key of [
      'startReconciliation',
      'continueReconciliation',
      'reconcilingBatch',
      'startReconciliationTitle',
      'startReconciliationHint',
      'startReconciliationConfirm',
      'startReconciliationSuccess',
    ] as const) {
      assert.equal(typeof message.slhBill[key], 'string')
      assert.notEqual(message.slhBill[key].trim(), '')
    }
  }
})

test('账单列表把服务端派生的三态直接渲染成标签，列紧跟账单期间', async () => {
  const source = await readPageSource('index.vue')
  assert.match(source, /\{ id: 'reconciliationStatus'[\s\S]{0,120}accessorKey: 'reconciliationStatus'/u)
  // 列序：账单期间 → 对账状态 → 明细行数。
  const columns = source.slice(source.indexOf('const columns = computed'))
  const order = ['id: \'period\'', 'id: \'reconciliationStatus\'', 'id: \'lineCount\''].map(id => columns.indexOf(id))
  assert.deepEqual([...order].sort((left, right) => left - right), order)
  assert.equal(order.includes(-1), false)
  // 页面只负责显示，不在前端重新汇总明细行。
  assert.match(source, /#cell-reconciliationStatus="\{ row \}"[\s\S]{0,160}:status="row\.original\.reconciliationStatus"/u)
  // 移动端卡片与表格列保持一致，两个入口都能看到状态。
  assert.match(source, /:status="row\.reconciliationStatus"/u)
})

test('详情页在共用的明细列之后追加对账状态并右固定，导入预览不受影响', async () => {
  const detailSource = await readPageSource('detail.vue')
  assert.match(detailSource, /\.\.\.buildSlhBillLineColumns\(t\)/u)
  // 对账状态是明细表最后一列且固定在右侧；本表没有操作列，它就是最右一列。
  assert.match(detailSource, /id: 'reconciliationStatus'[\s\S]{0,260}fixed: 'right'/u)
  assert.match(detailSource, /#cell-reconciliationStatus="\{ row \}"[\s\S]{0,160}:status="row\.original\.reconciliationStatus"/u)
  // 共用列定义（导入预览也在用）里不能出现对账状态：预览行尚未入库，没有这个字段。
  const sharedIds = buildSlhBillLineColumns(key => key).map(column => column.id)
  assert.equal(sharedIds.includes('reconciliationStatus'), false)
})
