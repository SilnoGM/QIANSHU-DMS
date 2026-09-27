import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验真实列表页的筛选栏结构。
import test from 'node:test'
import { buildSlhBillListQuery } from '../../src/views/workbenches/slh-bills/list.logic'

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

test('进入详情只剩操作列的查看详情按钮，整行点击不再跳转', async () => {
  // 行点击进详情已按需求移除：误点整行就跳走太容易发生，入口只保留操作列。
  const source = await readPageSource()
  assert.equal(source.includes('@row-click'), false)
  assert.equal(source.includes('onRowClick'), false)
  // 行内不再有"可点"的光标暗示。
  assert.equal(source.includes('cursor-pointer'), false)
  // 按钮文案与无障碍名都用「查看详情」，旧的「查看」不再出现。
  assert.equal(source.match(/slhBill\.viewDetail/gu)?.length, 2)
  assert.equal(source.includes(`t('slhBill.view')`), false)
})
