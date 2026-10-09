import type {
  SlhBillLineUnmatchedReasonCountDto,
  SlhReconciliationBatchMemberDto,
  SlhReconciliationBillOptionDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的列表筛选、可选择账单规则、弹窗接线与详情页成员清单。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import {
  buildSlhBillBlockReasonText,
  buildSlhBillSelectQuery,
  resolveSlhBillSelectEmptyKind,
  SLH_BILL_SELECT_GROUPS,
  SLH_BILL_SELECT_PAGE_SIZE,
  summarizeSlhBillBlockReasons,
  toggleSlhBillSelection,
} from '../../src/views/workbenches/slh-reconciliation/bill-select.logic'
import { buildSlhReconciliationMemberListText } from '../../src/views/workbenches/slh-reconciliation/detail.logic'
import {
  buildSlhReconciliationBatchListQuery,
  resolveSlhReconciliationBatchFilter,
  SLH_RECONCILIATION_BATCH_DEFAULT_FILTER,
  SLH_RECONCILIATION_BATCH_FILTERS,
} from '../../src/views/workbenches/slh-reconciliation/list.logic'
import {
  resolveSlhBillLineUnmatchedReasonLabelKey,
  resolveSlhReconciliationBatchLabelKey,
  resolveSlhReconciliationBatchTone,
} from '../../src/views/workbenches/slh-reconciliation/status.logic'

const MESSAGES = [zhCn, zhTw, en] as const
const BATCH_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const
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

test('批次状态与「不能核对」原因的三语文案齐全', () => {
  for (const message of MESSAGES) {
    assertTranslated(message.slhReconciliation.batchStatus, BATCH_STATUSES)
    assertTranslated(message.slhReconciliation.unmatchedReason, UNMATCHED_REASONS)
  }
  for (const status of BATCH_STATUSES) {
    assert.equal(resolveSlhReconciliationBatchLabelKey(status), `slhReconciliation.batchStatus.${status}`)
    assert.notEqual(resolveSlhReconciliationBatchTone(status).trim(), '')
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

test('列表页按名称跳详情，并复用账单状态标签', async () => {
  const source = await readPageSource('index.vue')
  assert.match(source, /router\.push\(\{ name: 'qsFinanceBillReconciliationSlhReconciliationDetail', params: \{ id \} \}\)/u)
  assert.match(source, /slhReconciliationBatchesApi\.list\(/u)
  assert.match(source, /SlhBillReconciliationStatusTag/u)
})

test('批次列表把创建人与创建时间拆成两列', async () => {
  const page = await readPageSource('index.vue')
  assert.match(page, /\{ id: 'createdBy', title: t\('slhBill\.column\.created'\), accessorFn: item => item\.createdByDisplayName/u)
  assert.match(page, /\{ id: 'created', title: t\('slhBill\.column\.createdAt'\), accessorFn: item => item\.createdAt/u)
  assert.match(page, /#cell-createdBy="\{ row \}"[\s\S]{0,160}QsPersonDisplay/u)
  assert.match(page, /#cell-created="\{ row \}"[\s\S]{0,200}DateTimeDisplay/u)
})

test('可选账单查询：分组必带、关键词去空白，每页 20 条', () => {
  assert.equal(SLH_BILL_SELECT_PAGE_SIZE, 20)
  assert.deepEqual([...SLH_BILL_SELECT_GROUPS], ['SELECTABLE', 'BLOCKED'])
  assert.deepEqual(buildSlhBillSelectQuery({ group: 'BLOCKED', page: 2, pageSize: SLH_BILL_SELECT_PAGE_SIZE, keyword: '  ' }), {
    group: 'BLOCKED',
    page: 2,
    pageSize: 20,
  })
  assert.deepEqual(buildSlhBillSelectQuery({ group: 'SELECTABLE', page: 1, pageSize: SLH_BILL_SELECT_PAGE_SIZE, keyword: ' CBILL/202609-01 ' }), {
    group: 'SELECTABLE',
    page: 1,
    pageSize: 20,
    keyword: 'CBILL/202609-01',
  })
})

test('空态分语境：有结果时不进空态，无结果按关键词与分组分流', () => {
  assert.equal(resolveSlhBillSelectEmptyKind({ group: 'SELECTABLE', keyword: '', total: 3 }), null)
  assert.equal(resolveSlhBillSelectEmptyKind({ group: 'BLOCKED', keyword: 'CBILL', total: 1 }), null)
  assert.equal(resolveSlhBillSelectEmptyKind({ group: 'SELECTABLE', keyword: '   ', total: 0 }), 'none')
  assert.equal(resolveSlhBillSelectEmptyKind({ group: 'BLOCKED', keyword: '   ', total: 0 }), 'blocked')
  assert.equal(resolveSlhBillSelectEmptyKind({ group: 'BLOCKED', keyword: ' CBILL ', total: 0 }), 'keyword')
})

test('单选：不可选的账单点不动，点已选中的取消选择，点另一张切换', () => {
  const first = { id: 'bill-1', selectable: true } as unknown as SlhReconciliationBillOptionDto
  const second = { id: 'bill-2', selectable: true } as unknown as SlhReconciliationBillOptionDto
  const blocked = { id: 'bill-3', selectable: false } as unknown as SlhReconciliationBillOptionDto
  assert.equal(toggleSlhBillSelection(null, first), first)
  assert.equal(toggleSlhBillSelection(first, second), second)
  assert.equal(toggleSlhBillSelection(first, first), null)
  // 不可选卡片只是展示态：点它既不选中也不清空已选。
  assert.equal(toggleSlhBillSelection(null, blocked), null)
  assert.equal(toggleSlhBillSelection(first, blocked), first)
})

test('不可选原因摘要：取前 2 条 + 其余类数', () => {
  const reasons = [
    { code: 'CONTAINER_NOT_FOUND', count: 6 },
    { code: 'MISSING_SHIPPING_MARK', count: 3 },
    { code: 'SALES_SOURCE_MISSING', count: 1 },
  ] as const
  const summary = summarizeSlhBillBlockReasons(reasons)
  assert.deepEqual(summary.entries.map(entry => [entry.labelKey, entry.count]), [
    ['slhReconciliation.unmatchedReason.CONTAINER_NOT_FOUND', 6],
    ['slhReconciliation.unmatchedReason.MISSING_SHIPPING_MARK', 3],
  ])
  assert.equal(summary.hiddenCount, 1)
  // 只有一种原因时没有"等 N 类"。
  assert.equal(summarizeSlhBillBlockReasons([reasons[0]]).hiddenCount, 0)
  assert.deepEqual(summarizeSlhBillBlockReasons([]), { entries: [], hiddenCount: 0 })
})

test('不可选卡片的说明分三档：占用 / 无未对账行直接给结论，无可用行给原因摘要', () => {
  // 译函数只回显键与参数，断言的是拼接规则本身（译文归语言包）。
  const translate = (key: string, params?: Record<string, unknown>): string =>
    params === undefined ? `[${key}]` : `[${key}:${String(params.count)}]`
  const reason = (code: string, count: number) => ({ code, count }) as unknown as SlhBillLineUnmatchedReasonCountDto

  assert.equal(
    buildSlhBillBlockReasonText({ blockReason: 'IN_PROGRESS_BATCH', reasons: [] }, translate),
    '[slhReconciliation.billSelect.blockInProgress]',
  )
  assert.equal(
    buildSlhBillBlockReasonText({ blockReason: 'NO_UNRECONCILED_LINES', reasons: [] }, translate),
    '[slhReconciliation.billSelect.blockNoUnreconciled]',
  )
  // 有未对账行但一行都匹配不上：结论 + 前 2 条（码 + 条数）+ 等 N 类。
  assert.equal(
    buildSlhBillBlockReasonText({
      blockReason: 'NO_RECONCILABLE_LINES',
      reasons: [reason('CONTAINER_NOT_FOUND', 6), reason('MISSING_SHIPPING_MARK', 3), reason('SALES_SOURCE_MISSING', 1)],
    }, translate),
    '[slhReconciliation.billSelect.blockNoReconcilable]'
    + '[slhReconciliation.unmatchedReason.CONTAINER_NOT_FOUND] 6 · [slhReconciliation.unmatchedReason.MISSING_SHIPPING_MARK] 3'
    + '（[slhReconciliation.billSelect.reasonMore:1]）',
  )
  // 只有一条原因时没有尾括号。
  assert.equal(
    buildSlhBillBlockReasonText({ blockReason: 'NO_RECONCILABLE_LINES', reasons: [reason('INVALID_CONTAINER_NAME', 3)] }, translate),
    '[slhReconciliation.billSelect.blockNoReconcilable][slhReconciliation.unmatchedReason.INVALID_CONTAINER_NAME] 3',
  )
})

test('新建入口接线：按钮、页头说明与创建成功跳转都挂在列表页上', async () => {
  const page = await readPageSource('index.vue')
  assert.match(page, /:description="t\('slhReconciliation\.intro'\)"/u)
  assert.match(page, /t\('slhReconciliation\.billSelect\.createButton'\)/u)
  assert.match(page, /<SlhBillSelectModal v-if="canReconcile" v-model="billSelectOpen" @created="handleBatchCreated" \/>/u)
  assert.match(page, /slhReconciliation\.billSelect\.createdToast/u)
  // 创建成功后由列表页跳详情：批次主键就是路由参数。
  assert.match(page, /viewBatch\(batch\.id\)/u)
  // 已选择的账单只在弹窗页脚出现，页面头部不常驻展示。
  assert.doesNotMatch(page, /billSelect\.selectedHint/u)
})

test('选择弹窗：工具栏分可选/不可选两组并带计数，卡片按分组切两态', async () => {
  const modal = await readPageSource('slh-bill-select-modal.vue')
  assert.match(modal, /QsGenericModal/u)
  assert.doesNotMatch(modal, /QsGenericTable|slhReconciliationBatchesApi\.candidates\(/u)
  // 分组切换用状态工具栏，两组计数与服务端同时返回的 counts 对齐。
  assert.match(modal, /<QsStatusSwitchToolbar :model-value="group" :items="groupItems"/u)
  assert.match(modal, /counts\.value = \{ selectable: response\.data\.counts\.selectable, blocked: response\.data\.counts\.blocked \}/u)
  // 可选＝单选卡片，不可选＝同款但不可点、aria-disabled 且带原因。
  assert.match(modal, /:role="group === 'SELECTABLE' \? 'radiogroup' : undefined"/u)
  assert.match(modal, /:role="bill\.selectable \? 'radio' : undefined"/u)
  assert.match(modal, /:aria-checked="bill\.selectable \? selected\?\.id === bill\.id : undefined"/u)
  assert.match(modal, /:aria-disabled="bill\.selectable \? undefined : 'true'"/u)
  assert.match(modal, /:is="bill\.selectable \? 'button' : 'div'"/u)
  assert.match(modal, /t\('slhReconciliation\.billSelect\.reconcilable', \{ count: bill\.reconcilableLineCount \}\)/u)
  assert.match(modal, /blockReasonText\(bill\)/u)
  assert.match(modal, /qs-type-meta text-destructive/u)
  assert.match(modal, /<FaPagination/u)
  assert.match(modal, /border-primary border-l-2 bg-primary\/5/u)
  // 确认后只交回选中项：详情页重构完成前不得在弹窗里跳转。
  assert.doesNotMatch(modal, /router\.push|useRouter/u)
})

test('弹窗不可选卡片的说明：占用/无行直接给结论，其余给原因摘要', async () => {
  const modal = await readPageSource('slh-bill-select-modal.vue')
  // 拼接规则已下沉到 bill-select.logic（上面按三档断言），组件只接翻译。
  assert.match(modal, /buildSlhBillBlockReasonText\(bill, \(key, params\)/u)
  assert.doesNotMatch(modal, /summarizeSlhBillBlockReasons/u)
})

test('卡片两行结构：编号与名称同为一级且加粗，元数据压成一行，创建时间不进卡片', async () => {
  const modal = await readPageSource('slh-bill-select-modal.vue')
  // 编号加粗（Mono 500 → 600），名称用紧凑标题角色（Sans 600）。
  assert.match(modal, /qs-type-data-emphasis font-semibold/u)
  assert.match(modal, /content-class="qs-type-compact-title"/u)
  // 三级信息收在同一行：期间 · 行数 · 柜号数 · 应付。
  assert.match(modal, /qs-type-meta[\s\S]{0,600}containerCount/u)
  assert.match(modal, /payableLabel/u)
  // 创建时间与创建人不再参与选择判断。
  assert.doesNotMatch(modal, /DateTimeDisplay|createdLabel/u)
})

test('弹窗确认＝创建批次并带上可核对行范围：幂等键、提交中封锁、失败留在弹窗', async () => {
  const modal = await readPageSource('slh-bill-select-modal.vue')
  assert.match(modal, /slhReconciliationBatchesApi\.create\(/u)
  // 把用户看到的可核对行集合一起发出去：服务端比对不一致就拒绝，不会静默改范围。
  assert.match(modal, /billId: selected\.value\.id, reconcilableLineIds: selected\.value\.reconcilableLineIds/u)
  assert.match(modal, /idempotencyKey \?\?= crypto\.randomUUID\(\)/u)
  // 改选账单要作废旧幂等键：那是另一个意图。
  assert.match(modal, /function selectBill[\s\S]{0,160}idempotencyKey = null/u)
  // 提交中：弹窗封锁关闭、列表与页脚一起失效（QsGenericModal 对 submitting 的处理）。
  assert.match(modal, /:submitting="submitting"/u)
  assert.match(modal, /:inert="submitting \|\| undefined"/u)
  assert.match(modal, /:disabled="selected === null \|\| submitting"/u)
  // 失败不关窗：错误留在弹窗里，并刷新两组数据（占用冲突后该账单会挪进不可选）。
  assert.match(modal, /submitError\.value = containerFailure\(failure\)\.message/u)
  assert.match(modal, /await load\(\)/u)
  assert.doesNotMatch(modal, /router\.push|useRouter/u)
})

test('批次详情页：头部只给批次与账单标识、底部承接完成批次', async () => {
  const page = await readPageSource('detail.vue')
  assert.match(page, /t\('workbench\.slhBillReconciliationDetail'\)/u)
  assert.match(page, /t\('slhReconciliation\.backToList'\)/u)
  assert.match(page, /router\.push\(\{ name: 'qsFinanceBillReconciliationSlhBillReconciliation' \}\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.completeButton'\)/u)
  assert.match(page, /slhReconciliationBatchesApi\.complete\(/u)
  // 头部辅助文字：批次状态标签 + 批次编号 + 账单编号 + 对账单名称。
  assert.match(page, /resolveSlhReconciliationBatchTone\(batch\.status\)/u)
  assert.match(page, /\{\{ batch\.batchNo \}\}/u)
  assert.match(page, /\{\{ batch\.bill\.slhBillNo \}\}/u)
  assert.match(page, /\{\{ batch\.bill\.billName \}\}/u)
  assert.match(page, /slhReconciliationBatchesApi\.get\(/u)
  // 完成与否由服务端数据派生（替代本地 ref），读取失败时禁用。
  assert.match(page, /const canComplete = computed\(\(\) => batch\.value\?\.status === 'IN_PROGRESS'\)/u)
  assert.match(page, /:disabled="!canComplete \|\| completing"/u)
  assert.match(page, /t\('slhBill\.retry'\)/u)
})

test('详情页成员清单：列出冻结的明细行，并整份复制', async () => {
  const page = await readPageSource('detail.vue')
  assert.match(page, /t\('slhReconciliation\.detail\.membersTitle', \{ count: members\.length \}\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.membersEmpty'\)/u)
  // 一行一条：明细行 ID 打头，跟上品名与柜次行号（辨认用）。
  assert.match(page, /v-for="member in members" :key="member\.id"/u)
  assert.match(page, /\{\{ member\.lineId \}\}/u)
  assert.match(page, /\{\{ member\.goodsName \}\}/u)
  assert.match(page, /\{\{ member\.matchedContainerBatchName \}\} #\{\{ member\.matchedLoadingItemLineNumber \}\}/u)
  // 复制走同一个构建函数：复制到的与看到的逐字一致。
  assert.match(page, /navigator\.clipboard\.writeText\(buildSlhReconciliationMemberListText\(members\.value\)\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.membersCopied'\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.membersCopyFailed'\)/u)
  // 没有冻结行时不给复制按钮一个空动作。
  assert.match(page, /:disabled="members\.length === 0 \|\| copyingMembers"/u)
})

test('成员清单文本与页面同形：明细行 ID · 品名 · 柜次名 #行号', () => {
  const members = [
    { lineId: 'line-1', goodsName: '木桌', matchedContainerBatchName: 'CONT-1', matchedLoadingItemLineNumber: 12 },
    { lineId: 'line-2', goodsName: '铁架', matchedContainerBatchName: 'CONT-2', matchedLoadingItemLineNumber: 3 },
  ] as unknown as SlhReconciliationBatchMemberDto[]
  assert.equal(
    buildSlhReconciliationMemberListText(members),
    'line-1 · 木桌 · CONT-1 #12\nline-2 · 铁架 · CONT-2 #3',
  )
  assert.equal(buildSlhReconciliationMemberListText([]), '')
})
