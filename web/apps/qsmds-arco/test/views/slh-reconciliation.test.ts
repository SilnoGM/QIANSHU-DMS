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
import {
  buildSlhReconciliationBillLineFieldGroups,
  buildSlhReconciliationFocusValues,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationLoadingItemFieldGroups,
  buildSlhReconciliationOrderFieldGroups,
  resolveSlhReconciliationSelectedMember,
  SLH_RECONCILIATION_LINE_TONES,
} from '../../src/views/workbenches/slh-reconciliation/detail.logic'
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

test('详情页成员区：切换器独立成面板，核对焦点在下、三块分组面板在上', async () => {
  const page = await readPageSource('detail.vue')
  // 切换器受控接线：选中值由页面持有，状态色映射与无障碍名称都由页面给。
  assert.match(page, /<QsReconciliationLineSwitcher[\s\S]{0,400}?v-model="selectedLineId"/u)
  assert.match(page, /:items="lineSwitcherItems"/u)
  assert.match(page, /:status-tones="SLH_RECONCILIATION_LINE_TONES"/u)
  assert.match(page, /t\('slhReconciliation\.detail\.lineSwitcherLabel'\)/u)
  // 切换器挂在 FaPageMain 之外，只用一个普通容器承接页面外边距：它自己就是一块面板。
  assert.match(page, /<div class="m-4 min-w-0">[\s\S]{0,200}?<QsReconciliationLineSwitcher/u)
  // 核对焦点区在切换器下方：三个数值并列，只展示不判定，空值走占位符 + 说明文案。
  // 按产品要求不渲染标题与说明：只保留一个不可见的无障碍名称。
  assert.match(page, /role="group"[\s\S]{0,200}?:aria-label="t\('slhReconciliation\.detail\.focusTitle'\)"/u)
  assert.doesNotMatch(page, /focusHint/u)
  assert.match(page, /data-slot="slh-reconciliation-focus-item"/u)
  assert.match(page, /v-for="focus in focusValues"/u)
  assert.match(page, /<AmountDisplay[\s\S]{0,300}?:currencies="currencyCatalog\.currencies\.value"/u)
  assert.match(page, /v-if="!focus\.isEmpty"/u)
  assert.match(page, /t\('slhReconciliation\.detail\.focusEmptyNote'\)/u)
  // 三块面板：横向排布（宽屏三列），由 fieldColumns 统一渲染标题与分组。
  assert.match(page, /class="m-4 gap-4 grid items-start lg:grid-cols-2 xl:grid-cols-3"/u)
  assert.match(page, /v-for="column in fieldColumns"/u)
  assert.match(page, /v-for="group in column\.groups"/u)
  // 金额行在列里也统一走 AmountDisplay（就地覆盖对齐，缺失时回落占位符文本）。
  assert.match(page, /v-if="field\.amount"[\s\S]{0,300}?:currencies="currencyCatalog\.currencies\.value"/u)
  // 类名会被 unocss/order 重排：只断言两个覆盖都在，不锁定顺序。
  assert.match(page, /!justify-start/u)
  assert.match(page, /!text-left/u)
  // 非金额值保持等宽数据字体，两条分支都带样式类。
  assert.match(page, /<span v-else class="qs-type-data">/u)
  assert.match(page, /t\(column\.titleKey\)/u)
  // 不再有成员标题与复制入口。
  assert.doesNotMatch(page, /membersTitle|membersCopy|copyMembers|clipboard\.writeText/u)
  // 批次没有冻结行时只给一句批次级说明，不让切换器空转。
  assert.match(page, /v-if="members\.length > 0"/u)
  assert.match(page, /t\('slhReconciliation\.detail\.membersEmpty'\)/u)
  assert.doesNotMatch(page, /v-for="member in members"/u)
})

/** 三块面板现在按分组下发：用例把分组摊平后按字段 id 断言取值。 */
function flattenFields(
  groups: readonly { readonly fields: readonly { readonly id: string, readonly label: string, readonly value: string }[] }[],
) {
  return groups.flatMap(group => [...group.fields])
}

