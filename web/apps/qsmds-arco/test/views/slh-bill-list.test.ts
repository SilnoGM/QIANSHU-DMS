import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验真实列表页的筛选栏结构。
import test from 'node:test'
import { buildSlhBillListQuery, shouldOpenSlhBillFromRowClick } from '../../src/views/workbenches/slh-bills/list.logic'

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

test('查询条件带上期间与关键词，空关键词不进入查询', () => {
  assert.deepEqual(buildSlhBillListQuery({ page: 1, pageSize: 20, keyword: '  ', state: 'active' }), {
    page: 1,
    pageSize: 20,
    state: 'active',
  })
  assert.deepEqual(buildSlhBillListQuery({
    page: 2,
    pageSize: 50,
    keyword: '  1211  ',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
    state: 'superseded',
  }), {
    page: 2,
    pageSize: 50,
    state: 'superseded',
    keyword: '1211',
    periodFrom: '2026-07-09',
    periodTo: '2026-08-11',
  })
})

test('行内交互元素不触发行导航', () => {
  // 命中按钮/链接/输入框时 closest 返回元素，不算作"打开这一行"。
  assert.equal(shouldOpenSlhBillFromRowClick({ closest: () => ({}) }), false)
  assert.equal(shouldOpenSlhBillFromRowClick({ closest: () => null }), true)
  // 文本节点等没有 closest 的目标按整行点击处理。
  assert.equal(shouldOpenSlhBillFromRowClick(null), true)
  assert.equal(shouldOpenSlhBillFromRowClick(undefined), true)
})
