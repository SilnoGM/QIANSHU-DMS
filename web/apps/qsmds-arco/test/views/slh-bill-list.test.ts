import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验真实列表页的筛选栏结构。
import test from 'node:test'
import {
  buildSlhBillListQuery,
  buildSlhBillStatusCountsQuery,
  resolveSlhBillListState,
  resolveSlhBillReconciliationFilter,
  SLH_BILL_DEFAULT_RECONCILIATION_FILTER,
  SLH_BILL_RECONCILIATION_FILTERS,
} from '../../src/views/workbenches/slh-bills/list.logic'

async function readPageSource() {
  return readFile(new URL('../../src/views/workbenches/slh-bills/index.vue', import.meta.url), 'utf8')
}

test('筛选栏只保留账单期间，金额区间输入已移除', async () => {
  // 金额上下限曾在页面上，现已按需求去掉；断言防止它被无意加回。
  const source = await readPageSource()
  assert.equal(source.includes('slh-bill-payable-min'), false)
  assert.equal(source.includes('slh-bill-payable-max'), false)
  assert.equal(source.includes('payableMinDraft'), false)
  assert.equal(source.includes('payableMaxDraft'), false)
  // 期间筛选放宽了触发器宽度。
  assert.match(source, /<QsDateRangeFilter[\s\S]*?width-class="w-\[360px\]"/u)
})

test('柜号数单元格悬停即出柜号清单浮层', async () => {
  const source = await readPageSource()
  // 悬停整格就出清单（不再单放 i 图标），数量本身仍留在列里；
  // 缺了浮层就只能看到数量、看不到是哪些柜。
  assert.match(source, /#cell-containerBatchCount="\{ row \}"/u)
  assert.match(source, /v-for="name in row\.original\.containerBatchNames"/u)
  assert.equal(source.includes('i-lucide:info'), false)
  // 浮层内不能套 qs-type-*（那组类自带前景色，落在深色气泡上看不清），要用气泡自身的背景色文字。
  assert.match(source, /v-for="name in row\.original\.containerBatchNames"[\s\S]{0,200}text-background/u)
})

test('查询条件带上期间、对账状态与关键词，空关键词不进入查询', () => {
  assert.deepEqual(buildSlhBillListQuery({ page: 1, pageSize: 20, keyword: '  ', reconciliationStatus: 'all', state: 'active' }), {
    page: 1,
    pageSize: 20,
    reconciliationStatus: 'all',
    state: 'active',
  })
  assert.deepEqual(buildSlhBillListQuery({
    page: 2,
    pageSize: 50,
    keyword: '  1211  ',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
    reconciliationStatus: 'PARTIAL',
    state: 'superseded',
  }), {
    page: 2,
    pageSize: 50,
    reconciliationStatus: 'PARTIAL',
    state: 'superseded',
    keyword: '1211',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
  })
})

test('计数查询与列表同筛选但不带分页，两块工具栏的选择都发出去', () => {
  // 计数覆盖完整结果集；两个工具栏取值都要带上，服务端才能各自"忽略自己、保留对方"。
  assert.deepEqual(buildSlhBillStatusCountsQuery({
    keyword: ' 1211 ',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
    reconciliationStatus: 'PENDING',
    state: 'active',
  }), {
    reconciliationStatus: 'PENDING',
    state: 'active',
    keyword: '1211',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
  })
  assert.deepEqual(buildSlhBillStatusCountsQuery({ keyword: '', reconciliationStatus: 'all', state: 'active' }), {
    reconciliationStatus: 'all',
    state: 'active',
  })
})

test('工具栏取值只接受约定编码，对账状态缺省停在未对账', () => {
  assert.equal(resolveSlhBillListState('active'), 'active')
  assert.equal(resolveSlhBillListState('superseded'), 'superseded')
  assert.equal(resolveSlhBillListState('COMPLETED'), 'active')
  assert.equal(resolveSlhBillListState(''), 'active')
  assert.equal(resolveSlhBillReconciliationFilter('PARTIAL'), 'PARTIAL')
  // 进页面默认看未对账；非法或缺失的取值也归一到这里。
  assert.equal(resolveSlhBillReconciliationFilter('RECONCILED'), SLH_BILL_DEFAULT_RECONCILIATION_FILTER)
  assert.equal(resolveSlhBillReconciliationFilter('123'), 'PENDING')
  assert.equal(SLH_BILL_DEFAULT_RECONCILIATION_FILTER, 'PENDING')
  // 「全部」是兜底项，排在最后。
  assert.equal(SLH_BILL_RECONCILIATION_FILTERS.at(-1), 'all')
  assert.deepEqual([...SLH_BILL_RECONCILIATION_FILTERS], ['PENDING', 'PARTIAL', 'COMPLETED', 'all'])
})

test('列表页挂两块工具栏：上排账单状态、下排对账状态，且都带计数', async () => {
  const source = await readPageSource()
  const toolbars = source.match(/<QsStatusSwitchToolbar[\s\S]{0,220}?\/>/gu) ?? []
  assert.equal(toolbars.length, 2)
  assert.match(toolbars[0]!, /:items="stateItems"/u)
  assert.match(toolbars[1]!, /:items="reconciliationItems"/u)
  // 两组项目都经 withStatusSwitchCounts 合并服务端计数；数量不自己在前端算。
  assert.equal(source.match(/withStatusSwitchCounts\(/gu)?.length, 2)
  assert.match(source, /slhBillsApi\.statusCounts\(countsQuery\.value, current\.signal\)/u)
  // 切换任一工具栏都要重取计数：两块工具栏的数字互相依赖对方的选择。
  assert.match(source, /function refresh\(\): void \{[\s\S]{0,120}void loadCounts\(\)/u)
  // 计数失败清空快照（回落为 0），不把上一次结果冒充成本次筛选结果。
  assert.match(source, /counts\.value = null/u)
})

test('进入详情只剩操作列的查看详情按钮，整行点击不再跳转', async () => {
  // 行点击进详情已按需求移除：误点整行就跳走太容易发生，入口只保留操作列。
  const source = await readPageSource()
  assert.equal(source.includes('@row-click'), false)
  assert.equal(source.includes('onRowClick'), false)
  // 行内不再有"整行可点"的光标暗示（行级类只在 table-class 上出现；
  // 单元格内的按钮仍应保留 cursor-pointer，那是按钮该有的表现）。
  assert.equal(source.includes('[&_tbody_tr]:cursor-pointer'), false)
  // 按钮文案与无障碍名都用「查看详情」，旧的「查看」不再出现。
  assert.equal(source.match(/slhBill\.viewDetail/gu)?.length, 2)
  assert.equal(source.includes(`t('slhBill.view')`), false)
})