/** 译函数只回显键与参数，断言的是拼接规则本身（译文归语言包）。 */
function echoKey(key: string, params?: Record<string, unknown>): string {
  if (params === undefined) {
    return `[${key}]`
  }
  // 来源标签模板带两个参数（来源 + 币种），回显成 key:source:currency 便于断言。
  if (params.source !== undefined) {
    return `[${key}:${String(params.source)}:${String(params.currency)}]`
  }
  const param = params.line ?? params.count ?? params.label ?? ''
  return `[${key}:${String(param)}]`
}

function memberFixture(overrides: Partial<SlhReconciliationBatchMemberDto> = {}): SlhReconciliationBatchMemberDto {
  return {
    lineNumber: 1,
    sourceRowNumber: 14,
    loadingDate: '2026-09-01',
    containerBatchNameText: 'CONT-1',
    warehouseReceiptReference: 'WR-1',
    shippingMarkText: 'J-070924',
    goodsName: '木桌',
    packageCount: 12,
    packageUnit: '箱',
    grossWeightKg: '120.5',
    weightUnit: 'KG',
    lengthCm: '215',
    widthCm: '137',
    heightCm: '113',
    volumeCai: '1.234',
    reportedVolumeCai: '1.2',
    categoryCode: 'A',
    unitPriceAmount: '12.5',
    pricingBasis: 'VOLUME',
    freightAmountCny: '4425',
    codHandlingAmountCny: null,
    surchargeAmountCny: '30',
    payableAmountCny: '4455',
    codAmountTwd: '1200',
    ntdSurchargeAmountTwd: null,
    recipientInfoRaw: '王小明 0912345678 台北市',
    remark: '备注',
    reconciliationStatus: 'PENDING',
    charges: [],
    id: 'member-1',
    lineId: 'line-1',
    matchSource: 'MARK',
    matchedLoadingItemId: 'item-1',
    matchedContainerBatchName: 'CONT-1',
    matchedLoadingItemLineNumber: 12,
    matchedLoadingItem: {} as SlhReconciliationBatchMemberDto['matchedLoadingItem'],
    reconciledAt: null,
    reconciledByDisplayName: null,
    ...overrides,
  }
}

test('切换器项：value 用明细行 id、label 用唛头、两态交给 statusTones 映射', () => {
  const items = buildSlhReconciliationLineItems([
    memberFixture(),
    memberFixture({ lineId: 'line-2', shippingMarkText: '   ', reconciliationStatus: 'RECONCILED' }),
    memberFixture({ lineId: 'line-3', shippingMarkText: null }),
  ], echoKey)

  assert.deepEqual(items, [
    { value: 'line-1', label: 'J-070924', status: 'PENDING', statusLabel: '[slhBill.reconciliationStatus.PENDING]' },
    // 缺唛头与账单明细列同一口径：显示占位符而不是空标签。
    { value: 'line-2', label: '[slhBill.valueMissing]', status: 'RECONCILED', statusLabel: '[slhBill.reconciliationStatus.RECONCILED]' },
    { value: 'line-3', label: '[slhBill.valueMissing]', status: 'PENDING', statusLabel: '[slhBill.reconciliationStatus.PENDING]' },
  ])
  assert.deepEqual(buildSlhReconciliationLineItems([], echoKey), [])
  // 状态色只登记两种取值；新增状态必须同时给出语义色，否则会静默变灰。
  assert.deepEqual(SLH_RECONCILIATION_LINE_TONES, { PENDING: 'danger', RECONCILED: 'success' })
})

test('选中行解析：命中返回成员，找不到、未选中或空批次都返回 null', () => {
  const members = [memberFixture(), memberFixture({ lineId: 'line-2' })]

  assert.equal(resolveSlhReconciliationSelectedMember(members, 'line-2')?.lineId, 'line-2')
  assert.equal(resolveSlhReconciliationSelectedMember(members, 'line-9'), null)
  assert.equal(resolveSlhReconciliationSelectedMember(members, null), null)
  assert.equal(resolveSlhReconciliationSelectedMember([], 'line-1'), null)
})

