import type {
  SlhBillLineUnmatchedReasonCountDto,
  SlhReconciliationBatchMemberDto,
  SlhReconciliationBillOptionDto,
  SlhReconciliationMatchedPurchaseOrderDto,
  SlhReconciliationMatchedSalesOrderDto,
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
  buildSlhReconciliationBillLinePanel,
  buildSlhReconciliationFocusValues,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationLoadingItemFieldGroups,
  buildSlhReconciliationOrderSections,
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

test('销售与采购并排放置时标题为销售信息与采购信息', () => {
  assert.equal(zhCn.slhReconciliation.detail.salesGroup, '销售信息')
  assert.equal(zhCn.slhReconciliation.detail.purchaseGroup, '采购信息')
  assert.equal(zhTw.slhReconciliation.detail.salesGroup, '銷售資訊')
  assert.equal(zhTw.slhReconciliation.detail.purchaseGroup, '採購資訊')
  assert.equal(en.slhReconciliation.detail.salesGroup, 'Sales information')
  assert.equal(en.slhReconciliation.detail.purchaseGroup, 'Purchase information')
  // 「销售与采购信息」这个合成标题随拆分一起退场。
  assert.equal('ordersTitle' in zhCn.slhReconciliation.detail, false)
})

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
  // 每张卡按 accent 挂身份色渐变类，卡片内不再渲染来源线索。
  assert.match(page, /:class="`qs-focus-card--\$\{focus\.accent\}`"/u)
  assert.match(page, /qs-focus-card--emerald|qs-focus-card--amber|qs-focus-card--blue/u)
  // 身份图案是装饰元素：不进无障碍树，且压在内容下层不接鼠标事件。
  assert.match(page, /<FaIcon[\s\S]{0,120}?:name="focus\.motif"[\s\S]{0,80}?aria-hidden="true"/u)
  assert.match(page, /class="qs-focus-card__motif"/u)
  // 图案压在内容下层：内容块自身定位并抬到 z-1，避免绝对定位图案盖住金额。
  // 类名顺序会被 unocss/order 重排，只断言同一处 class 同时带上这两个类，不锁顺序。
  const contentWrapperHasLayering = /class="[^"]*relative[^"]*z-1[^"]*"/u.test(page)
    || /class="[^"]*z-1[^"]*relative[^"]*"/u.test(page)
  assert.ok(contentWrapperHasLayering, '焦点卡内容块需要同时带 relative 与 z-1')
  assert.doesNotMatch(page, /focus\.trace/u)
  // 三块面板：横向排布（宽屏三列），由 fieldColumns 统一渲染标题与分组。
  assert.match(page, /class="m-4 gap-4 grid items-start lg:grid-cols-2 xl:grid-cols-3"/u)
  assert.match(page, /v-for="column in fieldColumns"/u)
  assert.match(page, /v-for="group in column\.groups"/u)
  // 销售/采购改成专用区块模板：单号＋状态徽章的信息块、关键字段行、金额块，两块之间一条分割线。
  assert.match(page, /v-for="\(section, sectionIndex\) in orderSections"/u)
  assert.match(page, /v-if="sectionIndex > 0"[\s\S]{0,120}?border-t border-border/u)
  assert.match(page, /v-if="section\.states\.length > 0"/u)
  assert.match(page, /\{\{ section\.orderNo\.value \}\}/u)
  assert.match(page, /v-for="\(field, index\) in section\.amountFields"/u)
  // 区块标题是项目既有的竖条范式；信息块是浅底圆角容器。
  assert.match(page, /rounded-full bg-primary h-4\.5 w-1/u)
  assert.match(page, /p-3 rounded-lg bg-muted\/40/u)
  // 金额块：总额行之后虚线分隔；总额大号加粗、余额非零染红由 logic 的标记驱动。
  assert.match(page, /index === 1 \? 'pt-2 border-t border-dashed border-border' : ''/u)
  assert.match(page, /!text-xl !font-semibold/u)
  assert.match(page, /!text-destructive/u)
  // 金额块整列右对齐（AmountDisplay 是 inline-flex，靠所在行的 text-align 定位）。
  assert.match(page, /class="m-0 text-right"/u)
  // 长文本行走本地截断组件：只有真被截断才挂浮层。
  assert.match(page, /v-else-if="field\.truncate"[\s\S]{0,120}?:text="field\.value"/u)
  assert.match(page, /<SlhReconciliationOverflowText/u)
  assert.match(page, /field\.emphasis === 'total'/u)
  // 订单面板不再用分组渲染；装柜面板保持分组渲染，账单面板走独立的四段模板。
  assert.doesNotMatch(page, /orderFieldGroups|groupDividers|sectionClass/u)
  assert.match(page, /v-if="billLinePanel"/u)
  assert.match(page, /v-for="section in billLinePanel\.sections"/u)
  assert.match(page, /v-for="tag in billLinePanel\.tags"/u)
  assert.match(page, /\{\{ billLinePanel\.receiptReference\.value \}\}/u)
  // 费用段按币种分两块：每块一个大号合计，可选的明细合计行，明细第一行带虚线分隔。
  assert.match(page, /v-for="block in section\.blocks"/u)
  assert.match(page, /\{\{ block\.headline\.label \}\}/u)
  assert.match(page, /v-if="block\.summary"[\s\S]{0,400}?block\.summary\.label/u)
  assert.match(page, /v-for="\(row, index\) in block\.details"/u)
  assert.match(page, /index === 0 \? 'pt-2 border-t border-dashed border-border' : ''/u)
  assert.match(page, /v-if="row\.tag"/u)
  assert.match(page, /!text-sky-700 dark:!text-sky-300/u)
  assert.match(page, /!text-amber-700 dark:!text-amber-300/u)
  // 多行值（收货信息）与浅色标签（备注）两个分支都在。
  assert.match(page, /v-if="field\.lines && field\.lines\.length > 0"/u)
  assert.match(page, /v-else-if="field\.chip"/u)
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
    recipientName: '王小明',
    recipientAddress: '台北市',
    recipientPhones: '0912345678',
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

