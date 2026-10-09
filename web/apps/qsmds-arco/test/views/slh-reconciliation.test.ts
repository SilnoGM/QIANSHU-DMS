import type { SlhReconciliationBatchPreviewDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的列表筛选、两步弹窗与取值映射。
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
  buildSlhReconciliationPreviewRows,
  resolveSlhReconciliationBillRowClass,
  resolveSlhReconciliationPreviewSummary,
  SLH_RECONCILIATION_SELECT_STEPS,
  SLH_RECONCILIATION_SELECTED_ROW_CLASS,
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

test('预览表收口为六列：匹配依据与不合格原因共用「匹配结果」列', () => {
  const columns = buildSlhReconciliationPreviewColumns(key => key)
  assert.deepEqual(columns.map(column => column.id), ['lineNumber', 'container', 'shippingMark', 'goodsName', 'customerName', 'matchResult'])
  // 弹窗里「行号」按用户口径改叫账单行号，与详情页的列文案分开。
  assert.equal(columns[0]?.title, 'slhReconciliation.selectModal.billLineNumber')
  assert.equal(columns[4]?.title, 'slhReconciliation.selectModal.customerName')
  assert.equal(columns[5]?.title, 'slhReconciliation.selectModal.matchResult')
})

test('预览两组固定顺序且默认展开，明细行挂在组下', () => {
  const preview = {
    matched: [{ lineId: 'line-1' }, { lineId: 'line-2' }],
    unmatched: [{ lineId: 'line-3' }],
  } as unknown as SlhReconciliationBatchPreviewDto
  const rows = buildSlhReconciliationPreviewRows(preview, { matched: '已匹配（2）', unmatched: '暂不能核对（1）' })
  assert.deepEqual(rows.map(row => row.id), ['group-matched', 'group-unmatched'])
  assert.deepEqual(rows.map(row => row.group?.count), [2, 1])
  assert.deepEqual(rows.map(row => row.group?.tone), ['matched', 'unmatched'])
  assert.deepEqual(rows[0]?.children?.map(row => row.id), ['line-line-1', 'line-line-2'])
  assert.deepEqual(rows[1]?.children?.map(row => row.id), ['line-line-3'])
  assert.deepEqual(buildSlhReconciliationPreviewRows(null, { matched: '', unmatched: '' }), [])
  // 分组只用一层：组行没有 line，明细行没有 children。
  assert.equal(rows[0]?.line, null)
  assert.equal(rows[0]?.children?.[0]?.children, undefined)
})

test('选中账单行用整行浅绿底与细绿边表达，未选中不加类', () => {
  const selected = resolveSlhReconciliationBillRowClass({ original: { id: 'bill-1' } } as never, 'bill-1')
  assert.equal(selected, SLH_RECONCILIATION_SELECTED_ROW_CLASS)
  assert.equal(resolveSlhReconciliationBillRowClass({ original: { id: 'bill-1' } } as never, 'bill-2'), '')
  // 单元格级背景 + 固定列 `!`：与账单问题行标黄同一套写法，否则固定列会保持原色把边框与底色断开。
  assert.match(SLH_RECONCILIATION_SELECTED_ROW_CLASS, /\[&>td\]:bg-primary\/5/u)
  assert.match(SLH_RECONCILIATION_SELECTED_ROW_CLASS, /\[&>td\]:border-y/u)
  assert.match(SLH_RECONCILIATION_SELECTED_ROW_CLASS, /\[&>td:first-child\]:border-l/u)
  assert.match(SLH_RECONCILIATION_SELECTED_ROW_CLASS, /\[&>td:last-child\]:border-r/u)
  assert.match(SLH_RECONCILIATION_SELECTED_ROW_CLASS, /\[&>td\[data-pinned\]\]:bg-primary\/5!/u)
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

test('页面的提示都不用 FaAlert 的默认插槽（它只渲染 title/description）', async () => {
  // FaAlert 没有默认插槽：把文案写在标签体里会被静默丢弃，只剩一个空提示框。
  const source = await readPageSource('slh-bill-select-modal.vue')
  assert.doesNotMatch(source, /<FaAlert[^>]*>\s*\{\{/u, 'slh-bill-select-modal.vue 把文案写进了 FaAlert 标签体')
  assert.doesNotMatch(source, /<FaAlert[^>]*>\s*[^<\s][^<]*\{\{/u, 'slh-bill-select-modal.vue 的 FaAlert 文案应走 :title 或 description 插槽')
})

test('弹窗第一步用操作列的选择按钮，选中行整行高亮且可再点取消', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  // 右侧固定的操作列，按钮表达选中态；选中行同时整行高亮（rowClass）。
  assert.match(source, /const billActionColumn = \{ fixed: 'right' as const, width: 124, minWidth: 124 \}/u)
  assert.match(source, /:show-row-number="false"/u)
  assert.match(source, /:action-column="billActionColumn"/u)
  assert.match(source, /:row-class="billRowClass"/u)
  assert.match(source, /#actions="\{ row \}"[\s\S]{0,700}slhReconciliation\.selectModal\.select/u)
  assert.match(source, /slhReconciliation\.selectModal\.selected/u)
  // 只保留按钮这一条选择路径：行点击会与按钮点击叠加成两次切换。
  assert.doesNotMatch(source, /@row-click/u)
  assert.match(source, /@click="selectBill\(row\.id\)"/u)
  // 已选中的按钮不再禁用：再点一次就是取消选择。
  assert.doesNotMatch(source, /variant="outline"[\s\S]{0,200}\n\s*disabled\n/u)
  assert.match(source, /slhReconciliation\.selectModal\.deselect/u)
  assert.doesNotMatch(source, /i-lucide:circle-dot/u)
})

test('弹窗第一步四列收口，账单信息与金额走堆叠单元格', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  // 状态前置到第二列、金额用折算净额（列表页同一口径）。
  const columns = source.slice(source.indexOf('const billColumns = computed'), source.indexOf('const billActionColumn'))
  const order = ['id: \'slhBillNo\'', 'id: \'reconciliationStatus\'', 'id: \'billInfo\'', 'id: \'netAmount\''].map(id => columns.indexOf(id))
  assert.deepEqual([...order].sort((left, right) => left - right), order)
  assert.equal(order.includes(-1), false)
  assert.match(source, /#cell-billInfo="\{ row \}"[\s\S]{0,300}SlhBillOverflowText/u)
  assert.match(source, /#cell-netAmount="\{ row \}"[\s\S]{0,400}resolveSlhBillNetDisplay/u)
  assert.doesNotMatch(source, /id: 'period'/u)
  assert.doesNotMatch(source, /id: 'lineCount'/u)
})

test('第二步是结论条加单表分组，两组默认展开且不再有两条分页', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  assert.match(source, /slhReconciliation\.selectModal\.canReconcile/u)
  assert.match(source, /slhReconciliation\.selectModal\.cannotReconcile/u)
  assert.match(source, /:grouping="previewGrouping"/u)
  assert.match(source, /#group-header="\{ row \}"/u)
  assert.match(source, /:show-pagination="false"/u)
  // 合并列：匹配依据与原因共用一个单元格槽位。
  assert.match(source, /#cell-matchResult="\{ row \}"/u)
  assert.doesNotMatch(source, /matchedColumns|unmatchedColumns/u)
  assert.doesNotMatch(source, /#cell-reason=/u)
  assert.doesNotMatch(source, /#cell-source=/u)
})

test('第一步页脚给出未选择时的原因提示', async () => {
  const source = await readPageSource('slh-bill-select-modal.vue')
  assert.match(source, /slhReconciliation\.selectModal\.selectHint/u)
  assert.match(source, /slhReconciliation\.selectModal\.selectedHint/u)
  assert.match(source, /qs-type-meta text-muted-foreground m-0 flex-1 min-w-0 truncate/u)
})