test('账单明细行面板：格式化与账单明细列同源，缺值与核对留痕统一占位符', () => {
  const fields = flattenFields(buildSlhReconciliationBillLineFieldGroups(memberFixture(), echoKey))
  const valueOf = (id: string) => fields.find(field => field.id === id)?.value

  assert.equal(valueOf('lineNumber'), '[slhBill.line.lineNumberValue:14]')
  assert.equal(valueOf('packageCount'), '12 箱')
  assert.equal(valueOf('weight'), '120.50 KG')
  assert.equal(valueOf('dimensions'), '215×137×113 [slhBill.unit.cm]')
  assert.equal(valueOf('volumeCai'), '1.23 [slhBill.unit.cai]')
  assert.equal(valueOf('reportedVolumeCai'), '1.20 [slhBill.unit.cai]')
  // 材积差异按「系统计算 − 账单自报」带符号展示。
  assert.equal(valueOf('volumeDifferenceCai'), '+0.03')
  assert.equal(valueOf('payableAmountCny'), '4455.00')
  assert.equal(valueOf('pricingBasis'), '[slhBill.pricingBasis.VOLUME]')
  assert.equal(valueOf('recipientInfo'), '王小明 0912345678 台北市')
  // 空值＝不涉及：一律占位符，不回显 null / 空串。
  assert.equal(valueOf('codHandlingAmountCny'), '[slhBill.valueMissing]')
  assert.equal(valueOf('ntdSurchargeAmountTwd'), '[slhBill.valueMissing]')
  assert.equal(valueOf('charges'), '[slhBill.valueMissing]')
  // 匹配依据属于柜次侧、对账状态与核对留痕按产品要求不展示：账单面板都不再出现。
  assert.equal(valueOf('matchSource'), undefined)
  assert.equal(valueOf('matchedContainer'), undefined)
  assert.equal(valueOf('reconciliationStatus'), undefined)
  assert.equal(valueOf('reconciledAt'), undefined)
  assert.equal(valueOf('reconciledBy'), undefined)
  for (const field of fields) {
    assert.notEqual(field.label.trim(), '', `${field.id} 缺少字段名`)
  }
})

test('账单明细行面板：尺寸缺边不进尺寸列，材积缺一侧不算差异，费用明细按币种分组', () => {
  const fields = flattenFields(buildSlhReconciliationBillLineFieldGroups(memberFixture({
    lengthCm: null,
    volumeCai: null,
    reportedVolumeCai: '2',
    pricingBasis: undefined,
    charges: [
      { chargeType: 'DELIVERY', currencyCode: 'TWD', amount: '250' },
      { chargeType: 'FREIGHT', currencyCode: 'CNY', amount: '10' },
    ] as SlhReconciliationBatchMemberDto['charges'],
    reconciledAt: '2026-10-09T10:00:00.000Z',
    reconciledByDisplayName: '张三',
  }), echoKey))
  const valueOf = (id: string) => fields.find(field => field.id === id)?.value

  // 缺任一边就不冒充账单尺寸；材积缺一侧时差异也没有意义。
  assert.equal(valueOf('dimensions'), '[slhBill.valueMissing]')
  assert.equal(valueOf('volumeCai'), '[slhBill.valueMissing]')
  assert.equal(valueOf('volumeDifferenceCai'), '[slhBill.valueMissing]')
  assert.equal(valueOf('reportedVolumeCai'), '2.00 [slhBill.unit.cai]')
  assert.equal(valueOf('pricingBasis'), '[slhBill.valueMissing]')
  // 人民币在前台币在后，组内保持来源顺序。
  assert.equal(
    valueOf('charges'),
    'CNY [slhBill.chargeType.FREIGHT] 10.00；TWD [slhBill.chargeType.DELIVERY] 250.00',
  )
})

