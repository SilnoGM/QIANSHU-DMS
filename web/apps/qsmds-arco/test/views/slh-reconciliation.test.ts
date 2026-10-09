import type { SlhBillListItemDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的列表筛选、批次状态映射与页面接线。
import test from 'node:test'
import en from '../../src/locales/lang/workbench/en.json'
import zhCn from '../../src/locales/lang/workbench/zh-cn.json'
import zhTw from '../../src/locales/lang/workbench/zh-tw.json'
import {
  buildSlhBillSelectQuery,
  resolveSlhBillSelectEmptyKind,
  toggleSlhBillSelection,
} from '../../src/views/workbenches/slh-reconciliation/bill-select.logic'
import {
  buildSlhReconciliationBatchListQuery,
  resolveSlhReconciliationBatchFilter,
  SLH_RECONCILIATION_BATCH_DEFAULT_FILTER,
  SLH_RECONCILIATION_BATCH_FILTERS,
} from '../../src/views/workbenches/slh-reconciliation/list.logic'
import {
  resolveSlhReconciliationBatchLabelKey,
  resolveSlhReconciliationBatchTone,
} from '../../src/views/workbenches/slh-reconciliation/status.logic'

const MESSAGES = [zhCn, zhTw, en] as const
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

test('批次状态的三语文案齐全', () => {
  assertTranslated(zhCn.slhReconciliation.batchStatus, BATCH_STATUSES)
  assertTranslated(zhTw.slhReconciliation.batchStatus, BATCH_STATUSES)
  assertTranslated(en.slhReconciliation.batchStatus, BATCH_STATUSES)
  for (const status of BATCH_STATUSES) {
    assert.equal(resolveSlhReconciliationBatchLabelKey(status), `slhReconciliation.batchStatus.${status}`)
    assert.notEqual(resolveSlhReconciliationBatchTone(status).trim(), '')
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

test('候选账单查询：关键词去空白，空关键词不发参数', () => {
  assert.deepEqual(buildSlhBillSelectQuery({ page: 2, pageSize: 10, keyword: '  ' }), { page: 2, pageSize: 10 })
  assert.deepEqual(buildSlhBillSelectQuery({ page: 1, pageSize: 10, keyword: ' CBILL/202609-01 ' }), {
    page: 1,
    pageSize: 10,
    keyword: 'CBILL/202609-01',
  })
})

test('空态分语境：有结果时不进空态，无结果按有没有关键词分流', () => {
  assert.equal(resolveSlhBillSelectEmptyKind({ keyword: '', total: 3 }), null)
  assert.equal(resolveSlhBillSelectEmptyKind({ keyword: 'CBILL', total: 1 }), null)
  assert.equal(resolveSlhBillSelectEmptyKind({ keyword: '   ', total: 0 }), 'none')
  assert.equal(resolveSlhBillSelectEmptyKind({ keyword: ' CBILL ', total: 0 }), 'keyword')
})

test('单选：点已选中的账单取消选择，点另一张切换', () => {
  const first = { id: 'bill-1' } as unknown as SlhBillListItemDto
  const second = { id: 'bill-2' } as unknown as SlhBillListItemDto
  assert.equal(toggleSlhBillSelection(null, first), first)
  assert.equal(toggleSlhBillSelection(first, second), second)
  assert.equal(toggleSlhBillSelection(first, first), null)
})

test('新建入口接线：按钮、弹窗与暂存回调都挂在列表页上', async () => {
  const page = await readPageSource('index.vue')
  assert.match(page, /t\('slhReconciliation\.billSelect\.createButton'\)/u)
  assert.match(page, /<SlhBillSelectModal v-if="canReconcile" v-model="billSelectOpen" @confirm="confirmBillSelection" \/>/u)
  assert.match(page, /selectedBill\.value = bill/u)
  assert.match(page, /slhReconciliation\.billSelect\.selectedToast/u)
})

test('选择弹窗是卡片单选：不用通用表格，带搜索与分页，且不在这里跳转', async () => {
  const modal = await readPageSource('slh-bill-select-modal.vue')
  assert.match(modal, /QsGenericModal/u)
  assert.doesNotMatch(modal, /QsGenericTable/u)
  assert.match(modal, /role="radiogroup"/u)
  assert.match(modal, /role="radio"/u)
  assert.match(modal, /slhReconciliationBatchesApi\.candidates\(/u)
  assert.match(modal, /<FaPagination/u)
  assert.match(modal, /border-primary border-l-2 bg-primary\/5/u)
  // 确认后只交回选中项：详情页重构完成前不得跳转。
  assert.doesNotMatch(modal, /router\.push|useRouter/u)
})
