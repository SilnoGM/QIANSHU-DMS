import type {
  SlhBillFindingDto,
  SlhReconciliationBatchMemberDto,
  SlhReconciliationBatchPreviewDto,
  SlhReconciliationMatchedItemDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的取值映射、两步弹窗逻辑与页面接线。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import {
  buildSlhReconciliationComparisons,
  buildSlhReconciliationRows,
  compareSlhReconciliationMember,
  filterSlhReconciliationComparisons,
  filterSlhReconciliationDifferences,
  groupSlhReconciliationRowsByBucket,
  nextSlhReconciliationDifferenceLineId,
  resolveSlhReconciliationField,
  SLH_RECONCILIATION_BUCKET_GROUP_THRESHOLD,
  SLH_RECONCILIATION_DIFF_BUCKETS,
  SLH_RECONCILIATION_FIELD_ORDER,
  SLH_RECONCILIATION_TOTAL_FIELDS,
  sortSlhReconciliationComparisons,
} from '../../src/views/workbenches/slh-reconciliation/diff.logic'
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

test('两处页面的提示都不用 FaAlert 的默认插槽（它只渲染 title/description）', async () => {
  // FaAlert 没有默认插槽：把文案写在标签体里会被静默丢弃，只剩一个空提示框。
  for (const name of ['detail.vue', 'slh-bill-select-modal.vue'] as const) {
    const source = await readPageSource(name)
    assert.doesNotMatch(source, /<FaAlert[^>]*>\s*\{\{/u, `${name} 把文案写进了 FaAlert 标签体`)
    assert.doesNotMatch(source, /<FaAlert[^>]*>\s*[^<\s][^<]*\{\{/u, `${name} 的 FaAlert 文案应走 :title 或 description 插槽`)
  }
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

test('详情页只渲染本批次成员行，并显示批次与账单两个进度', async () => {
  const page = await readPageSource('detail.vue')
  // 数据边界：清单的数据源只能是当前批次成员行（经判定层配对后仍是它的子集）。
  assert.match(page, /:rows="rows"/u)
  assert.match(page, /buildSlhReconciliationRows\(batch\.value\?\.members \?\? \[\]/u)
  assert.doesNotMatch(page, /slhBillsApi/u)
  assert.match(page, /batch\.reconciledMemberCount \}\} \/ \{\{ batch\.memberCount/u)
  assert.match(page, /row\.bill\.lineCount - row\.bill\.reconciledLineCount/u)
  // 只核对未核对过的成员行，并在提交前做整批语义的说明。
  assert.match(page, /member\.reconciledAt === null/u)
  assert.match(page, /slhReconciliationBatchesApi\.reconcile\(/u)
  assert.match(page, /slhReconciliationBatchesApi\.complete\(/u)
})

// ---- A 方案的差异判定：四桶、Hero 聚合与页面结构 ----

function memberFixture(
  overrides: Partial<SlhReconciliationBatchMemberDto> = {},
  matched: Partial<SlhReconciliationMatchedItemDto> = {},
): SlhReconciliationBatchMemberDto {
  return {
    charges: [],
    codAmountTwd: '340.00',
    codHandlingAmountCny: '0.00',
    containerBatchNameText: '0102-01柜',
    freightAmountCny: '366.00',
    goodsName: '机器配件',
    grossWeightKg: '320.000',
    heightCm: '113.00',
    id: 'member-1',
    lengthCm: '215.00',
    lineId: 'line-1',
    lineNumber: 1,
    loadingDate: '2026-01-02',
    matchSource: 'NAME',
    matchedContainerBatchName: '0102-01柜',
    matchedLoadingItemId: 'item-1',
    matchedLoadingItemLineNumber: 7,
    ntdSurchargeAmountTwd: null,
    packageCount: 10,
    packageUnit: 'CTN',
    payableAmountCny: '366.00',
    pricingBasis: 'WEIGHT',
    recipientAddress: '台北市測試路 1 號',
    recipientName: '林先生',
    recipientPhones: '09xx-xxx-xxx',
    reconciledAt: null,
    reconciledByDisplayName: null,
    reconciliationStatus: 'PENDING',
    reportedVolumeCai: '1.23',
    shippingMarkText: 'J-022602',
    sourceRowNumber: 12,
    surchargeAmountCny: null,
    unitPriceAmount: '1.20',
    volumeCai: '1.23',
    warehouseReceiptReference: 'WH-8891',
    weightUnit: 'KGS',
    ...overrides,
    matchedLoadingItem: {
      chargeableVolumeCai: 2,
      codAmountTwd: '300.00',
      goodsName: '机器配件',
      grossWeightKg: '320.000',
      heightCm: '113.00',
      lengthCm: '215.00',
      oceanShippingMarkText: 'J-022602',
      packageCount: 10,
      packageUnit: 'CTN',
      recipientAddress: '台北市測試路 1 號',
      recipientName: '林先生',
      recipientPhone: '09xxxxxxxx',
      reportedVolumeCai: '1.23',
      volumeCai: '1.23',
      warehouseReceiptReference: 'WH-8891',
      widthCm: '137.00',
      ...matched,
    },
    widthCm: '137.00',
  }
}

function comparisonOf(members: SlhReconciliationBatchMemberDto[], findings: SlhBillFindingDto[] = []) {
  return buildSlhReconciliationComparisons({ findings, members })
}

test('字段展示顺序取账单原表列序，代收款不再是任何特例', () => {
  const fields = compareSlhReconciliationMember(memberFixture())
  assert.deepEqual(fields.map(field => field.field), [...SLH_RECONCILIATION_FIELD_ORDER])
  // 原表列序的自然结果：入仓参考在最前，代收款落在材积之后、收货人之前。
  assert.equal(fields[0].field, 'warehouseReceiptReference')
  assert.ok(fields.findIndex(field => field.field === 'codAmountTwd') > fields.findIndex(field => field.field === 'volumeCai'))
  // 取用方式与其它字段完全一致：没有 cod 专名，按字段名查。
  const comparison = comparisonOf([memberFixture()])
  const cod = resolveSlhReconciliationField(comparison.members[0], 'codAmountTwd')
  assert.equal(cod?.state, 'DIFFERENT')
  // 差额约定为「柜次 − 账单」：账单 340、柜次 300 ⇒ −40。
  assert.equal(cod?.difference, '-40.00')
})

test('字段四态：两侧有值不等、单侧不涉及、一致、都不涉及', () => {
  const result = comparisonOf([
    memberFixture(),
    memberFixture({ codAmountTwd: null, lineId: 'line-2', lineNumber: 2 }, { codAmountTwd: '340.00' }),
    // 显式 0 与「不涉及」是两种写法：null 与 0.00 判为差异。
    memberFixture({ codAmountTwd: '0.00', lineId: 'line-3', lineNumber: 3 }, { codAmountTwd: null }),
    memberFixture({ codAmountTwd: null, lineId: 'line-4', lineNumber: 4 }, { codAmountTwd: null }),
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-5', lineNumber: 5 }),
  ])
  assert.deepEqual(result.members.map(member => resolveSlhReconciliationField(member, 'codAmountTwd')?.state), [
    'DIFFERENT',
    'ABSENT',
    'ABSENT',
    'BOTH_ABSENT',
    'SAME',
  ])
  // 单侧不涉及没有两个数可减，因此不给差额。
  assert.equal(resolveSlhReconciliationField(result.members[1], 'codAmountTwd')?.difference, null)
  assert.equal(result.summary.bucketLineCounts.COD, 3)
  assert.equal(result.summary.linesWithDifference, 3)
})

test('计费基础按记录精度比较，材积按计价方式与柜次侧配对', () => {
  const result = comparisonOf([
    // 毛重 320.000 ↔ 315.000 判为差异，差额按三位小数给出。
    memberFixture({}, { grossWeightKg: '315.000' }),
    // 按材积计价时账单的材积是取整后的计费量，对应柜次的 chargeableVolumeCai。
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-2', lineNumber: 2, pricingBasis: 'VOLUME', volumeCai: '2.00' }, { chargeableVolumeCai: 3 }),
  ])
  assert.deepEqual(result.members[0].buckets, ['COD', 'QUANTITY'])
  const quantityFields = result.members[0].fields.filter(field => field.bucket === 'QUANTITY' && field.state !== 'SAME')
  assert.deepEqual(quantityFields.map(field => field.field), ['grossWeightKg'])
  assert.equal(quantityFields[0].difference, '-5.000')
  assert.equal(resolveSlhReconciliationField(result.members[0], 'volumeCai')?.state, 'SAME')
  // 2.00 与计费量 3 判为差异，差额 +1.00。
  assert.deepEqual(result.members[1].buckets, ['QUANTITY'])
  assert.equal(resolveSlhReconciliationField(result.members[1], 'volumeCai')?.difference, '1.00')
})

test('文本参考项同样入桶：货品名差异算差异，电话归一化后相等就算一致', () => {
  const result = comparisonOf([memberFixture({ codAmountTwd: '300.00', goodsName: '机器配件(含底座)' })])
  assert.deepEqual(result.members[0].buckets, ['TEXT'])
  assert.equal(resolveSlhReconciliationField(result.members[0], 'goodsName')?.state, 'DIFFERENT')
  // 09xx-xxx-xxx 与 09xxxxxxxx 去掉分隔符后相同：不再误报，最终模糊口径待定。
  assert.equal(resolveSlhReconciliationField(result.members[0], 'recipientPhone')?.state, 'SAME')
})

test('费用出入按导入快照挂到成员行，账单级条目只计数不混进批次', () => {
  const findings: SlhBillFindingDto[] = [
    { kind: 'FREIGHT_MISMATCH', lineNumber: 1, message: '运费复算 378.00 与账单 366.00 不一致', severity: 'difference', sourceRowNumber: 12 },
    { kind: 'REMARK_NOTE', lineNumber: 99, message: '不属于本批次的行', severity: 'warning', sourceRowNumber: 110 },
    { kind: 'RATE_MISSING', lineNumber: null, message: '账单级：缺少汇率', severity: 'warning', sourceRowNumber: null },
  ]
  const result = comparisonOf([memberFixture()], findings)
  assert.deepEqual(result.members[0].buckets, ['COD', 'FEE'])
  assert.equal(result.members[0].findings.length, 1)
  assert.equal(result.summary.batchFindingCount, 1)
  assert.equal(result.summary.billFindingCount, 3)
  assert.equal(result.billLevelFindings.length, 1)
})

test('不一致处数拆成冲突、缺口与费用三段，并给出每桶处数', () => {
  const findings: SlhBillFindingDto[] = [
    { kind: 'FREIGHT_MISMATCH', lineNumber: 1, message: '运费复算不一致', severity: 'difference', sourceRowNumber: 12 },
    { kind: 'REMARK_NOTE', lineNumber: 1, message: '备注片段没有金额', severity: 'warning', sourceRowNumber: 12 },
  ]
  const result = comparisonOf([
    memberFixture(),
    // 代收款一致；毛重是「单侧不涉及」（缺口）、货品名是数值不等（冲突）。
    memberFixture(
      { codAmountTwd: '300.00', goodsName: '别的品名', lineId: 'line-2', lineNumber: 2 },
      { grossWeightKg: null, oceanShippingMarkText: 'J-022602' },
    ),
  ], findings)

  // 第 1 行：代收款冲突 + 两条费用条目。
  assert.equal(result.members[0].conflictCount, 1)
  assert.equal(result.members[0].gapCount, 0)
  assert.equal(result.members[0].findingCount, 2)
  assert.deepEqual(result.members[0].bucketCounts, { COD: 1, FEE: 2, QUANTITY: 0, TEXT: 0 })

  // 第 2 行：货品名冲突、毛重缺口，两处性质不同，不能合成一个数。
  assert.equal(result.members[1].conflictCount, 1)
  assert.equal(result.members[1].gapCount, 1)
  assert.equal(result.members[1].findingCount, 0)
  assert.equal(result.members[1].bucketCounts.QUANTITY, 1)
  assert.equal(result.members[1].bucketCounts.TEXT, 1)
  assert.equal(result.members[1].buckets.length, 2)
})

test('排序：不一致优先只区分有没有，不在桶之间分先后', () => {
  const result = comparisonOf([
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-1', lineNumber: 1 }),
    memberFixture({ lineId: 'line-2', lineNumber: 2 }),
    memberFixture({ codAmountTwd: '300.00', goodsName: '别的品名', lineId: 'line-3', lineNumber: 3 }),
  ])
  assert.deepEqual(sortSlhReconciliationComparisons(result.members, 'DIFFERENCE_FIRST').map(member => member.lineNumber), [2, 3, 1])
  assert.deepEqual(sortSlhReconciliationComparisons(result.members, 'LINE_NUMBER').map(member => member.lineNumber), [1, 2, 3])
})

test('按差异桶分组：同一行可出现在多个分组，顶部计数仍是去重行数', () => {
  const members = [
    // 代收款 + 毛重：同时命中两个桶。
    memberFixture({}, { grossWeightKg: '315.000' }),
    memberFixture({ codAmountTwd: '300.00', goodsName: '别的品名', lineId: 'line-2', lineNumber: 2 }),
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-3', lineNumber: 3 }),
  ]
  const result = comparisonOf(members)
  const groups = groupSlhReconciliationRowsByBucket(buildSlhReconciliationRows(members, result.members))
  assert.deepEqual(groups.map(group => [group.bucket, group.rows.length]), [['COD', 1], ['QUANTITY', 1], ['TEXT', 1]])
  assert.equal(groups.flatMap(group => group.rows).length, 3)
  // 去重口径：不一致行数是 2，而分组里的行数合计是 3。
  assert.equal(result.summary.linesWithDifference, 2)
  assert.ok(SLH_RECONCILIATION_BUCKET_GROUP_THRESHOLD >= 10)
})

test('「下一条不一致」按当前顺序前进，末尾返回 null', () => {
  const result = comparisonOf([
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-1', lineNumber: 1 }),
    memberFixture({ lineId: 'line-2', lineNumber: 2 }),
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-3', lineNumber: 3 }),
  ])
  assert.equal(nextSlhReconciliationDifferenceLineId(result.members, ''), 'line-2')
  assert.equal(nextSlhReconciliationDifferenceLineId(result.members, 'line-2'), null)
})

test('净差小结：只累加可加总的字段，单侧不涉及的行既不入净差也要报数', () => {
  const result = comparisonOf([
    memberFixture({}, { grossWeightKg: '315.000' }),
    memberFixture({ codAmountTwd: null, lineId: 'line-2', lineNumber: 2 }, { codAmountTwd: '340.00' }),
  ])
  const totals = result.summary.fieldTotals
  const cod = totals.find(total => total.field === 'codAmountTwd')
  assert.equal(cod?.total, '-40.00')
  assert.equal(cod?.computedCount, 1)
  assert.equal(cod?.absentCount, 1)
  const weight = totals.find(total => total.field === 'grossWeightKg')
  assert.equal(weight?.total, '-5.000')
  // 逐件尺寸不参与累加；两侧一致的字段根本不进小结。
  assert.equal(totals.some(total => total.field === 'lengthCm'), false)
  assert.equal(totals.some(total => total.field === 'packageCount'), false)
  assert.deepEqual(totals.map(total => total.field), ['codAmountTwd', 'grossWeightKg'])
})

test('只看不一致与桶筛选：筛出来的行数与计数一致', () => {
  const result = comparisonOf([
    memberFixture(),
    memberFixture({ codAmountTwd: '300.00', lineId: 'line-2', lineNumber: 2 }),
    memberFixture({ codAmountTwd: '300.00', goodsName: '别的品名', lineId: 'line-3', lineNumber: 3 }),
  ])
  assert.equal(filterSlhReconciliationComparisons(result.members, 'COD').length, result.summary.bucketLineCounts.COD)
  assert.equal(filterSlhReconciliationComparisons(result.members, 'TEXT').length, 1)
  assert.equal(filterSlhReconciliationComparisons(result.members, 'all').length, 3)
  assert.equal(filterSlhReconciliationDifferences(result.members).length, result.summary.linesWithDifference)
})

test('详情页：概览四桶等权、清单不内联数值、面板按原表列序并给出净差小结', async () => {
  const page = await readPageSource('detail.vue')
  const list = await readPageSource('slh-reconciliation-line-list.vue')
  const panel = await readPageSource('slh-reconciliation-compare-panel.vue')
  // 概览：四个桶同一套渲染规则，没有代收款专属的主数字；0 计数的桶不可点。
  assert.match(page, /SLH_RECONCILIATION_DIFF_BUCKETS/u)
  assert.doesNotMatch(page, /heroCod/u)
  assert.match(page, /activeBucket = activeBucket === chip\.bucket \? 'all' : chip\.bucket/u)
  assert.match(page, /:disabled="chip\.count === 0"/u)
  // 口径说明与进度分行，不再挤在同一行。
  assert.match(page, /slhReconciliation\.detail\.recipientNote/u)
  assert.doesNotMatch(page, /billRemaining'\) \}\} \{\{ billRemaining \}\}\s*<\/span>\s*<span v-if="!isNarrow"/u)
  // 清单只给处数与桶标签，不内联任何字段数值；计数分冲突/缺口/费用三段，筛选时改报本桶处数。
  assert.doesNotMatch(list, /AmountDisplay/u)
  assert.match(list, /conflictCount/u)
  assert.match(list, /gapCount/u)
  assert.match(list, /bucketDifferenceCount/u)
  assert.match(list, /groupSlhReconciliationRowsByBucket|grouped/u)
  // 面板：不一致在前、一致折叠在后，字段顺序来自判定层；净差小结在面板内，无净差时压缩成一行。
  assert.match(panel, /panelInconsistent/u)
  assert.match(panel, /resolveSlhReconciliationFieldLabelKey/u)
  assert.match(panel, /netTitle/u)
  assert.match(panel, /netAbsent/u)
  assert.match(panel, /allTotalsAbsent/u)
  assert.match(panel, /netAllAbsent/u)
  // 不给任何桶单独的类名分支（平等：不存在按桶分色）。
  assert.doesNotMatch(list, /bucket === 'COD'/u)
  assert.doesNotMatch(panel, /bucket === 'COD'/u)
  // 判定口径只有 diff.logic 一份，页面不自己算差异。
  assert.match(page, /buildSlhReconciliationComparisons\(/u)
})

test('自检修正：空态分语境、分组头吸顶、步进自动滚动、选中行有竖条', async () => {
  const list = await readPageSource('slh-reconciliation-line-list.vue')
  // 筛选后为空不能再说「本批次没有成员行」。
  assert.match(list, /filtered \? 'slhReconciliation\.detail\.emptyFiltered' : 'slhReconciliation\.detail\.emptyMembers'/u)
  // 类名顺序会被 eslint 调整，这里只断言两个 token 都在。
  assert.match(list, /top-0/u)
  assert.match(list, /sticky/u)
  assert.match(list, /data-line-id/u)
  assert.match(list, /scrollIntoView\(\{ block: 'nearest' \}\)/u)
  assert.match(list, /selectedLineId === item\.row\.key \? 'border-primary bg-primary\/5' : 'border-transparent'/u)
})

test('详情页三档断点：并排 / 抽屉 / 全屏，且不引入键盘步进', async () => {
  const page = await readPageSource('detail.vue')
  const panel = await readPageSource('slh-reconciliation-compare-panel.vue')
  assert.match(page, /useMediaQuery\('\(max-width: 1023px\)'\)/u)
  assert.match(page, /useMediaQuery\('\(max-width: 1439px\)'\)/u)
  assert.match(page, /<FaDrawer/u)
  assert.match(page, /isNarrow && panelOpen/u)
  assert.match(page, /goNextDifference/u)
  assert.match(panel, /slhReconciliation\.detail\.nextDifference/u)
  assert.doesNotMatch(page, /keydown/u)
})

test('结束本次对账仍不受未核对行数限制（Q9 门禁未定，先不实现）', async () => {
  const page = await readPageSource('detail.vue')
  assert.doesNotMatch(page, /:disabled="[^"]*pendingMemberCount[^"]*"/u)
  assert.match(page, /completeOpen = true/u)
})

test('差异判定的取值映射都有三语文案', () => {
  const detail = zhCn.slhReconciliation.detail as unknown as Record<string, unknown>
  assertTranslated(detail, [
    'filterAll',
    'recipientNote',
    'diffNone',
    'absentValue',
    'listTitle',
    'panelTitle',
    'panelInconsistent',
    'panelConsistent',
    'netTitle',
    'netHint',
    'netAbsent',
    'reconcileLine',
    'nextDifference',
  ])
  assertTranslated(detail.bucket as Record<string, unknown>, [...SLH_RECONCILIATION_DIFF_BUCKETS])
  assertTranslated(detail.unit as Record<string, unknown>, [...SLH_RECONCILIATION_TOTAL_FIELDS])
  assertTranslated(detail.field as Record<string, unknown>, [...SLH_RECONCILIATION_FIELD_ORDER])
  assertTranslated(detail.fieldState as Record<string, unknown>, ['SAME', 'DIFFERENT', 'ABSENT', 'BOTH_ABSENT'])
  assertTranslated(detail.finding as Record<string, unknown>, [
    'FREIGHT_MISMATCH',
    'PAYABLE_MISMATCH',
    'VOLUME_MISMATCH',
    'CHARGE_MISMATCH',
    'SUBTOTAL_MISMATCH',
    'NET_AMOUNT_MISMATCH',
    'DIMENSION_PRECISION',
    'RATE_MISSING',
    'REMARK_NOTE',
  ])
})