test('账单明细行面板：计价方式缺失（服务端回 null）时走占位符而不是拼出空译文键', () => {
  // 契约上 pricingBasis 标的是可选，服务端实际会对缺失返回 null：与 undefined 同一处理。
  const fields = flattenFields(buildSlhReconciliationBillLineFieldGroups(
    memberFixture({ pricingBasis: null as unknown as SlhReconciliationBatchMemberDto['pricingBasis'] }),
    echoKey,
  ))

  assert.equal(fields.find(field => field.id === 'pricingBasis')?.value, '[slhBill.valueMissing]')
})

test('装柜明细行面板：先给匹配依据再给装柜行可比字段，收费材积带单位', () => {
  const fields = flattenFields(buildSlhReconciliationLoadingItemFieldGroups(memberFixture({
    matchedLoadingItem: {
      warehouseReceiptReference: 'WR-C-1',
      oceanShippingMarkText: 'J-070924',
      goodsName: '木桌（柜次侧）',
      packageCount: 12,
      packageUnit: '箱',
      grossWeightKg: '120.5',
      lengthCm: '215',
      widthCm: '137',
      heightCm: '113',
      volumeCai: '1.234',
      chargeableVolumeCai: 7,
      reportedVolumeCai: '1.2',
      codAmountTwd: '1200',
      recipientName: '林口仓库',
      recipientPhone: '0911111111',
      recipientAddress: '新北市林口区',
      remark: '柜次备注',
      shipmentNo: 'PS-0001',
    },
  }), echoKey))
  const valueOf = (id: string) => fields.find(field => field.id === id)?.value

  // 匹配依据在最前：怎么找到这一行的。
  assert.equal(fields[0]?.id, 'matchSource')
  assert.equal(valueOf('matchSource'), '[slhReconciliation.detail.matchSourceValue.MARK]')
  assert.equal(valueOf('matchedContainer'), 'CONT-1 #12')
  assert.equal(valueOf('shipmentNo'), 'PS-0001')
  // 装柜行自己的可比字段：与账单面板同一套格式化口径。
  assert.equal(valueOf('warehouseReceiptReference'), 'WR-C-1')
  assert.equal(valueOf('shippingMark'), 'J-070924')
  assert.equal(valueOf('goodsName'), '木桌（柜次侧）')
  assert.equal(valueOf('packageCount'), '12 箱')
  // 装柜行的毛重列本身以 kg 定义（没有独立单位字段），沿用重量格式化「无单位只出数值」的口径。
  assert.equal(valueOf('weight'), '120.50')
  assert.equal(valueOf('dimensions'), '215×137×113 [slhBill.unit.cm]')
  assert.equal(valueOf('volumeCai'), '1.23 [slhBill.unit.cai]')
  assert.equal(valueOf('chargeableVolumeCai'), '7 [slhBill.unit.cai]')
  assert.equal(valueOf('reportedVolumeCai'), '1.20 [slhBill.unit.cai]')
  assert.equal(valueOf('codAmountTwd'), '1200.00')
  assert.deepEqual(
    fields.find(field => field.id === 'codAmountTwd')?.amount,
    { value: '1200', currency: 'TWD' },
  )
  assert.equal(valueOf('recipientName'), '林口仓库')
  assert.equal(valueOf('recipientPhone'), '0911111111')
  assert.equal(valueOf('recipientAddress'), '新北市林口区')
  assert.equal(valueOf('remark'), '柜次备注')
  for (const field of fields) {
    assert.notEqual(field.label.trim(), '', `${field.id} 缺少字段名`)
  }
})