test('账单明细行面板：顶部信息块 + 货物明细 / 费用结算 / 收货与备注', () => {
  const panel = buildSlhReconciliationBillLinePanel(memberFixture({
    warehouseReceiptReference: '500229791776（安能） -1',
  }), echoKey)
  const [cargo, fees, recipient] = panel.sections
  if (
    cargo === undefined || cargo.id !== 'cargo'
    || fees === undefined || fees.id !== 'fees'
    || recipient === undefined || recipient.id !== 'recipient'
  ) {
    throw new Error('账单面板缺少预期分段')
  }

  // 顶部信息块：入仓单号原样展示（承运方与序号都在原始值里），行号/柜号蓝色、装柜日期中性。
  assert.equal(panel.receiptReference.label, '[slhBill.line.warehouseReceiptReference]')
  assert.equal(panel.receiptReference.value, '500229791776（安能） -1')
  assert.deepEqual(panel.tags, [
    { text: '[slhBill.line.lineNumberValue:14]', tone: 'info' },
    { text: '[slhBill.line.containerBatchName]：CONT-1', tone: 'info' },
    { text: '2026-09-01', tone: 'neutral' },
  ])
  assert.deepEqual(panel.sections.map(section => [section.id, section.label]), [
    ['cargo', '[slhReconciliation.detail.billCargoGroup]'],
    ['fees', '[slhReconciliation.detail.billFeeGroup]'],
    ['recipient', '[slhReconciliation.detail.groupRecipient]'],
  ])

  // 货物明细：三处合并行（箱数/重量、系统材积+自报比较、计价方式+类别+单价）。
  assert.deepEqual(cargo.fields.map(field => field.id), [
    'goodsName',
    'shippingMark',
    'packageAndWeight',
    'dimensions',
    'volumeCai',
    'chargeRule',
  ])
  assert.equal(cargo.fields[2]?.label, '[slhBill.line.packageCount] / [slhBill.line.weight]')
  assert.equal(cargo.fields[2]?.value, '12 箱 | 120.50 KG')
  assert.equal(cargo.fields[3]?.value, '215×137×113 [slhBill.unit.cm]')
  // 材积主值取系统计算，括号里给与账单自报的差异（本例系统更大）。
  assert.equal(cargo.fields[4]?.value, '1.23 [slhBill.unit.cai]（[slhBill.line.volumeDifferenceCai] +0.03）')
  assert.equal(
    cargo.fields[5]?.value,
    '[slhBill.pricingBasis.VOLUME] | [slhBill.line.categoryCode] A | [slhBill.line.unitPriceAmount] 12.5',
  )

  // 费用结算分两块：人民币块（合计应付 + 三项费用）与台币块（代收货款 + 杂费合计 + 逐项）。
  assert.deepEqual(fees.blocks.map(block => block.headline.id), ['payableAmountCny', 'codAmountTwd'])
  assert.deepEqual(fees.blocks.map(block => block.headline.emphasis), ['total', 'cod'])
  const [payableBlock, codBlock] = fees.blocks
  assert.equal(payableBlock?.headline.label, '[slhBill.line.payableAmountCny]')
  assert.deepEqual(payableBlock?.headline.amount, { value: '4455', currency: 'CNY' })
  assert.deepEqual(payableBlock?.details.map(row => row.id), ['freightAmountCny', 'surchargeAmountCny', 'codHandlingAmountCny'])
  assert.equal(payableBlock?.details[0]?.value, '4425.00')
  assert.equal(payableBlock?.details[1]?.value, '30.00')
  assert.equal(payableBlock?.details[1]?.tag, undefined)
  assert.equal(payableBlock?.details[2]?.value, '[slhBill.valueMissing]')
  // 代收货款与核对焦点同字段、同组件、同格式；台币杂费合计恒作明细的合计行。
  assert.deepEqual(codBlock?.headline.amount, { value: '1200', currency: 'TWD' })
  assert.deepEqual(codBlock?.headline.value, '1200.00')
  assert.equal(codBlock?.summary?.label, '[slhBill.line.ntdSurchargeAmountTwd]')
  assert.equal(codBlock?.summary?.value, '[slhBill.valueMissing]')
  assert.deepEqual(codBlock?.details, [])

  // 收货与备注：收货信息按名称 / 地址 / 电话三行，备注走浅色标签。
  assert.deepEqual(recipient.fields.map(field => field.id), ['recipientInfo', 'remark'])
  assert.deepEqual(recipient.fields[0]?.lines, ['王小明', '台北市', '0912345678'])
  assert.equal(recipient.fields[0]?.value, '王小明 / 台北市 / 0912345678')
  assert.equal(recipient.fields[1]?.chip, true)
  assert.equal(recipient.fields[1]?.value, '备注')
})

