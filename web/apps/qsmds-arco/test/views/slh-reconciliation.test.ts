import type { SlhReconciliationBatchPreviewDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的取值映射、两步弹窗逻辑与页面接线。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import {
  buildSlhReconciliationBatchListQuery,
  resolveSlhReconciliationBatchFilter,
  SLH_RECONCILIATION_BATCH_DEFAULT_FILTER,
  SLH_RECONCILIATION_BATCH_FILTERS,
} from '../../src/views/workbenches/slh-reconciliation/list.logic'
import {
  buildSlhReconciliationBatchCreatePayload,
  buildSlhReconciliationPreviewColumns,
  resolveSlhReconciliationPreviewSummary,
  SLH_RECONCILIATION_SELECT_STEPS,
} from '../../src/views/workbenches/slh-reconciliation/select-modal.logic'
import {
  resolveSlhBillLineMatchSourceLabelKey,
  resolveSlhBillLineUnmatchedReasonLabelKey,
  resolveSlhReconciliationBatchLabelKey,
  resolveSlhReconciliationBatchTone,
} from '../../src/views/workbenches/slh-reconciliation/status.logic'

const MESSAGES = [zhCn, zhTw, en] as const
const MATCH_SOURCES = ['NAME', 'MARK'] as const
const UNMATCHED_REASONS = [
  'MISSING_CONTAINER_REFERENCE',
  'INVALID_CONTAINER_NAME',
  'CONTAINER_NOT_FOUND',
  'CONTAINER_AMBIGUOUS',
  'MISSING_SHIPPING_MARK',
  'MARK_NOT_FOUND_IN_CONTAINER',
  'LOADING_ITEM_AMBIGUOUS',
  'SHIPMENT_NOT_MATCHED',
  'PURCHASE_SOURCE_MISSING',
  'SALES_SOURCE_MISSING',
] as const
const BATCH_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const

async function readPageSource(name: string) {
  return readFile(new URL(`../../src/views/workbenches/slh-reconciliation/${name}`, import.meta.url), 'utf8')
}

function assertTranslated(group: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    // 文案键是动态拼的，类型检查管不到，缺译文只能在这里挡住。
    const label = group[key]
    assert.equal(typeof label, 'string', `${key} 缺少译文`)
    assert.notEqual((label as string).trim(), '')
  }
}

test('三语的 slhReconciliation 组文案键完全对齐', () => {
  const collect = (group: Record<string, unknown>, prefix = ''): string[] => Object.entries(group).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? collect(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]).sort()
  const reference = collect(zhCn.slhReconciliation as unknown as Record<string, unknown>)
  for (const message of MESSAGES) {
    assert.deepEqual(collect(message.slhReconciliation as unknown as Record<string, unknown>), reference)
  }
})

test('批次状态、匹配来源与不合格原因的三语文案齐全', () => {
  assertTranslated(zhCn.slhReconciliation.batchStatus, BATCH_STATUSES)
  assertTranslated(zhTw.slhReconciliation.batchStatus, BATCH_STATUSES)
  assertTranslated(en.slhReconciliation.batchStatus, BATCH_STATUSES)
  assertTranslated(zhCn.slhReconciliation.matchSource, MATCH_SOURCES)
  assertTranslated(zhTw.slhReconciliation.matchSource, MATCH_SOURCES)
  assertTranslated(en.slhReconciliation.matchSource, MATCH_SOURCES)
  assertTranslated(zhCn.slhReconciliation.unmatchedReason, UNMATCHED_REASONS)
  assertTranslated(zhTw.slhReconciliation.unmatchedReason, UNMATCHED_REASONS)
  assertTranslated(en.slhReconciliation.unmatchedReason, UNMATCHED_REASONS)
  for (const status of BATCH_STATUSES) {
    assert.equal(resolveSlhReconciliationBatchLabelKey(status), `slhReconciliation.batchStatus.${status}`)
    assert.notEqual(resolveSlhReconciliationBatchTone(status).trim(), '')
  }
  for (const source of MATCH_SOURCES) {
    assert.equal(resolveSlhBillLineMatchSourceLabelKey(source), `slhReconciliation.matchSource.${source}`)
  }
  for (const reason of UNMATCHED_REASONS) {
    assert.equal(resolveSlhBillLineUnmatchedReasonLabelKey(reason), `slhReconciliation.unmatchedReason.${reason}`)
  }
})

test('批次列表默认停在进行中，非法取值退回默认且关键词去空白', () => {
  assert.equal(SLH_RECONCILIATION_BATCH_DEFAULT_FILTER, 'IN_PROGRESS')
  assert.deepEqual([...SLH_RECONCILIATION_BATCH_FILTERS], ['IN_PROGRESS', 'COMPLETED', 'all'])
  assert.equal(resolveSlhReconciliationBatchFilter('COMPLETED'), 'COMPLETED')
  assert.equal(resolveSlhReconciliationBatchFilter('bogus'), 'IN_PROGRESS')
  assert.deepEqual(buildSlhReconciliationBatchListQuery({ page: 1, pageSize: 20, keyword: '  ', status: 'all' }), {
    status: 'all',
    page: 1,
    pageSize: 20,
  })
  assert.deepEqual(buildSlhReconciliationBatchListQuery({ page: 2, pageSize: 50, keyword: ' SRB ', status: 'COMPLETED' }), {
    status: 'COMPLETED',
    page: 2,
    pageSize: 50,
    keyword: 'SRB',
  })
})