test('装柜明细行面板：缺货件号与收费材积时走占位符', () => {
  const fields = flattenFields(buildSlhReconciliationLoadingItemFieldGroups(memberFixture({
    matchedLoadingItem: {
      ...memberFixture().matchedLoadingItem,
      shipmentNo: null,
      chargeableVolumeCai: null,
      recipientName: null,
      recipientPhone: null,
      recipientAddress: null,
      remark: '  ',
    },
  }), echoKey))
  const valueOf = (id: string) => fields.find(field => field.id === id)?.value

  for (const id of ['shipmentNo', 'chargeableVolumeCai', 'recipientName', 'recipientPhone', 'recipientAddress', 'remark']) {
    assert.equal(valueOf(id), '[slhBill.valueMissing]', `${id} 应为占位符`)
  }
  // 金额为空（本行不涉及）时不下发 amount：模板回落占位符文本，而不是渲染成 0。
  assert.equal(fields.find(field => field.id === 'codAmountTwd')?.amount, undefined)
})

test('销售与采购面板：采购 9 项、销售 13 项，金额带币种、枚举取值复用采购/销售页面文案键', () => {
  const groups = buildSlhReconciliationOrderFieldGroups(memberFixture({
    purchaseOrder: {
      id: 'po-1',
      orderNo: 'CG-202609-01',
      orderStatus: 'CONFIRMED',
      purchaseTotalAmount: '4425',
      depositDueAmount: '1000',
      balanceDueAmount: '3425',
      fulfillmentStatus: 'PARTIALLY_SHIPPED',
      paymentStatus: 'PARTIALLY_PAID',
      shippingMarkText: 'J-070924',
      supplier: { source: 'DICTIONARY', value: 'MARK_SUPPLIER', label: 'Mark supplier', tone: null, known: true, effectiveEnabled: true },
    },
    salesOrder: {
      id: 'so-1',
      orderNo: 'XS-202609-01',
      orderStatus: 'PENDING_RECONCILIATION',
      currencyCode: 'TWD',
      customerName: '包装客户',
      customerPhone: '0912345678',
      customerFullAddress: '新北市林口区文化一路 100 号',
      agreedTotalAmount: '129000.5',
      depositDueAmount: '30000',
      balanceDueAmount: '99000.5',
      receivedAmount: '30000',
      outstandingAmount: '99000.5',
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'PARTIALLY_PAID',
      issuerDisplayName: '张三',
    },
  }), echoKey)

  assert.deepEqual(groups.map(group => group.id), ['purchase', 'sales'])
  assert.deepEqual(groups.map(group => group.label), [
    '[slhReconciliation.detail.purchaseGroup]',
    '[slhReconciliation.detail.salesGroup]',
  ])
  const valueOf = (groupId: string, fieldId: string) => (
    groups.find(group => group.id === groupId)?.fields.find(field => field.id === fieldId)?.value
  )
  // 采购：金额恒为人民币两位小数，三类状态取采购页面的枚举文案。
  assert.equal(valueOf('purchase', 'purchaseOrderNo'), 'CG-202609-01')
  assert.equal(valueOf('purchase', 'supplier'), 'Mark supplier')
  assert.equal(valueOf('purchase', 'purchaseTotalAmount'), 'CNY 4425.00')
  assert.equal(valueOf('purchase', 'depositDueAmount'), 'CNY 1000.00')
  assert.equal(valueOf('purchase', 'balanceDueAmount'), 'CNY 3425.00')
  assert.equal(valueOf('purchase', 'purchaseOrderStatus'), '[purchaseOrderDrawer.statuses.CONFIRMED]')
  assert.equal(valueOf('purchase', 'purchaseFulfillmentStatus'), '[purchaseOrderDrawer.statuses.PARTIALLY_SHIPPED]')
  assert.equal(valueOf('purchase', 'purchasePaymentStatus'), '[purchaseOrderDrawer.statuses.PARTIALLY_PAID]')
  assert.equal(valueOf('purchase', 'shippingMark'), 'J-070924')
  // 销售：金额带订单币种，四位小数收敛到两位展示；实际已收/待收取销售域的聚合结果。
  assert.equal(valueOf('sales', 'salesOrderNo'), 'XS-202609-01')
  assert.equal(valueOf('sales', 'customer'), '包装客户')
  assert.equal(valueOf('sales', 'customerPhone'), '0912345678')
  assert.equal(valueOf('sales', 'customerFullAddress'), '新北市林口区文化一路 100 号')
  assert.equal(valueOf('sales', 'salesTotalAmount'), 'TWD 129000.50')
  assert.equal(valueOf('sales', 'depositDueAmount'), 'TWD 30000.00')
  assert.equal(valueOf('sales', 'balanceDueAmount'), 'TWD 99000.50')
  assert.equal(valueOf('sales', 'receivedAmount'), 'TWD 30000.00')
  assert.equal(valueOf('sales', 'outstandingAmount'), 'TWD 99000.50')
  assert.equal(valueOf('sales', 'salesOrderStatus'), '[salesOrderDrawer.statuses.PENDING_RECONCILIATION]')
  assert.equal(valueOf('sales', 'salesFulfillmentStatus'), '[salesOrderDrawer.statuses.SEA_TRANSIT]')
  assert.equal(valueOf('sales', 'salesPaymentStatus'), '[salesOrderDrawer.statuses.PARTIALLY_PAID]')
  assert.equal(valueOf('sales', 'issuer'), '张三')
  const purchase = groups.find(group => group.id === 'purchase')
  const sales = groups.find(group => group.id === 'sales')
  assert.deepEqual(purchase?.fields.map(field => field.id), [
    'purchaseOrderNo',
    'supplier',
    'purchaseTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'purchaseOrderStatus',
    'purchaseFulfillmentStatus',
    'purchasePaymentStatus',
    'shippingMark',
  ])
  assert.deepEqual(sales?.fields.map(field => field.id), [
    'salesOrderNo',
    'balanceDueAmount',
    'receivedAmount',
    'outstandingAmount',
    'salesTotalAmount',
    'depositDueAmount',
    'customer',
    'customerPhone',
    'customerFullAddress',
    'salesOrderStatus',
    'salesFulfillmentStatus',
    'salesPaymentStatus',
    'issuer',
  ])
  // 金额行额外下发原始值 + 币种：模板据此改用 AmountDisplay（符号/千分位/币种精度由它负责）。
  const purchaseTotal = groups.find(group => group.id === 'purchase')?.fields.find(field => field.id === 'purchaseTotalAmount')
  const salesTotal = groups.find(group => group.id === 'sales')?.fields.find(field => field.id === 'salesTotalAmount')
  assert.deepEqual(purchaseTotal?.amount, { value: '4425', currency: 'CNY' })
  assert.deepEqual(salesTotal?.amount, { value: '129000.5', currency: 'TWD' })
  for (const group of groups) {
    for (const field of group.fields) {
      assert.notEqual(field.label.trim(), '', `${group.id}.${field.id} 缺少字段名`)
    }
  }
})