test('账单明细行面板：材积一致与缺一侧、重货费标签、多项台币杂费与合计回落', () => {
  const even = buildSlhReconciliationBillLinePanel(memberFixture({
    volumeCai: '2',
    reportedVolumeCai: '2',
    surchargeAmountCny: '100',
    charges: [
      { chargeType: 'HEAVY_CARGO', currencyCode: 'CNY', amount: '100' },
    ] as SlhReconciliationBatchMemberDto['charges'],
  }), echoKey)
  const evenCargo = even.sections[0]
  const evenFees = even.sections[1]
  if (evenCargo?.id !== 'cargo' || evenFees?.id !== 'fees') {
    throw new Error('账单面板缺少预期分段')
  }
  // 两侧一致：不写差异，只标「自报/系统一致」。
  assert.equal(evenCargo.fields[4]?.value, '2.00 [slhBill.unit.cai]（[slhReconciliation.detail.billVolumeEven]）')
  // 人民币费用已并入附加费列：标签说明这笔钱是什么费。
  assert.deepEqual(evenFees.blocks[0]?.details[1]?.tag, { text: '[slhBill.chargeType.HEAVY_CARGO]', tone: 'warning' })

  // 缺任一侧：不写括注（差异无从谈起），尺寸缺边也不冒充。
  const partial = buildSlhReconciliationBillLinePanel(memberFixture({
    volumeCai: null,
    reportedVolumeCai: '2',
    lengthCm: null,
  }), echoKey)
  const partialCargo = partial.sections[0]
  if (partialCargo?.id !== 'cargo') {
    throw new Error('账单面板缺少货物明细')
  }
  assert.equal(partialCargo.fields[3]?.value, '[slhBill.valueMissing]')
  assert.equal(partialCargo.fields[4]?.value, '[slhBill.valueMissing]')

  // 多项台币费用：逐项一行、橙红强调、与账单明细列同一精度。
  const items = buildSlhReconciliationBillLinePanel(memberFixture({
    ntdSurchargeAmountTwd: '1686',
    charges: [
      { chargeType: 'REMOTE_AREA', currencyCode: 'TWD', amount: '1000' },
      { chargeType: 'STORAGE', currencyCode: 'TWD', amount: '686' },
    ] as SlhReconciliationBatchMemberDto['charges'],
  }), echoKey)
  const itemFees = items.sections[1]
  if (itemFees?.id !== 'fees') {
    throw new Error('账单面板缺少费用结算')
  }
  assert.equal(itemFees.blocks[1]?.summary?.value, '1686.00')
  assert.deepEqual(itemFees.blocks[1]?.details.map(row => [row.label, row.value, row.emphasis]), [
    ['[slhBill.chargeType.REMOTE_AREA]', '1000.00', 'warning'],
    ['[slhBill.chargeType.STORAGE]', '686.00', 'warning'],
  ])
  // 台币杂费合计来自账单列而不是费用行推导：没有费用行时它就是这一行（不额外补行、也不漏钱）。
  const noItems = buildSlhReconciliationBillLinePanel(memberFixture({
    ntdSurchargeAmountTwd: '1000',
    charges: [],
  }), echoKey)
  const noItemFees = noItems.sections[1]
  if (noItemFees?.id !== 'fees') {
    throw new Error('账单面板缺少费用结算')
  }
  assert.equal(noItemFees.blocks[1]?.summary?.value, '1000.00')
  assert.deepEqual(noItemFees.blocks[1]?.details, [])
})