test('两步弹窗：零命中不能开始对账，创建载荷带上预览到的行集合', () => {
  assert.deepEqual([...SLH_RECONCILIATION_SELECT_STEPS], ['selectBill', 'previewScope'])
  assert.deepEqual(resolveSlhReconciliationPreviewSummary(null), { matchedCount: 0, unmatchedCount: 0, canStart: false })
  const preview = {
    matched: [{ lineId: 'line-1' }, { lineId: 'line-2' }],
    unmatched: [{ lineId: 'line-3' }],
  } as unknown as SlhReconciliationBatchPreviewDto
  assert.deepEqual(resolveSlhReconciliationPreviewSummary(preview), { matchedCount: 2, unmatchedCount: 1, canStart: true })
  // 预览行集合只用于比对：服务端会用重跑结果校验，不一致就拒绝创建。
  assert.deepEqual(buildSlhReconciliationBatchCreatePayload('bill-1', preview), { billId: 'bill-1', previewLineIds: ['line-1', 'line-2'] })
  assert.deepEqual(buildSlhReconciliationBatchCreatePayload('bill-1', null), { billId: 'bill-1', previewLineIds: [] })
})

test('弹窗预览表按已匹配/未匹配给出不同列，账单行号与客户名称两表都有', () => {
  const matched = buildSlhReconciliationPreviewColumns(key => key, 'matched').map(column => column.id)
  const unmatched = buildSlhReconciliationPreviewColumns(key => key, 'unmatched').map(column => column.id)
  assert.deepEqual(matched, ['lineNumber', 'container', 'shippingMark', 'goodsName', 'customerName', 'matchedContainer', 'matchedLine', 'source'])
  assert.deepEqual(unmatched, ['lineNumber', 'container', 'shippingMark', 'goodsName', 'customerName', 'reason'])
  // 弹窗里「行号」按用户口径改叫账单行号，与详情页的列文案分开。
  const titles = buildSlhReconciliationPreviewColumns(key => key, 'unmatched').map(column => column.title)
  assert.equal(titles[0], 'slhReconciliation.selectModal.billLineNumber')
  assert.equal(titles[4], 'slhReconciliation.selectModal.customerName')
})

test('列表页按名称跳详情，并复用账单状态标签', async () => {
  const source = await readPageSource('index.vue')
  assert.match(source, /router\.push\(\{ name: 'qsFinanceBillReconciliationSlhReconciliationDetail', params: \{ id \} \}\)/u)
  assert.match(source, /slhReconciliationBatchesApi\.list\(/u)
  assert.match(source, /SlhBillReconciliationStatusTag/u)
})

test('弹窗把「开始对账」限制在有命中且无进行中提交时，并复用账单候选接口', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  assert.match(source, /slhReconciliationBatchesApi\.candidates\(/u)
  assert.match(source, /slhReconciliationBatchesApi\.matchPreview\(/u)
  assert.match(source, /:disabled="!summary\.canStart \|\| locked"/u)
  // 不允许在已匹配的行里取消勾选：预览表只是展示，没有选择控件。
  assert.doesNotMatch(source, /preview\.matched[\s\S]{0,400}FaCheckbox/u)
})

test('两处页面的提示都不用 FaAlert 的默认插槽（它只渲染 title/description）', async () => {
  // FaAlert 没有默认插槽：把文案写在标签体里会被静默丢弃，只剩一个空提示框。
  for (const name of ['detail.vue', 'slh-bill-select-modal.vue'] as const) {
    const source = await readPageSource(name)
    assert.doesNotMatch(source, /<FaAlert[^>]*>\s*\{\{/u, `${name} 把文案写进了 FaAlert 标签体`)
    assert.doesNotMatch(source, /<FaAlert[^>]*>\s*[^<\s][^<]*\{\{/u, `${name} 的 FaAlert 文案应走 :title 或 description 插槽`)
  }
})

test('弹窗第一步用操作列的选择按钮，不再用单选圆圈', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  // 右侧固定的操作列，按钮表达选中态。
  assert.match(source, /const billActionColumn = \{ fixed: 'right' as const, width: 136, minWidth: 136 \}/u)
  assert.match(source, /:action-column="billActionColumn"/u)
  assert.match(source, /#actions="\{ row \}"[\s\S]{0,600}slhReconciliation\.selectModal\.select/u)
  assert.match(source, /slhReconciliation\.selectModal\.selected/u)
  // 只保留按钮这一条选择路径：行点击会与按钮点击叠加成两次切换。
  assert.doesNotMatch(source, /@row-click/u)
  assert.match(source, /@click="selectBill\(row\.id\)"/u)
  assert.doesNotMatch(source, /i-lucide:circle-dot/u)
  assert.doesNotMatch(source, /row\.original\.id === selectedBillId \? 'i-lucide:circle'/u)
})

test('详情页只渲染本批次成员行，并显示批次与账单两个进度', async () => {
  const source = await readPageSource('detail.vue')
  // 数据边界：明细表的数据源只能是 batch.members。
  assert.match(source, /:data="batch\.members"/u)
  assert.doesNotMatch(source, /slhBillsApi/u)
  assert.match(source, /batch\.reconciledMemberCount \}\} \/ \{\{ batch\.memberCount/u)
  assert.match(source, /row\.bill\.lineCount - row\.bill\.reconciledLineCount/u)
  // 只核对未核对过的成员行，并在提交前做整批语义的说明。
  assert.match(source, /row\.original\.reconciledAt === null && inProgress/u)
  assert.match(source, /slhReconciliationBatchesApi\.reconcile\(/u)
  assert.match(source, /slhReconciliationBatchesApi\.complete\(/u)
})