test('销售与采购面板：来源缺失时整组占位符，不猜也不留空', () => {
  const groups = buildSlhReconciliationOrderFieldGroups(memberFixture({
    purchaseOrder: null,
    salesOrder: null,
  }), echoKey)

  for (const group of groups) {
    for (const field of group.fields) {
      assert.equal(field.value, '[slhBill.valueMissing]', `${group.id}.${field.id} 应为占位符`)
    }
  }
})

test('核对焦点：三个跨域金额并列，来源标签与线索指向各自那一列', () => {
  const focus = buildSlhReconciliationFocusValues(memberFixture({
    codAmountTwd: '8000',
    matchedContainerBatchName: '1211-01柜',
    matchedLoadingItemLineNumber: 1,
    matchedLoadingItem: {
      ...memberFixture().matchedLoadingItem,
      codAmountTwd: '8000',
      shipmentNo: 'PKG/20260929-00001',
    },
    salesOrder: {
      id: 'so-1',
      orderNo: 'XS-202609-01',
      orderStatus: 'PENDING_RECONCILIATION',
      currencyCode: 'TWD',
      customerName: '包装客户',
      customerPhone: '0912345678',
      customerFullAddress: '新北市林口区',
      agreedTotalAmount: '129000.5',
      depositDueAmount: '30000',
      balanceDueAmount: '99000.5',
      receivedAmount: '30000',
      outstandingAmount: '99000.5',
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'PARTIALLY_PAID',
      issuerDisplayName: '张三',
    },
  }), echoKey)

  assert.deepEqual(focus.map(item => item.id), ['salesBalance', 'loadingCod', 'billCod'])
  // 来源标签带上各自的币种（销售侧跟随订单币种，两个代收恒为台币）。
  assert.deepEqual(focus.map(item => item.sourceLabel), [
    '[slhReconciliation.detail.focusSourceWithCurrency:[slhReconciliation.detail.focusSalesBalance]:TWD]',
    '[slhReconciliation.detail.focusSourceWithCurrency:[slhReconciliation.detail.focusLoadingCod]:TWD]',
    '[slhReconciliation.detail.focusSourceWithCurrency:[slhReconciliation.detail.focusBillCod]:TWD]',
  ])
  // 三个值各自带币种与来源线索（线索里写明单号/柜次行/账单行，便于回三列追查）。
  assert.deepEqual(focus.map(item => [item.value, item.currency, item.isEmpty]), [
    ['99000.5', 'TWD', false],
    ['8000', 'TWD', false],
    ['8000', 'TWD', false],
  ])
  assert.equal(focus[0]?.trace, '[slhReconciliation.detail.salesOrderNo] XS-202609-01')
  assert.equal(focus[1]?.trace, '[slhReconciliation.detail.matchedContainer] 1211-01柜 #1 · [slhReconciliation.detail.shipmentNo] PKG/20260929-00001')
  assert.equal(focus[2]?.trace, '[slhBill.line.lineNumber] [slhBill.line.lineNumberValue:14] · [slhBill.line.shippingMark] J-070924')
})