test('账单明细行面板：计价方式缺失与收货三列全空时都走占位符', () => {
  // 契约上 pricingBasis 标的是可选，服务端实际会对缺失回 null：与 undefined 同一处理。
  const panel = buildSlhReconciliationBillLinePanel(memberFixture({
    pricingBasis: null as unknown as SlhReconciliationBatchMemberDto['pricingBasis'],
    recipientName: null,
    recipientAddress: null,
    recipientPhones: null,
  }), echoKey)
  const cargo = panel.sections[0]
  const recipient = panel.sections[2]
  if (cargo?.id !== 'cargo' || recipient?.id !== 'recipient') {
    throw new Error('账单面板缺少预期分段')
  }
  assert.equal(
    cargo.fields[5]?.value,
    '[slhBill.valueMissing] | [slhBill.line.categoryCode] A | [slhBill.line.unitPriceAmount] 12.5',
  )
  assert.equal(recipient.fields[0]?.value, '[slhBill.valueMissing]')
  assert.deepEqual(recipient.fields[0]?.lines, [])
  // 匹配依据属于柜次侧、对账状态与核对留痕按产品要求不展示：账单面板都不出现。
  assert.equal(JSON.stringify(panel).includes('matchSource'), false)
  assert.equal(JSON.stringify(panel).includes('reconciliationStatus'), false)
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

/** 订单侧两个来源的完整夹具：用例只改要断言的那几项，其余保持定值。 */
function purchaseOrderFixture(overrides: Partial<SlhReconciliationMatchedPurchaseOrderDto> = {}): SlhReconciliationMatchedPurchaseOrderDto {
  return {
    id: 'po-1',
    orderNo: 'CG-202609-01',
    orderStatus: 'CONFIRMED',
    purchaseTotalAmount: '4425',
    depositDueAmount: '1000',
    balanceDueAmount: '3425',
    paidAmount: '1000',
    outstandingAmount: '3425',
    fulfillmentStatus: 'PARTIALLY_SHIPPED',
    paymentStatus: 'PARTIALLY_PAID',
    shippingMarkText: 'J-070924',
    supplier: { source: 'DICTIONARY', value: 'MARK_SUPPLIER', label: 'Mark supplier', tone: null, known: true, effectiveEnabled: true },
    creatorDisplayName: '李四',
    ...overrides,
  }
}

function salesOrderFixture(overrides: Partial<SlhReconciliationMatchedSalesOrderDto> = {}): SlhReconciliationMatchedSalesOrderDto {
  return {
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
    ...overrides,
  }
}

test('销售与采购区块：单号＋三枚状态徽章、关键字段行、金额块（销售在前）', () => {
  const sections = buildSlhReconciliationOrderSections(memberFixture({
    purchaseOrder: purchaseOrderFixture(),
    salesOrder: salesOrderFixture(),
  }), echoKey)

  // 销售区块排在采购之上：这一屏最常看的是客户侧的钱。
  assert.deepEqual(sections.map(section => section.id), ['sales', 'purchase'])
  assert.deepEqual(sections.map(section => section.label), [
    '[slhReconciliation.detail.salesGroup]',
    '[slhReconciliation.detail.purchaseGroup]',
  ])
  const sales = sections[0]
  const purchase = sections[1]
  assert.ok(sales !== undefined && purchase !== undefined)

  // 信息块第一行：单号单独一行（标签沿用页面键，值取订单号）。
  assert.equal(sales.orderNo.id, 'salesOrderNo')
  assert.equal(sales.orderNo.label, '[slhReconciliation.detail.salesOrderNo]')
  assert.equal(sales.orderNo.value, 'XS-202609-01')
  assert.equal(purchase.orderNo.id, 'purchaseOrderNo')
  assert.equal(purchase.orderNo.label, '[slhReconciliation.detail.purchaseOrderNo]')
  assert.equal(purchase.orderNo.value, 'CG-202609-01')
  // 信息块第二行：三个维度各一枚徽章，维度名进无障碍朗读，挨在一起才不会认错哪个是哪个。
  assert.deepEqual(sales.states, [
    {
      dimension: '[slhReconciliation.detail.salesOrderStatus]',
      label: '[salesOrderDrawer.statuses.PENDING_RECONCILIATION]',
      tone: 'warning',
    },
    {
      dimension: '[slhReconciliation.detail.fulfillmentStatus]',
      label: '[salesOrderDrawer.statuses.SEA_TRANSIT]',
      tone: 'info',
    },
    {
      dimension: '[slhReconciliation.detail.paymentStatus]',
      label: '[salesOrderDrawer.statuses.PARTIALLY_PAID]',
      tone: 'warning',
    },
  ])
  assert.deepEqual(purchase.states.map(state => state.tone), ['success', 'warning', 'warning'])

  // 关键字段行：客户信息（姓名 · 电话合并）、完整地址、出单人 / 供应商、采购唛头、采购人。
  assert.deepEqual(sales.fields.map(field => field.id), ['customer', 'customerFullAddress', 'issuer'])
  assert.equal(sales.fields[0]?.label, '[salesOrderDesc.sections.customer]')
  assert.equal(sales.fields[0]?.value, '包装客户 · 0912345678')
  assert.equal(sales.fields[1]?.value, '新北市林口区文化一路 100 号')
  assert.deepEqual(purchase.fields.map(field => field.id), ['supplier', 'shippingMark', 'purchaseCreator'])
  assert.equal(purchase.fields[0]?.value, 'Mark supplier')
  assert.equal(purchase.fields[1]?.value, 'J-070924')
  // 长文本字段带截断标记（客户信息 / 完整地址 / 供应商 / 采购唛头）：单行截断、超长才提示。
  assert.deepEqual(
    [...sales.fields, ...purchase.fields].map(field => [field.id, field.truncate === true]),
    [['customer', true], ['customerFullAddress', true], ['issuer', false], ['supplier', true], ['shippingMark', true], ['purchaseCreator', false]],
  )
  // 出单人与采购人都走人员字段（模板据此改用 QsPersonDisplay）。
  assert.equal(sales.fields[2]?.person, '张三')
  assert.equal(purchase.fields[2]?.person, '李四')

  // 金额块：首项总额、末项余额；金额带币种并收敛到两位小数，原始值与币种一并下发。
  assert.deepEqual(sales.amountFields.map(field => field.id), [
    'salesTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'receivedAmount',
    'outstandingAmount',
  ])
  assert.deepEqual(purchase.amountFields.map(field => field.id), [
    'purchaseTotalAmount',
    'depositDueAmount',
    'balanceDueAmount',
    'paidAmount',
    'outstandingAmount',
  ])
  assert.deepEqual(sales.amountFields[0]?.amount, { value: '129000.5', currency: 'TWD' })
  assert.equal(sales.amountFields[0]?.value, 'TWD 129000.50')
  assert.deepEqual(purchase.amountFields[0]?.amount, { value: '4425', currency: 'CNY' })
  assert.equal(purchase.amountFields[0]?.value, 'CNY 4425.00')
  // 实际已付款/未付款与采购列表「实际付款」列同口径（未作废付款累加、未付＝采购金额 − 已付）。
  assert.equal(purchase.amountFields[3]?.value, 'CNY 1000.00')
  assert.equal(purchase.amountFields[4]?.value, 'CNY 3425.00')
  // 总额行始终带标记；余额行非零时带标记（模板据此放大加粗、染红）。
  assert.deepEqual(sales.amountFields.map(field => field.emphasis), ['total', undefined, undefined, undefined, 'balance'])
  assert.deepEqual(purchase.amountFields.map(field => field.emphasis), ['total', undefined, undefined, undefined, 'balance'])
  for (const section of sections) {
    for (const field of [...section.fields, section.orderNo, ...section.amountFields]) {
      assert.notEqual(field.label.trim(), '', `${section.id}.${field.id} 缺少字段名`)
    }
  }
})

test('对账详情截断文本：只在真的被截断时才给悬停提示', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/slh-reconciliation/overflow-text.vue', import.meta.url), 'utf8')

  // 单行截断 + 按需浮层：:disabled 由实测宽度决定，未截断时 hover 不该弹出同一段文字。
  assert.match(source, /class="block truncate"/u)
  assert.match(source, /:disabled="!truncated"/u)
  assert.match(source, /node\.scrollWidth > node\.clientWidth/u)
  // 文本变化与容器宽度变化都要重算（列宽由外层网格决定）。
  assert.match(source, /watch\(\(\) => props\.text, measure\)/u)
  assert.match(source, /useResizeObserver\(content, measure\)/u)
})

test('销售与采购区块：余额为零时不下发标记，已结清不染红', () => {
  const sections = buildSlhReconciliationOrderSections(memberFixture({
    purchaseOrder: purchaseOrderFixture({ outstandingAmount: '0.00' }),
    salesOrder: salesOrderFixture({ outstandingAmount: '0' }),
  }), echoKey)

  // 0 视为已结清：不下发 balance，模板就不会染红；总额行不受影响。
  assert.deepEqual(sections[0]?.amountFields.map(field => field.emphasis), ['total', undefined, undefined, undefined, undefined])
  assert.deepEqual(sections[1]?.amountFields.map(field => field.emphasis), ['total', undefined, undefined, undefined, undefined])
  assert.equal(sections[0]?.amountFields[4]?.value, 'TWD 0.00')
})

test('销售与采购区块：完整地址去掉开头的国家前缀「中国台湾」', () => {
  const addressOf = (fullAddress: string) => (
    buildSlhReconciliationOrderSections(memberFixture({
      salesOrder: salesOrderFixture({ customerFullAddress: fullAddress }),
    }), echoKey)[0]?.fields[1]?.value
  )

  // 地址快照是「国家+省+市+详情」拼的：国家名在这一页多余，去掉后正文里的同名文字不动。
  assert.equal(addressOf('中国台湾台湾新竹縣啊啊啊啊'), '台湾新竹縣啊啊啊啊')
  assert.equal(addressOf('中國台灣台灣新竹縣啊啊啊啊'), '台灣新竹縣啊啊啊啊')
  assert.equal(addressOf('中国台湾台南市安平區中正一路100号'), '台南市安平區中正一路100号')
  // 其它国家/地区的前缀不碰，正文里出现的「中国台湾」也不碰。
  assert.equal(addressOf('中国北京市北京市测试路1号'), '中国北京市北京市测试路1号')
  assert.equal(addressOf('新竹縣中国台湾路1号'), '新竹縣中国台湾路1号')
})

test('销售与采购区块：客户姓名与电话合并成一行，缺一不出现孤立点号', () => {
  const customerOf = (overrides: Partial<SlhReconciliationMatchedSalesOrderDto> | null) => (
    buildSlhReconciliationOrderSections(memberFixture({
      salesOrder: overrides === null ? null : salesOrderFixture(overrides),
    }), echoKey)[0]?.fields[0]?.value
  )

  assert.equal(customerOf({}), '包装客户 · 0912345678')
  // 只有电话时只显示电话；只有姓名时只显示姓名。
  assert.equal(customerOf({ customerName: '  ' }), '0912345678')
  assert.equal(customerOf({ customerPhone: null as unknown as string }), '包装客户')
  // 两个来源都缺才走占位符。
  assert.equal(customerOf({ customerName: null as unknown as string, customerPhone: null as unknown as string }), '[slhBill.valueMissing]')
  assert.equal(customerOf(null), '[slhBill.valueMissing]')
})

test('销售与采购区块：来源缺失时整块占位符，不猜也不留空', () => {
  const sections = buildSlhReconciliationOrderSections(memberFixture({
    purchaseOrder: null,
    salesOrder: null,
  }), echoKey)

  for (const section of sections) {
    assert.equal(section.orderNo.value, '[slhBill.valueMissing]', `${section.id}.orderNo 应为占位符`)
    assert.deepEqual(section.states, [], `${section.id} 无来源时不应有状态徽章`)
    for (const field of [...section.fields, ...section.amountFields]) {
      assert.equal(field.value, '[slhBill.valueMissing]', `${section.id}.${field.id} 应为占位符`)
      // 缺失的金额不下发原始值、也不放大加粗。
      assert.equal(field.amount, undefined, `${section.id}.${field.id} 不应下发 amount`)
      assert.equal(field.emphasis, undefined, `${section.id}.${field.id} 不应下发 emphasis`)
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
  // 三个值各有装饰用身份色（绿/黄/蓝）与身份图案（购物车/船/纸币）；卡片不再展示来源线索行。
  assert.deepEqual(focus.map(item => item.accent), ['emerald', 'amber', 'blue'])
  assert.deepEqual(focus.map(item => item.motif), [
    'i-lucide:shopping-cart',
    'i-lucide:ship',
    'i-lucide:banknote',
  ])
  assert.equal('trace' in (focus[0] ?? {}), false)
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
  // 身份色与金额无关，不随币种变化。
  assert.deepEqual(focus.map(item => item.accent), ['emerald', 'amber', 'blue'])
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
