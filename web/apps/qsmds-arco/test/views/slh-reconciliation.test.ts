import type {
  SlhBillLineUnmatchedReasonCountDto,
  SlhReconciliationBatchMemberDto,
  SlhReconciliationBillOptionDto,
  SlhReconciliationMatchedPurchaseOrderDto,
  SlhReconciliationMatchedSalesOrderDto,
  SlhReconciliationSettlementRecordDto,
} from '../../src/api/generated/types.gen'
import type { CurrencyDescriptor } from '../../src/components/base/currency'
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
  buildSlhReconciliationCompleteSteps,
  buildSlhReconciliationFocusValues,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationLoadingItemPanel,
  buildSlhReconciliationOrderSections,
  isSlhReconciliationMemberReconciled,
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
  buildSlhReconciliationRecordCard,
  buildSlhReconciliationRecordCards,
  resolveRecordAmountTone,
} from '../../src/views/workbenches/slh-reconciliation/records-modal.logic'
import {
  buildSettleRateCards,
  buildSettleSummary,
  FULL_FLOW_FEE_RATE,
  resolveSettleFailureKey,
} from '../../src/views/workbenches/slh-reconciliation/settle-modal.logic'
import {
  resolveSlhBillLineUnmatchedReasonLabelKey,
  resolveSlhReconciliationBatchLabelKey,
  resolveSlhReconciliationBatchTone,
  resolveSlhReconciliationCompleteBlockLabelKey,
  resolveSlhReconciliationCompleteBlockReason,
  resolveSlhReconciliationSettleBlockLabelKey,
  resolveSlhReconciliationSettleBlockReason,
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

test('完成批次的门禁：还有未核对行或批次已结束都挡下，全部核对完才放行', () => {
  const gate = (overrides: Partial<{ memberCount: number, reconciledMemberCount: number, status: 'COMPLETED' | 'IN_PROGRESS' }> = {}) => (
    resolveSlhReconciliationCompleteBlockReason({
      memberCount: 6,
      reconciledMemberCount: 6,
      status: 'IN_PROGRESS',
      ...overrides,
    })
  )

  assert.equal(gate(), null)
  // 还有一行没核对就挡下（含部分核对）。
  assert.equal(gate({ reconciledMemberCount: 5 }), 'LINES_UNRECONCILED')
  assert.equal(gate({ reconciledMemberCount: 0 }), 'LINES_UNRECONCILED')
  // 批次已结束：无论行核对到什么程度都不再放行。
  assert.equal(gate({ status: 'COMPLETED' }), 'BATCH_COMPLETED')
  // 没有冻结行的批次不挡（没有可核对的行，与既有语义一致）。
  assert.equal(gate({ memberCount: 0, reconciledMemberCount: 0 }), null)
  // 取值到文案键的映射各有一条。
  assert.equal(
    resolveSlhReconciliationCompleteBlockLabelKey('LINES_UNRECONCILED'),
    'slhReconciliation.detail.completeBlockedUnreconciled',
  )
  assert.equal(
    resolveSlhReconciliationCompleteBlockLabelKey('BATCH_COMPLETED'),
    'slhReconciliation.detail.completeBlockedBatchCompleted',
  )
})

test('本行核对的门禁：销售需待对账且已签收已付清，采购需已完成', () => {
  type SalesStates = Pick<SlhReconciliationMatchedSalesOrderDto, 'orderStatus' | 'fulfillmentStatus' | 'paymentStatus'>
  type PurchaseStates = Pick<SlhReconciliationMatchedPurchaseOrderDto, 'orderStatus' | 'fulfillmentStatus' | 'paymentStatus'>
  const salesReady: SalesStates = { orderStatus: 'PENDING_RECONCILIATION', fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' }
  const purchaseReady: PurchaseStates = { orderStatus: 'COMPLETED', fulfillmentStatus: 'SIGNED', paymentStatus: 'PAID' }
  const gate = (sales: SalesStates | null = salesReady, purchase: PurchaseStates | null = purchaseReady) => (
    resolveSlhReconciliationSettleBlockReason({ purchaseOrder: purchase, salesOrder: sales })
  )

  assert.equal(gate(), null)
  // 销售侧三个条件必须同时成立：待对账不蕴含已付清——待对账状态下仍可作废收款，
  // 付款状态会回落而订单状态不动，所以付款必须单独查。
  assert.equal(gate({ ...salesReady, orderStatus: 'CONFIRMED' }), 'SALES_ORDER_NOT_READY')
  assert.equal(gate({ ...salesReady, orderStatus: 'COMPLETED' }), 'SALES_ORDER_NOT_READY')
  assert.equal(gate({ ...salesReady, fulfillmentStatus: 'SEA_TRANSIT' }), 'SALES_ORDER_NOT_READY')
  assert.equal(gate({ ...salesReady, paymentStatus: 'PARTIALLY_PAID' }), 'SALES_ORDER_NOT_READY')
  assert.equal(gate({ ...salesReady, paymentStatus: 'UNPAID' }), 'SALES_ORDER_NOT_READY')
  // 订单来源缺失（脏数据）与条件不满足同路，一律不放行。
  assert.equal(gate(null), 'SALES_ORDER_NOT_READY')
  // 采购侧只看订单状态：COMPLETED 是服务端由事实派生的状态，
  // 数据库还有 completed_requires_signed_paid 约束兜底其余两维。
  assert.equal(gate(salesReady, { ...purchaseReady, orderStatus: 'CONFIRMED' }), 'PURCHASE_ORDER_NOT_READY')
  assert.equal(gate(salesReady, { ...purchaseReady, orderStatus: 'PENDING_REVIEW' }), 'PURCHASE_ORDER_NOT_READY')
  assert.equal(gate(salesReady, { ...purchaseReady, orderStatus: 'CANCELLED' }), 'PURCHASE_ORDER_NOT_READY')
  assert.equal(gate(salesReady, null), 'PURCHASE_ORDER_NOT_READY')
  // 两侧都不满足时先报销售（与页面销售在前的排布一致）。
  assert.equal(
    gate({ ...salesReady, orderStatus: 'DRAFT' }, { ...purchaseReady, orderStatus: 'CONFIRMED' }),
    'SALES_ORDER_NOT_READY',
  )
  // 取值到文案键的映射各有一条，且三语齐全。
  assert.equal(
    resolveSlhReconciliationSettleBlockLabelKey('SALES_ORDER_NOT_READY'),
    'slhReconciliation.detail.settleBlockedSalesOrder',
  )
  assert.equal(
    resolveSlhReconciliationSettleBlockLabelKey('PURCHASE_ORDER_NOT_READY'),
    'slhReconciliation.detail.settleBlockedPurchaseOrder',
  )
  for (const message of MESSAGES) {
    assertTranslated(message.slhReconciliation.detail as unknown as Record<string, unknown>, ['settleBlockedSalesOrder', 'settleBlockedPurchaseOrder'])
  }
  assert.equal(zhCn.slhReconciliation.detail.settleBlockedSalesOrder, '销售订单未满足核对条件：需为待对账、已签收且已付清')
  assert.equal(zhCn.slhReconciliation.detail.settleBlockedPurchaseOrder, '采购订单未满足核对条件：需为已完成（已入仓且已付清）')
})

test('完成批次的多步步骤：三步只给最后一步挂真实请求，文案按账户→规则→入账排序', () => {
  const run = async (): Promise<void> => {}
  const steps = buildSlhReconciliationCompleteSteps(echoKey, run)

  // 三步是这次单请求的叙事：服务端在同一个事务里完成账户、规则与逐笔入账，前端观察不到边界。
  assert.equal(steps.length, 3)
  assert.deepEqual(steps.map(step => step.text), [
    '[slhReconciliation.detail.completeSteps.accounts]',
    '[slhReconciliation.detail.completeSteps.rules]',
    '[slhReconciliation.detail.completeSteps.posting]',
  ])
  // 只有「执行资金入账」那一步携带真实请求：挂在前面会让后续步骤与事实不符。
  assert.deepEqual(steps.map(step => step.action === undefined), [true, true, false])
  assert.equal(steps[2]?.action, run)
  // 文案键是动态拼的，类型检查管不到；三语都要有且非空。
  for (const locale of [zhCn, zhTw, en]) {
    assertTranslated(locale.slhReconciliation.detail.completeSteps as unknown as Record<string, unknown>, ['accounts', 'rules', 'posting'])
  }
  assert.equal(zhCn.slhReconciliation.detail.completeSteps.posting, '执行资金入账')
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

test('切换器带三档计数：当前档用列表 total，另两档各发一次 pageSize=1 的列表请求', async () => {
  const source = await readPageSource('index.vue')
  // 计数写进切换器项：同一套 withStatusSwitchCounts，选中项用 total 校准，避免两个请求打架。
  assert.match(source, /withStatusSwitchCounts\(/u)
  assert.match(source, /\{ selectedCount: loading\.value \? undefined : total\.value, selectedValue: status\.value \}/u)
  // 另外两档各一次小请求，关键词跟着筛选走；失败静默、不打扰列表。
  assert.match(source, /const others = SLH_RECONCILIATION_BATCH_FILTERS\.filter\(value => value !== status\.value\)/u)
  assert.match(source, /buildSlhReconciliationBatchListQuery\(\{ page: 1, pageSize: 1, keyword: keyword\.value, status: value \}\)/u)
  assert.match(source, /counts\.value = \{ \.\.\.counts\.value, \[value\]: response\.data\.total \}/u)
  assert.match(source, /counts\.value = \{\}/u)
  // 计数有自己的控制器：切换与卸载都要收掉在途请求。
  assert.match(source, /countsController\?\.abort\(\)/u)
  assert.match(source, /onBeforeUnmount\(\(\) => \{[\s\S]{0,120}?countsController\?\.abort\(\)/u)
  // 列表、计数与重试都走同一条 refresh：换筛选或关键词后两处一起更新。
  assert.match(source, /function refresh\(\): void \{\n\s+void load\(\)\n\s+void loadCounts\(\)/u)
  assert.match(source, /@retry="refresh"/u)
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

test('已核对明细的两个提示：切换过去弹轻提示，点「本行核对正确」先二次确认', async () => {
  const page = await readPageSource('detail.vue')

  // 判据只有一处：账单明细行的三态（批次成员与账单行同步标记）。
  const reconciled = memberFixture({ reconciliationStatus: 'RECONCILED' })
  assert.equal(isSlhReconciliationMemberReconciled(reconciled), true)
  assert.equal(isSlhReconciliationMemberReconciled(memberFixture({ reconciliationStatus: 'PENDING' })), false)

  // 切换器换行：切到已核对的行给一句轻提示；打开页面时的自动选中不走这条路径。
  assert.match(page, /function selectLine\(lineId: string \| null\): void \{/u)
  assert.match(page, /toast\.info\(t\('slhReconciliation\.detail\.reconciledNotice'\)\)/u)
  assert.match(page, /const member = resolveSlhReconciliationSelectedMember\(members\.value, lineId\)/u)

  // 点「本行核对正确」：先过订单状态门禁，未通过只给一句轻提示；通过后已核对的行再开确认弹窗。
  assert.match(page, /const blockReason = resolveSlhReconciliationSettleBlockReason\(member\)\n {2}if \(blockReason !== null\) \{\n {4}toast\.info\(t\(resolveSlhReconciliationSettleBlockLabelKey\(blockReason\)\)\)\n {4}return\n {2}\}/u)
  assert.match(page, /function requestSettle\(\): void \{[\s\S]{0,500}?recheckOpen\.value = true/u)
  assert.match(page, /async function confirmRecheck\(\): Promise<void> \{\n {2}recheckOpen\.value = false\n {2}await openSettleModal\(\)/u)
  assert.match(page, /v-model="recheckOpen"[\s\S]{0,160}?t\('slhReconciliation\.detail\.recheckTitle'\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.recheckHint'\)/u)
  assert.match(page, /@click="confirmRecheck"/u)
})

test('批次详情页：头部只给批次与账单标识、底部承接完成批次', async () => {
  const page = await readPageSource('detail.vue')
  assert.match(page, /t\('workbench\.slhBillReconciliationDetail'\)/u)
  assert.match(page, /t\('slhReconciliation\.backToList'\)/u)
  assert.match(page, /router\.push\(\{ name: 'qsFinanceBillReconciliationSlhBillReconciliation' \}\)/u)
  // 完成按钮搬到页头「返回对账批次」右边，两枚按钮同一个 flex 容器留出间隙。
  const header = page.slice(page.indexOf('<FaPageHeader'), page.indexOf('</FaPageHeader>'))
  assert.match(header, /t\('slhReconciliation\.backToList'\)/u)
  assert.match(header, /t\('slhReconciliation\.detail\.completeButton'\)/u)
  // 类名顺序会被 unocss/order 重排：只断言「竖排 + 间隙 + 宽屏横排」三件事都在。
  assert.match(header, /flex flex-col gap-2 w-full/u)
  assert.match(header, /sm:flex-row/u)
  assert.match(page, /slhReconciliationBatchesApi\.complete\(/u)
  // 底栏只留两个逐行核对动作：带色按钮，点击先只给轻提示（接口随本分支重构删除）。
  const bar = page.slice(page.indexOf('<FaFixedBar'), page.indexOf('</FaFixedBar>'))
  assert.match(bar, /variant="destructive"/u)
  assert.match(bar, /t\('slhReconciliation\.detail\.reconcileWrong'\)/u)
  assert.match(bar, /t\('slhReconciliation\.detail\.reconcileCorrect'\)/u)
  assert.match(bar, /showReconcilePending\('slhReconciliation\.detail\.reconcileWrong'\)/u)
  // 核对正确打开两步的「对账信息」弹窗（核对有误仍是占位提示）。
  assert.match(bar, /:disabled="selectedMember === null"[\s\S]{0,120}?@click="requestSettle"/u)
  assert.match(page, /<SlhReconciliationSettleModal/u)
  // 账单内置汇率取账单详情里嵌套的 rate 对象。
  assert.match(page, /slhBillsApi\.get\(billId/u)
  assert.match(page, /response\.data\.rate\?\.embeddedForeignUnitsPerCny \?\? null/u)
  // 两个动作共用一个轻提示函数：文案模板带动作名参数。
  assert.match(page, /t\('slhReconciliation\.detail\.reconcilePending', \{ action: t\(labelKey\) \}\)/u)
  assert.doesNotMatch(bar, /completeButton/u)
  // 完成失败改成轻提示，并且停得比默认更久；页面上不再有常驻错误条。
  assert.match(page, /toast\.error\(containerFailure\(failure\)\.message, \{ duration: ACTION_ERROR_TOAST_DURATION \}\)/u)
  assert.match(page, /const ACTION_ERROR_TOAST_DURATION = 8_000/u)
  // 常驻错误条退场（读取失败那条 FaAlert 仍留在页面主体上）。
  assert.doesNotMatch(page, /actionError/u)
  // 完成按钮：门禁未过时软禁用（可点但看起来不可用），点了说明原因；批次没读到时才是真禁用。
  assert.match(page, /:disabled="batch === null \|\| completeLoading"/u)
  assert.match(page, /:aria-disabled="!canComplete \|\| completeLoading"/u)
  assert.match(page, /@click="requestComplete"/u)
  assert.match(page, /resolveSlhReconciliationCompleteBlockLabelKey\(completeBlockReason\.value\)/u)
  assert.match(page, /completeOpen\.value = true/u)
  assert.doesNotMatch(page, /:disabled="!canComplete/u)
  // 确认后的编排：确认即同步关弹窗，再开多步加载器；请求挂在最后一步。
  assert.match(page, /function confirmComplete\(\): void \{[\s\S]{0,400}?completeOpen\.value = false\n\s+completeLoading\.value = true/u)
  assert.match(page, /await slhReconciliationBatchesApi\.complete\(batchId\.value, current\.signal\)/u)
  assert.match(page, /const completeSteps = computed\(\(\) => buildSlhReconciliationCompleteSteps\(translate, runCompletion\)\)/u)
  assert.match(page, /:loading="completeLoading"/u)
  assert.match(page, /:steps="completeSteps"/u)
  assert.match(page, /@complete="completeFinished"/u)
  assert.match(page, /@error="completeFailed"/u)
  // 一次性写入不能被用户中途藏起来：沿用仓内既有口径的 prevent-close。
  assert.match(page, /<FaMultiStepLoader[\s\S]{0,240}?prevent-close/u)
  // 成功才刷新并提示；失败立刻收尾（组件最短 2 秒不适用于失败路径）。
  assert.match(page, /function completeFinished\(\): void \{[\s\S]{0,240}?toast\.success\(t\('slhReconciliation\.detail\.completedToast'\)\)[\s\S]{0,120}?void load\(\)/u)
  assert.match(page, /function completeFailed\(failure: unknown\): void \{[\s\S]{0,200}?completeLoading\.value = false/u)
  // 确认弹窗不再接 submitting：关闭发生在请求之前，不存在提交期间关闭的窗口。
  const completeModal = page.slice(page.indexOf('completeOpen'), page.indexOf('@click="confirmComplete"'))
  assert.doesNotMatch(completeModal, /:submitting=/u)
  assert.doesNotMatch(page, /completing/u)
  // 两个逐行按钮的文案带上「本行」，与批次级动作区分开。
  assert.equal(zhCn.slhReconciliation.detail.reconcileWrong, '本行核对有误')
  assert.equal(zhCn.slhReconciliation.detail.reconcileCorrect, '本行核对正确')
  // 头部辅助文字：批次状态标签 + 批次编号 + 账单编号 + 对账单名称。
  assert.match(page, /resolveSlhReconciliationBatchTone\(batch\.status\)/u)
  assert.match(page, /\{\{ batch\.batchNo \}\}/u)
  assert.match(page, /\{\{ batch\.bill\.slhBillNo \}\}/u)
  assert.match(page, /\{\{ batch\.bill\.billName \}\}/u)
  assert.match(page, /slhReconciliationBatchesApi\.get\(/u)
  // 完成与否由服务端数据派生（替代本地 ref），读取失败时禁用。
  // 能否完成由门禁派生：批次已结束或还有未核对行时不可完成。
  assert.match(page, /const canComplete = computed\(\(\) => batch\.value !== null && completeBlockReason\.value === null\)/u)
  assert.match(page, /t\('slhBill\.retry'\)/u)
})

test('详情页成员区：切换器独立成面板，核对焦点在下、三块分组面板在上', async () => {
  const page = await readPageSource('detail.vue')
  // 切换器受控接线：选中值由页面持有，状态色映射与无障碍名称都由页面给。
  assert.match(page, /<QsReconciliationLineSwitcher[\s\S]{0,400}?@update:model-value="selectLine"/u)
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
  // 三块面板：横向排布（宽屏三列）且等高——网格用默认的拉伸对齐，卡片随行拉齐到最高者。
  assert.match(page, /class="m-4 gap-4 grid lg:grid-cols-2 xl:grid-cols-3"/u)
  assert.doesNotMatch(page, /items-start/u)
  // 装柜面板与另两块同款：信息块 + 竖条标题段 + 边框金额块。
  assert.match(page, /v-if="loadingItemPanel"/u)
  assert.match(page, /v-for="tag in loadingItemPanel\.tags"/u)
  assert.match(page, /\{\{ loadingItemPanel\.receiptReference\.value \}\}/u)
  assert.match(page, /\{\{ loadingItemPanel\.cargo\.label \}\}/u)
  assert.match(page, /\{\{ loadingItemPanel\.fee\.label \}\}/u)
  assert.match(page, /\{\{ loadingItemPanel\.fee\.amount\.label \}\}/u)
  assert.match(page, /v-for="line in field\.lines"/u)
  assert.doesNotMatch(page, /fieldColumns|column\.groups/u)
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
  // 多行值（收货信息）保留分支；备注已改为正文文本，不再有浅色标签分支。
  assert.match(page, /v-if="field\.lines && field\.lines\.length > 0"/u)
  assert.doesNotMatch(page, /field\.chip/u)
  // 金额统一走 AmountDisplay（缺失时回落占位符文本）；等宽数据字体用于所有非金额值。
  assert.match(page, /v-if="field\.amount"[\s\S]{0,300}?:currencies="currencyCatalog\.currencies\.value"/u)
  assert.match(page, /class="m-0 text-right"/u)
  // 非金额值保持等宽数据字体，两条分支都带样式类。
  assert.match(page, /<span v-else class="qs-type-data">/u)
  // 三块的标题都来自各自面板模型（销售/采购区块、装柜面板、账单面板）。
  assert.match(page, /t\('slhReconciliation\.detail\.loadingItemTitle'\)/u)
  assert.match(page, /t\('slhReconciliation\.detail\.billLineTitle'\)/u)
  // 不再有成员标题与复制入口。
  assert.doesNotMatch(page, /membersTitle|membersCopy|copyMembers|clipboard\.writeText/u)
  // 批次没有冻结行时只给一句批次级说明，不让切换器空转。
  assert.match(page, /v-if="members\.length > 0"/u)
  assert.match(page, /t\('slhReconciliation\.detail\.membersEmpty'\)/u)
  assert.doesNotMatch(page, /v-for="member in members"/u)
})

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

/** 译函数只回显键与参数，断言的是拼接规则本身（译文与标点归语言包）。 */
function settleTranslate(key: string, params?: Record<string, string>): string {
  const values = Object.values(params ?? {})
  return values.length === 0 ? `[${key}]` : `[${key}:${values.join(':')}]`
}

/** 裸数字卡片要的是「符号与代码都去掉、精度与千分位仍走公共规则」。 */
const SETTLE_CURRENCIES = [
  { code: 'CNY', enabled: true, minorUnit: 2, name: '人民币', symbol: '¥' },
  { code: 'TWD', enabled: true, minorUnit: 2, name: '新台币', symbol: 'NT$' },
  { code: 'MYR', enabled: true, minorUnit: 2, name: '马来西亚林吉特', symbol: 'RM' },
] as const satisfies readonly CurrencyDescriptor[]

test('核对焦点块：三处只在这三块开流光边框，参数统一且错峰', async () => {
  const member = memberFixture()
  // 销售段的金额块开流光，采购段不开（同一段模板渲染两个区块，必须靠模型区分）。
  const sections = buildSlhReconciliationOrderSections(member, echoKey)
  assert.deepEqual(sections.map(section => [section.id, section.beam ?? false]), [
    ['sales', true],
    ['purchase', false],
  ])
  // 装柜「费用详情」段恒定开（值缺失也亮）。
  assert.equal(buildSlhReconciliationLoadingItemPanel(member, echoKey).fee.beam, true)
  // 账单费用段只给台币块开；块现在带稳定 id。
  const feeSection = buildSlhReconciliationBillLinePanel(member, echoKey).sections.find(section => section.id === 'fees')
  assert.deepEqual(feeSection?.blocks.map(block => [block.id, block.beam ?? false]), [
    ['cny', false],
    ['twd', true],
  ])

  // 三处模板：相对定位 + 裁剪 + 主题色单色渐变 + 2px + 8s + 错峰 + 动效偏好与无障碍。
  const page = await readPageSource('detail.vue')
  assert.equal(page.match(/<FaBorderBeam/gu)?.length, 3)
  assert.equal(page.match(/oklch\(var\(--primary\)\)/gu)?.length, 3)
  assert.equal(page.match(/:duration="5000"/gu)?.length, 3)
  assert.equal(page.match(/:border-width="2"/gu)?.length, 3)
  assert.deepEqual([...page.matchAll(/:delay="(\d+)"/gu)].map(match => match[1]), ['1000', '2000'])
  // 组件的 animation 简写会把 animation-delay 重置为 0，错峰靠 important 工具类兜住。
  assert.deepEqual([...page.matchAll(/after:!\[animation-delay:(\d+)ms\]/gu)].map(match => match[1]), ['1000', '2000'])
  assert.equal(page.match(/relative overflow-hidden/gu)?.length, 3)
  assert.equal(page.match(/motion-reduce:hidden/gu)?.length, 3)
  // 逐块检查：每个光带都带 aria-hidden（懒量词跨块匹配会吞掉下一块，因此按块切开看）。
  const beamSnippets = page.split('<FaBorderBeam').slice(1)
  assert.equal(beamSnippets.filter(snippet => snippet.slice(0, 600).includes('aria-hidden="true"')).length, 3)
})

test('对账信息弹窗：结算金额与金流费按所选汇率计算，横排算式给出运算符与代入值', () => {
  const member = memberFixture({
    salesOrder: salesOrderFixture({ currencyCode: 'TWD', agreedTotalAmount: '500.0000' }),
    codAmountTwd: '129000.00',
    ntdSurchargeAmountTwd: '6000.00',
    payableAmountCny: '4555.00',
  })
  const summary = buildSettleSummary(member, '5.2', SETTLE_CURRENCIES, settleTranslate)

  assert.equal(summary.rate, '5.2')
  assert.equal(summary.rateBaseText, '[slhReconciliation.settle.baseRateText:5.2]')
  const [settlement, paymentFee] = summary.blocks

  // 账单块分两组：前两项落在虚线分组里，运算符徽标挂在项上（首项没有）。
  assert.deepEqual(
    settlement?.groups.map(group => [group.id, group.dashed, group.terms.map(term => [term.id, term.operator])]),
    [
      ['parenthesized', true, [['codAmount', null], ['ntdDeduction', '−']]],
      ['operands', false, [['rate', '÷'], ['payableTotal', '−']]],
    ],
  )
  // 卡片值是裸数字（去掉货币符号与代码，保留千分位与币种精度），单位写在标签里。
  assert.deepEqual(
    settlement?.groups[0]?.terms.map(term => [term.label, term.unit, term.value, term.currencyCode, term.accent]),
    [
      ['[slhReconciliation.settle.codAmount]', 'TWD', '129,000.00', 'TWD', false],
      ['[slhReconciliation.settle.ntdDeduction]', 'TWD', '6,000.00', 'TWD', false],
    ],
  )
  // 汇率用琥珀黄强调（用户 2026-10-11 口径），金额项不着色。
  assert.deepEqual(
    settlement?.groups[1]?.terms.map(term => [term.label, term.unit, term.value, term.accent]),
    [
      ['[slhReconciliation.settle.rateRow]', null, '5.2', true],
      ['[slhReconciliation.settle.payableTotal]', 'CNY', '4,555.00', false],
    ],
  )
  assert.equal(settlement?.noteKey, null)
  // 右上角抽象公式由 logic 出，别把占位符漏给模板。
  assert.equal(settlement?.formula, '[slhReconciliation.settle.settlementFormula]')
  // 宽度档位：汇率与合计应付固定宽度，其余可变项平均吃剩余宽度（模板侧再设上限）。
  assert.deepEqual(
    settlement?.groups.map(group => group.terms.map(term => term.width)),
    [['flex', 'flex'], ['rate', 'payable']],
  )
  assert.deepEqual(
    paymentFee?.groups.map(group => group.terms.map(term => term.width)),
    [['flex', 'rate', 'rate']],
  )

  // （129000 − 6000）÷ 5.2 − 4555 = 19098.8461… → 19098.85（人民币两位小数 HALF_UP），正数走绿色。
  assert.equal(settlement?.result, '19,098.85')
  assert.equal(settlement?.resultCurrencyCode, 'CNY')
  assert.equal(settlement?.resultTone, 'success')

  // 金流费：500 ÷ 5.2 × 0.7% = 0.6730… → 0.67；口径是恒红（成本项），不按符号。
  assert.deepEqual(
    paymentFee?.groups.map(group => group.terms.map(term => [term.id, term.operator, term.value, term.accent])),
    [[
      ['salesAmount', null, '500.00', false],
      ['rate', '÷', '5.2', true],
      ['feeRate', '×', '[slhReconciliation.settle.paymentFeeRateValue:0.7]', true],
    ]],
  )
  assert.equal(paymentFee?.groups[0]?.dashed, false)
  assert.equal(paymentFee?.formula, '[slhReconciliation.settle.paymentFeeFormula]')
  assert.equal(paymentFee?.result, '0.67')
  assert.equal(paymentFee?.resultTone, 'danger')
  assert.equal(FULL_FLOW_FEE_RATE, 0.007)

  // 换汇率：两块结果都跟着走。
  // （129000 − 6000）÷ 4.8 − 4555 = 21070.00；500 ÷ 4.8 × 0.007 = 0.73。
  const embedded = buildSettleSummary(member, '4.8', SETTLE_CURRENCIES, settleTranslate)
  assert.equal(embedded.blocks[0]?.result, '21,070.00')
  assert.equal(embedded.blocks[1]?.result, '0.73')

  // 汇率取不到：汇率项与结果都留占位符，且不触发「按 0 代入」。
  const noRate = buildSettleSummary(member, null, SETTLE_CURRENCIES, settleTranslate)
  assert.equal(noRate.rateBaseText, '[slhReconciliation.settle.baseRateText:—]')
  assert.equal(noRate.blocks[0]?.groups[1]?.terms[0]?.value, '—')
  assert.equal(noRate.blocks[0]?.result, '—')
  assert.equal(noRate.blocks[0]?.resultTone, 'neutral')
  assert.equal(noRate.blocks[0]?.noteKey, null)
  assert.equal(noRate.blocks[1]?.result, '—')
  assert.equal(noRate.blocks[1]?.resultTone, 'neutral')
})

test('对账信息弹窗：本行不涉及的金额按 0 代入结算，整行都无输入时仍留空', () => {
  // 截图行 J-121125 的形状：不涉及代收货款、有 2000 台币杂费、应付 0 → （0 − 2000）÷ 5.2 = −384.62。
  const missingCod = buildSettleSummary(memberFixture({
    salesOrder: salesOrderFixture(),
    codAmountTwd: null,
    ntdSurchargeAmountTwd: '2000.00',
    payableAmountCny: '0.00',
  }), '5.2', SETTLE_CURRENCIES, settleTranslate)
  // 卡片里代入的是实际参与计算的 0，而不是「本行不涉及」的占位符，读的人才能验算。
  assert.equal(missingCod.blocks[0]?.groups[0]?.terms[0]?.value, '0.00')
  assert.equal(missingCod.blocks[0]?.result, '-384.62')
  // 负数是「无代收但有杂费」这类行的真实结算方向 ⇒ 红色。
  assert.equal(missingCod.blocks[0]?.resultTone, 'danger')
  assert.equal(missingCod.blocks[0]?.noteKey, 'slhReconciliation.settle.missingAmountAsZero')
  // 金流费用恒带一句「按销售单计一次」：费用是对整单销售金额收的，同一销售单的其他行不重复计入。
  assert.equal(missingCod.blocks[1]?.noteKey, 'slhReconciliation.settle.paymentFeeOncePerSalesOrder')
  for (const locale of [zhCn, zhTw, en] as const) {
    const noteKey = locale.slhReconciliation.settle.paymentFeeOncePerSalesOrder
    assert.equal(typeof noteKey, 'string')
    assert.notEqual(noteKey.trim(), '')
  }

  // L-010233 的形状：有代收、不涉及台币杂费 → （80000 − 0）÷ 5.2 − 3510 = 11874.62。
  const missingNtd = buildSettleSummary(memberFixture({
    salesOrder: salesOrderFixture(),
    codAmountTwd: '80000.00',
    ntdSurchargeAmountTwd: null,
    payableAmountCny: '3510.00',
  }), '5.2', SETTLE_CURRENCIES, settleTranslate)
  assert.equal(missingNtd.blocks[0]?.result, '11,874.62')
  assert.equal(missingNtd.blocks[0]?.resultTone, 'success')

  // 三个金额都不涉及：不给「伪 0」结果，卡片与结果都留空占位、也不出说明行。
  const allMissing = buildSettleSummary(memberFixture({
    salesOrder: salesOrderFixture(),
    codAmountTwd: null,
    ntdSurchargeAmountTwd: null,
    payableAmountCny: null,
  }), '5.2', SETTLE_CURRENCIES, settleTranslate)
  assert.equal(allMissing.blocks[0]?.groups[0]?.terms[0]?.value, '—')
  assert.equal(allMissing.blocks[0]?.result, '—')
  assert.equal(allMissing.blocks[0]?.noteKey, null)
})

test('对账信息弹窗：提交载荷是原始值（本行不涉及为 null），失败按错误码给文案', () => {
  const member = memberFixture({
    salesOrder: salesOrderFixture({ currencyCode: 'TWD', agreedTotalAmount: '10.0000' }),
    // 本行不涉及代收货款：提交 null，而不是展示用的 0.00。
    codAmountTwd: null,
    ntdSurchargeAmountTwd: '2000.00',
    payableAmountCny: '0.00',
  })
  const summary = buildSettleSummary(member, '5.2', SETTLE_CURRENCIES, settleTranslate)

  assert.deepEqual(summary.payload, {
    codAmountTwd: null,
    ntdSurchargeAmountTwd: '2000.00',
    payableAmountCny: '0.00',
    // （0 − 2000）÷ 5.2 − 0 = −384.62；10 ÷ 5.2 × 0.7% = 0.01。
    settlementAmountCny: '-384.62',
    salesAmount: '10.0000',
    paymentFeeAmountCny: '0.01',
  })

  // 服务端拒绝的原因必须能直接讲清楚；结构不对或未登记的码回落通用提示。
  assert.equal(resolveSettleFailureKey({ body: { code: 'SLH_RECON_SETTLEMENT_UNCHANGED' } }), 'slhReconciliation.settle.errorUnchanged')
  assert.equal(resolveSettleFailureKey({ body: { code: 'SLH_RECON_SETTLEMENT_MISMATCH' } }), 'slhReconciliation.settle.errorMismatch')
  assert.equal(resolveSettleFailureKey({ body: { code: 'SLH_RECON_BATCH_NOT_IN_PROGRESS' } }), 'slhReconciliation.settle.errorBatchCompleted')
  assert.equal(resolveSettleFailureKey({ body: { code: 'SLH_RECON_SOMETHING_NEW' } }), 'slhReconciliation.settle.errorUnknown')
  assert.equal(resolveSettleFailureKey(new Error('boom')), 'slhReconciliation.settle.errorUnknown')
  assert.equal(resolveSettleFailureKey(undefined), 'slhReconciliation.settle.errorUnknown')
})

test('金流费率在两个依赖域里保持一致：后端常量与前端展示口径必须相等', async () => {
  const serverLogic = await readFile(new URL('../../../../../server/src/modules/slh-reconciliation-batches/slh-reconciliation-settlement.logic.ts', import.meta.url), 'utf8')
  const match = serverLogic.match(/export const PAYMENT_FEE_RATE = '([\d.]+)'/u)

  assert.notEqual(match, null)
  assert.equal(Number(match?.[1]), FULL_FLOW_FEE_RATE)
})

test('核对记录弹窗：卡片按「状态 / 汇率费率 / 六个金额 / 来源」摊平，金额按符号与恒红着色', () => {
  const record: SlhReconciliationSettlementRecordDto = {
    id: 'settlement-1',
    status: 'ACTIVE',
    rateSource: 'EMBEDDED',
    foreignUnitsPerCny: '4.800000000000',
    paymentFeeRate: '0.007000000000',
    codAmountTwd: null,
    codAmountCurrency: 'TWD',
    ntdSurchargeAmountTwd: '2000.00',
    ntdSurchargeCurrency: 'TWD',
    payableAmountCny: '0.00',
    payableCurrency: 'CNY',
    settlementAmountCny: '-384.62',
    settlementCurrency: 'CNY',
    salesAmount: '500.0000',
    salesCurrency: 'TWD',
    paymentFeeAmountCny: '0.73',
    paymentFeeCurrency: 'CNY',
    slhBillNo: 'CBILL/202609-01',
    salesOrderNo: 'SO-1',
    purchaseOrderNo: 'PO-1',
    containerBatchNo: '1211-01柜',
    shipmentNo: null,
    warehouseReceiptReference: 'WG-0078-0072',
    shippingMarkText: 'J-121125',
    createdByDisplayName: '张三',
    createdAt: '2026-10-11T07:05:24.555Z',
  }
  const card = buildSlhReconciliationRecordCard(record, SETTLE_CURRENCIES)

  assert.equal(card.statusKey, 'slhReconciliation.records.statusActive')
  assert.equal(card.summaryRateSourceKey, 'slhReconciliation.records.rateSourceEmbeddedShort')
  assert.equal(card.createdByDisplayName, '张三')
  // 有效记录默认展开；汇率与费率按去尾零 / 百分比展示，摘要里也带汇率来源。
  assert.equal(card.collapsedByDefault, false)
  assert.equal(card.summaryAmountLabelKey, 'slhReconciliation.records.amountAtThatTime')
  assert.deepEqual(card.summaryAmount, { value: '-384.62', currencyCode: 'CNY', tone: 'settlement' })
  assert.equal(card.summaryRateText, '4.8')
  assert.equal(card.summaryFeeRateText, '0.7%')

  // 两个大区块：结算金额与金流费用，各自带区块内的汇率/费率辅助文字。
  assert.deepEqual(
    card.blocks.map(block => [block.id, block.labelKey, block.amount.value, block.amount.currencyCode, block.rateLabelKey, block.rateText]),
    [
      ['settlement', 'slhReconciliation.settle.settlementResult', '-384.62', 'CNY', 'slhReconciliation.settle.rateRow', '4.8'],
      ['paymentFee', 'slhReconciliation.settle.paymentFeeResult', '0.73', 'CNY', 'slhReconciliation.settle.paymentFeeRate', '0.7%'],
    ],
  )
  // 公式区域的两条计算式：代入后的数值；本行不涉及的代收保留占位符，不按 0 改写历史。
  assert.equal(card.formulas.settlement, '（— − NT$2,000.00 TWD）÷ 4.8 − ¥0.00 CNY = -¥384.62 CNY')
  // 销售额按币种精度收敛到两位小数（与 AmountDisplay 同一处规则）。
  assert.equal(card.formulas.paymentFee, 'NT$500.00 TWD ÷ 4.8 × 0.7% = ¥0.73 CNY')

  // 三段来源信息：订单 / 运输 / 账单，组内缺值一律占位符。
  assert.deepEqual(
    card.groups.map(group => [group.id, group.titleKey, group.icon, group.rows.map(row => `${row.label}:${row.value}`)]),
    [
      ['orders', 'slhReconciliation.records.ordersTitle', 'i-lucide:file-text', ['销:SO-1', '采:PO-1']],
      ['transport', 'slhReconciliation.records.transportTitle', 'i-lucide:arrow-left-right', ['柜号:1211-01柜', '货件:—']],
      ['bill', 'slhReconciliation.records.billTitle', 'i-lucide:package', ['账单:CBILL/202609-01', '入仓/唛头:WG-0078-0072 / J-121125']],
    ],
  )

  // 结算金额按符号、金流费用恒红、其余沿用默认前景色。
  assert.equal(resolveRecordAmountTone(card.blocks[0]!.amount), 'danger')
  assert.equal(resolveRecordAmountTone(card.blocks[1]!.amount), 'danger')
  assert.equal(resolveRecordAmountTone({ ...card.blocks[0]!.amount, value: '11874.62' }), 'success')
  assert.equal(resolveRecordAmountTone({ ...card.blocks[0]!.amount, value: '0.00' }), 'neutral')
  assert.equal(resolveRecordAmountTone({ ...card.blocks[0]!.amount, value: null }), 'neutral')

  // 列表保持服务端顺序（最新在前）：被取代的记录默认折起、配色转为中性，头部底条随之变化。
  const superseded = buildSlhReconciliationRecordCards([record, { ...record, id: 'settlement-2', status: 'SUPERSEDED' }], SETTLE_CURRENCIES)
  assert.deepEqual(superseded.map(item => [item.id, item.statusKey, item.statusClass.includes('emerald'), item.collapsedByDefault]), [
    ['settlement-1', 'slhReconciliation.records.statusActive', true, false],
    ['settlement-2', 'slhReconciliation.records.statusSuperseded', false, true],
  ])
  assert.equal(superseded[0]!.headerClass.includes('emerald'), true)
  assert.equal(superseded[1]!.headerClass.includes('emerald'), false)
})

test('核对记录弹窗：底栏只读入口与弹窗接线，卡片只走 AmountDisplay 不写死展示逻辑', async () => {
  const page = await readFile(new URL('../../src/views/workbenches/slh-reconciliation/detail.vue', import.meta.url), 'utf8')
  const modal = await readFile(new URL('../../src/views/workbenches/slh-reconciliation/records-modal.vue', import.meta.url), 'utf8')

  // 底栏第三个按钮：只读、无选中行时禁用、点击打开记录弹窗；弹窗挂在页面上。
  assert.match(page, /t\('slhReconciliation\.detail\.viewRecords'\)/u)
  assert.match(page, /variant="outline"[\s\S]{0,200}?:disabled="selectedMember === null"[\s\S]{0,120}?@click="openRecordsModal"/u)
  assert.match(page, /<SlhReconciliationRecordsModal[\s\S]{0,200}?:batch-id="batchId"[\s\S]{0,120}?:member="selectedMember"/u)
  // 弹窗自己取数：打开时按成员行拉记录，切行/关窗都会打断在途请求。
  assert.match(modal, /slhReconciliationBatchesApi\.settlements\(props\.batchId, member\.id, current\.signal\)/u)
  assert.match(modal, /watch\(\(\) => props\.modelValue/u)
  // 三种状态互斥：加载中 / 读取失败 / 空态。
  assert.match(modal, /v-if="loading"/u)
  assert.match(modal, /v-else-if="loadError !== ''"/u)
  assert.match(modal, /v-else-if="cards\.length === 0"/u)
  // 只读：不调任何写接口，也没有编辑/删除入口。
  assert.doesNotMatch(modal, /\.settle\(|\.complete\(/u)
  // 版式：2xl 弹窗；两个大区块是按钮、公式区域跟着选中区块走；被取代的记录默认折起可展开。
  assert.match(modal, /size="2xl"/u)
  assert.match(modal, /:aria-pressed="selectedOf\(card\) === block\.id"/u)
  assert.match(modal, /\{\{ card\.formulas\[selectedOf\(card\)\] \}\}/u)
  // 区块级补充说明：选中金流费用时给出「按销售单计一次」，避免被读成按行重复收。
  assert.match(modal, /v-if="card\.blockNoteKeys\[selectedOf\(card\)\]"/u)
  assert.match(modal, /t\(card\.blockNoteKeys\[selectedOf\(card\)\] \?\? ''\)/u)
  assert.match(modal, /v-if="!isExpanded\(card\)"/u)
  assert.match(modal, /t\('slhReconciliation\.records\.expandSnapshot'\)/u)
  assert.match(modal, /t\('slhReconciliation\.records\.collapseSnapshot'\)/u)
  // 金额走 AmountDisplay（记录有币种），时间走 DateTimeDisplay。
  assert.match(modal, /import AmountDisplay from '@\/components\/base\/AmountDisplay\/index\.vue'/u)
  assert.match(modal, /import DateTimeDisplay from '@\/components\/base\/DateTimeDisplay\/index\.vue'/u)
})

test('对账信息弹窗：结算结果舍入成负零时不带符号也不染红', () => {
  const negativeZero = buildSettleSummary(memberFixture({
    salesOrder: salesOrderFixture(),
    codAmountTwd: '0.00',
    ntdSurchargeAmountTwd: '0.01',
    payableAmountCny: '0.00',
  }), '5.2', SETTLE_CURRENCIES, settleTranslate)

  // （0 − 0.01）÷ 5.2 = −0.0019… → 舍入后是负零，输出按 0.00 处理，按符号着色也保持中性。
  assert.equal(negativeZero.blocks[0]?.result, '0.00')
  assert.equal(negativeZero.blocks[0]?.resultTone, 'neutral')
})

test('对账信息弹窗：两张汇率卡按来源与可用性给出，汇率去尾零展示', () => {
  assert.equal(buildSettleRateCards(null, '4.800000000000')[1]?.rate, '4.8')
  assert.equal(buildSettleRateCards('5.000000000000', null)[0]?.rate, '5')
  const both = buildSettleRateCards('5.2', '4.8')
  assert.deepEqual(both.map(card => [card.source, card.rate, card.disabled]), [
    ['SYSTEM', '5.2', false],
    ['EMBEDDED', '4.8', false],
  ])
  assert.equal(buildSettleRateCards('5.2', null)[1]?.disabled, true)
  assert.deepEqual(buildSettleRateCards(null, null).map(card => card.disabled), [true, true])
})

test('对账信息弹窗：两步结构、基准汇率条与横排算式，确定只弹金额且不落库', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/slh-reconciliation/settle-modal.vue', import.meta.url), 'utf8')

  // 两步：选汇率 → 结算信息。
  assert.match(source, /stepRate[\s\S]{0,160}?stepSummary/u)
  // 第二步顶部是基准汇率条，「调整汇率配置」回到第一步。
  assert.match(source, /t\('slhReconciliation\.settle\.baseRate'\)/u)
  assert.match(source, /summary\?\.rateBaseText/u)
  assert.match(source, /@click="step = 0"[\s\S]{0,320}?t\('slhReconciliation\.settle\.changeRate'\)/u)
  // 横排算式：分组（前两项是虚线框）+ 项上的运算符徽标 + 箭头 + 结果卡。
  assert.match(source, /v-for="block in summary\?\.blocks \?\? \[\]"/u)
  assert.match(source, /block\.formula/u)
  assert.match(source, /v-for="group in block\.groups"/u)
  assert.match(source, /group\.dashed/u)
  assert.match(source, /v-for="term in group\.terms"/u)
  assert.match(source, /term\.operator/u)
  assert.match(source, /i-lucide:arrow-right/u)
  // 宽度：可变项吃剩余宽度但设上限，汇率/合计应付固定，结果卡固定宽度并贴右。
  assert.match(source, /TERM_WIDTH_CLASSES\[term\.width\]/u)
  assert.match(source, /max-w-\[12rem\]/u)
  assert.match(source, /w-\[6\.5rem\]/u)
  assert.match(source, /w-\[7\.5rem\]/u)
  assert.match(source, /w-\[16\.5rem\]/u)
  assert.match(source, /ml-auto/u)
  // 值槽：符号位 + 6 位整数 + 2 位小数 + 1ch 余量，右对齐，超长裁切并可 hover 看全。
  assert.match(source, /min-w-\[12ch\]/u)
  assert.match(source, /text-right/u)
  assert.match(source, /truncate/u)
  // 结果卡：标签 + 裸数字 + 币种 chip，着色由逻辑层的 tone 驱动
  // （数值必须显式着色，`qs-type-data` 自带前景色会盖掉卡片继承的语义色）。
  assert.match(source, /t\(block\.resultLabelKey\)/u)
  assert.match(source, /block\.resultTone/u)
  assert.match(source, /RESULT_VALUE_CLASSES\[block\.resultTone\]/u)
  assert.match(source, /block\.resultCurrencyCode/u)
  // 金额不再走 AmountDisplay（改为裸数字 + 单位在标签），但结果值保留币种可审计属性。
  assert.doesNotMatch(source, /AmountDisplay/u)
  assert.match(source, /data-currency="block\.resultCurrencyCode"/u)
  // 「按 0 代入」的说明只在真的代入了才出现（noteKey 为 null 即不渲染）。
  assert.match(source, /v-if="block\.noteKey"[\s\S]{0,120}?t\(block\.noteKey\)/u)
  // 确定结算：按成员行 + 所选来源 + 界面上的汇率与六个金额提交，携带幂等键、禁用自动重试。
  assert.match(source, /slhReconciliationBatchesApi\.settle\(batch\.id, \{/u)
  assert.match(source, /batchLineId: member\.id/u)
  assert.match(source, /rateSource: selectedSource\.value/u)
  assert.match(source, /rate: selectedRate\.value/u)
  assert.match(source, /amounts: current\.payload/u)
  assert.match(source, /settlementKey\.value, pending\.signal/u)
  // 每次打开换一个提交标识：双击命中同一条记录，关窗再打开才算新的一次确认。
  assert.match(source, /settlementKey\.value = crypto\.randomUUID\(\)/u)
  // 提交中禁用交互与整窗关闭；失败按错误码提示，成功关窗并让页面刷新。
  assert.match(source, /:submitting="submitting"/u)
  assert.match(source, /toast\.error\(t\(resolveSettleFailureKey\(failure\)\)\)/u)
  assert.match(source, /emit\('settled'\)/u)
  assert.match(source, /t\('slhReconciliation\.settle\.savedToast'\)/u)
  // 打开时重置：回到第一步、清掉上一行的选择。
  assert.match(source, /selectedRate\.value = null/u)
  assert.match(source, /step\.value = 0/u)
})

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
    // 柜号标签同样只给值。
    { text: 'CONT-1', tone: 'info' },
    { text: '2026-09-01', tone: 'neutral' },
  ])
  assert.deepEqual(panel.sections.map(section => [section.id, section.label]), [
    ['cargo', '[slhReconciliation.detail.billCargoGroup]'],
    ['fees', '[slhReconciliation.detail.billFeeGroup]'],
    ['recipient', '[slhReconciliation.detail.groupRecipient]'],
  ])

  // 货物明细：箱数与重量各占一行；材积与计费规则仍是合并行。
  assert.deepEqual(cargo.fields.map(field => field.id), [
    'goodsName',
    'shippingMark',
    'packageCount',
    'weight',
    'dimensions',
    'volumeCai',
    'chargeRule',
  ])
  assert.equal(cargo.fields[2]?.label, '[slhBill.line.packageCount]')
  assert.equal(cargo.fields[2]?.value, '12 箱')
  assert.equal(cargo.fields[3]?.label, '[slhBill.line.weight]')
  assert.equal(cargo.fields[3]?.value, '120.50 KG')
  assert.equal(cargo.fields[4]?.value, '215×137×113 [slhBill.unit.cm]')
  // 材积主值取系统计算，括号里给与账单自报的差异（本例系统更大）。
  assert.equal(cargo.fields[5]?.value, '1.23 [slhBill.unit.cai]（[slhBill.line.volumeDifferenceCai] +0.03）')
  assert.equal(
    cargo.fields[6]?.value,
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

  // 收货与备注：收货信息按名称 / 地址 / 电话三行，备注按正文文本呈现（不铺底色）。
  assert.deepEqual(recipient.fields.map(field => field.id), ['recipientInfo', 'remark'])
  assert.deepEqual(recipient.fields[0]?.lines, ['王小明', '台北市', '0912345678'])
  assert.equal(recipient.fields[0]?.value, '王小明 / 台北市 / 0912345678')
  assert.equal(recipient.fields[1]?.chip, undefined)
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
  assert.equal(evenCargo.fields[5]?.value, '2.00 [slhBill.unit.cai]（[slhReconciliation.detail.billVolumeEven]）')
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
  assert.equal(partialCargo.fields[4]?.value, '[slhBill.valueMissing]')
  assert.equal(partialCargo.fields[5]?.value, '[slhBill.valueMissing]')

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
    cargo.fields[6]?.value,
    '[slhBill.valueMissing] | [slhBill.line.categoryCode] A | [slhBill.line.unitPriceAmount] 12.5',
  )
  assert.equal(recipient.fields[0]?.value, '[slhBill.valueMissing]')
  assert.deepEqual(recipient.fields[0]?.lines, [])
  // 匹配依据属于柜次侧、对账状态与核对留痕按产品要求不展示：账单面板都不出现。
  assert.equal(JSON.stringify(panel).includes('matchSource'), false)
  assert.equal(JSON.stringify(panel).includes('reconciliationStatus'), false)
})

test('装柜明细行面板：顶部信息块 + 货物明细 + 代收货款块 + 收货与备注', () => {
  const panel = buildSlhReconciliationLoadingItemPanel(memberFixture({
    matchedLoadingItem: {
      warehouseReceiptReference: 'WR-C-1',
      oceanShippingMarkText: 'J-070924',
      goodsName: '木桌（柜次侧）',
      packageCount: 12,
      packageUnit: '箱',
      grossWeightKg: '120.5',
      weightUnit: 'KG',
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
  }), echoKey)

  // 顶部信息块：装柜侧入仓单号 + 匹配依据三标签（方式与柜号蓝色、货件号中性）。
  assert.equal(panel.receiptReference.label, '[slhBill.line.warehouseReceiptReference]')
  assert.equal(panel.receiptReference.value, 'WR-C-1')
  // 标签只给值：匹配方式、柜号与货件号同一行，不再重复前缀说明。
  assert.deepEqual(panel.tags, [
    { text: '[slhReconciliation.detail.matchSourceValue.MARK]', tone: 'info' },
    { text: 'CONT-1 #12', tone: 'info' },
    { text: 'PS-0001', tone: 'neutral' },
  ])

  // 货物明细：与账单侧同名；箱数与重量各占一行，系统计算材积与账单面板同款带比较括注，
  // 收费材积单独一行。
  assert.equal(panel.cargo.label, '[slhReconciliation.detail.billCargoGroup]')
  assert.deepEqual(panel.cargo.fields.map(field => field.id), [
    'goodsName',
    'shippingMark',
    'packageCount',
    'weight',
    'dimensions',
    'volumeCai',
    'chargeableVolumeCai',
  ])
  assert.equal(panel.cargo.fields[2]?.label, '[slhBill.line.packageCount]')
  assert.equal(panel.cargo.fields[2]?.value, '12 箱')
  assert.equal(panel.cargo.fields[3]?.label, '[slhBill.line.weight]')
  assert.equal(panel.cargo.fields[3]?.value, '120.50 KG')
  assert.equal(panel.cargo.fields[4]?.value, '215×137×113 [slhBill.unit.cm]')
  // 系统计算 − 账单自报 = +0.03：括注与账单面板同一措辞。
  assert.equal(panel.cargo.fields[5]?.value, '1.23 [slhBill.unit.cai]（[slhBill.line.volumeDifferenceCai] +0.03）')
  assert.equal(panel.cargo.fields[6]?.label, '[slhReconciliation.detail.chargeableVolume]')
  assert.equal(panel.cargo.fields[6]?.value, '7 [slhBill.unit.cai]')
  // 长文本字段带截断标记（货名 / 唛头）。
  assert.deepEqual(panel.cargo.fields.slice(0, 2).map(field => field.truncate === true), [true, true])

  // 费用详情段：与核对焦点区的「装柜代收货款」同字段、同组件、同格式。
  assert.equal(panel.fee.label, '[slhReconciliation.detail.loadingFeeGroup]')
  assert.equal(panel.fee.amount.id, 'codAmountTwd')
  assert.equal(panel.fee.amount.label, '[slhReconciliation.detail.loadingCodAmount]')
  assert.deepEqual(panel.fee.amount.amount, { value: '1200', currency: 'TWD' })
  assert.equal(panel.fee.amount.value, '1200.00')
  assert.equal(panel.fee.amount.emphasis, 'total')

  // 收货与备注：名称 / 地址 / 电话叠三行，备注走浅色标签。
  assert.equal(panel.recipient.label, '[slhReconciliation.detail.groupRecipient]')
  assert.deepEqual(panel.recipient.fields.map(field => field.id), ['recipientInfo', 'remark'])
  assert.deepEqual(panel.recipient.fields[0]?.lines, ['林口仓库', '新北市林口区', '0911111111'])
  assert.equal(panel.recipient.fields[0]?.value, '林口仓库 / 新北市林口区 / 0911111111')
  assert.equal(panel.recipient.fields[1]?.chip, undefined)
})

test('装柜明细行面板：材积两侧一致时括注写成自报/系统一致', () => {
  const panel = buildSlhReconciliationLoadingItemPanel(memberFixture({
    matchedLoadingItem: {
      ...memberFixture().matchedLoadingItem,
      volumeCai: '2',
      reportedVolumeCai: '2',
    },
  }), echoKey)

  assert.equal(panel.cargo.fields[5]?.value, '2.00 [slhBill.unit.cai]（[slhReconciliation.detail.billVolumeEven]）')
})

test('装柜明细行面板：缺货件号与收费材积时走占位符，收货三列全空也不留下孤立分隔符', () => {
  const panel = buildSlhReconciliationLoadingItemPanel(memberFixture({
    matchedLoadingItem: {
      ...memberFixture().matchedLoadingItem,
      shipmentNo: null,
      chargeableVolumeCai: null,
      recipientName: null,
      recipientPhone: null,
      recipientAddress: null,
      remark: '  ',
    },
  }), echoKey)

  // 货件号缺失也保留标签位（占位符），与其它字段同一口径。
  assert.equal(panel.tags[2]?.text, '[slhBill.valueMissing]')
  assert.equal(panel.cargo.fields[6]?.value, '[slhBill.valueMissing]')
  assert.equal(panel.recipient.fields[0]?.value, '[slhBill.valueMissing]')
  assert.deepEqual(panel.recipient.fields[0]?.lines, [])
  assert.equal(panel.recipient.fields[1]?.value, '[slhBill.valueMissing]')
  assert.equal(panel.fee.amount.value, '[slhBill.valueMissing]')
  assert.equal(panel.fee.amount.amount, undefined)
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