test('核对焦点：销售尾款币种跟随订单，代收两项恒为台币', () => {
  const focus = buildSlhReconciliationFocusValues(memberFixture({
    salesOrder: {
      id: 'so-2',
      orderNo: 'XS-202609-02',
      orderStatus: 'CONFIRMED',
      currencyCode: 'MYR',
      customerName: '马来客户',
      customerPhone: '0123456789',
      customerFullAddress: '吉隆坡',
      agreedTotalAmount: '1000',
      depositDueAmount: '0',
      balanceDueAmount: '1000',
      receivedAmount: '0',
      outstandingAmount: '1000',
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      issuerDisplayName: '李四',
    },
  }), echoKey)

  // 不做换算、不做判定：只把各自的币种如实标出来。
  assert.deepEqual(focus.map(item => item.currency), ['MYR', 'TWD', 'TWD'])
  assert.equal(focus[0]?.sourceLabel, '[slhReconciliation.detail.focusSourceWithCurrency:[slhReconciliation.detail.focusSalesBalance]:MYR]')
})

test('核对焦点：空值只下发 null 与说明位，与显式 0 区分', () => {
  const empty = buildSlhReconciliationFocusValues(memberFixture({
    codAmountTwd: null,
    matchedLoadingItem: { ...memberFixture().matchedLoadingItem, codAmountTwd: null },
  }), echoKey)
  // 空值＝本行不涉及：value 为 null（模板走占位符 + 说明文案），不是 0 也不是空串。
  assert.deepEqual(empty.map(item => [item.value, item.isEmpty]), [[null, true], [null, true], [null, true]])

  const zero = buildSlhReconciliationFocusValues(memberFixture({
    codAmountTwd: '0',
    matchedLoadingItem: { ...memberFixture().matchedLoadingItem, codAmountTwd: '0' },
  }), echoKey)
  assert.deepEqual(zero.map(item => [item.value, item.isEmpty]), [[null, true], ['0', false], ['0', false]])
})
