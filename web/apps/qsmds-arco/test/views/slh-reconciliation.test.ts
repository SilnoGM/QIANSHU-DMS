import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验对账批次的列表筛选、批次状态映射与页面接线。
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
