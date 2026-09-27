import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账状态的取值映射与两处页面的展示接线。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import { buildSlhBillLineColumns } from '../../src/views/workbenches/slh-bills/line-columns.logic'
import { resolveSlhBillReconciliationLabelKey, resolveSlhBillReconciliationTone } from '../../src/views/workbenches/slh-bills/reconciliation-status.logic'

const ALL_STATUSES = ['PENDING', 'PARTIAL', 'COMPLETED', 'RECONCILED'] as const

async function readPageSource(name: string) {
  return readFile(new URL(`../../src/views/workbenches/slh-bills/${name}`, import.meta.url), 'utf8')
}

test('两处取值共用同一份文案映射，且每个取值都有译文', () => {
  const messages = [zhCn, zhTw, en] as const
  for (const status of ALL_STATUSES) {
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

test('未对账保持中性，部分对账与完成态各自有颜色，不存在空样式', () => {
  const tones = ALL_STATUSES.map(status => resolveSlhBillReconciliationTone(status))
  for (const tone of tones) {
    assert.notEqual(tone.trim(), '')
  }
  assert.equal(resolveSlhBillReconciliationTone('PENDING'), 'border-muted-foreground/40 text-muted-foreground')
  assert.match(resolveSlhBillReconciliationTone('PARTIAL'), /text-amber-700/u)
  assert.match(resolveSlhBillReconciliationTone('COMPLETED'), /text-emerald-700/u)
})

test('账单列表把服务端派生的三态直接渲染成标签', async () => {
  const source = await readPageSource('index.vue')
  assert.match(source, /\{ id: 'reconciliationStatus'[\s\S]{0,120}accessorKey: 'reconciliationStatus'/u)
  // 页面只负责显示，不在前端重新汇总明细行。
  assert.match(source, /#cell-reconciliationStatus="\{ row \}"[\s\S]{0,160}:status="row\.original\.reconciliationStatus"/u)
  // 移动端卡片与表格列保持一致，两个入口都能看到状态。
  assert.match(source, /:status="row\.reconciliationStatus"/u)
})

test('详情页在共用的明细列之后追加对账状态，导入预览不受影响', async () => {
  const detailSource = await readPageSource('detail.vue')
  assert.match(detailSource, /\.\.\.buildSlhBillLineColumns\(t\)/u)
  assert.match(detailSource, /id: 'reconciliationStatus'[\s\S]{0,200}line\.reconciliationStatus/u)
  assert.match(detailSource, /#cell-reconciliationStatus="\{ row \}"[\s\S]{0,160}:status="row\.original\.reconciliationStatus"/u)
  // 共用列定义（导入预览也在用）里不能出现对账状态：预览行尚未入库，没有这个字段。
  const sharedIds = buildSlhBillLineColumns(key => key).map(column => column.id)
  assert.equal(sharedIds.includes('reconciliationStatus'), false)
})
