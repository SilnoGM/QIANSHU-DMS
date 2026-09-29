import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 校验真实详情页的顶部结论层与分节结构。
import test from 'node:test'
import { resolveSlhBillConclusion } from '../../src/views/workbenches/slh-bills/comparison.logic'
import { resolveSlhBillContainerBatchPreview } from '../../src/views/workbenches/slh-bills/display.logic'

async function readDetailSource() {
  return readFile(new URL('../../src/views/workbenches/slh-bills/detail.vue', import.meta.url), 'utf8')
}

test('对账结论按「有差异 > 只有告警 > 一致」定级', () => {
  // 差异比告警严重：两类同时存在时结论取差异，告警只作为附注计数。
  assert.equal(resolveSlhBillConclusion({ difference: 2, warning: 3 }), 'difference')
  assert.equal(resolveSlhBillConclusion({ difference: 1, warning: 0 }), 'difference')
  assert.equal(resolveSlhBillConclusion({ difference: 0, warning: 1 }), 'warning')
  assert.equal(resolveSlhBillConclusion({ difference: 0, warning: 0 }), 'match')
})

test('柜号清单只有超过阈值才折叠，且报告未显示的数量', () => {
  const batches = (count: number) => Array.from({ length: count }, (_, index) => `010${index}柜`)
  assert.deepEqual(resolveSlhBillContainerBatchPreview(batches(3)), { hiddenCount: 0, visible: batches(3) })
  // 临界值刚好等于阈值时不折叠，避免为了一个标签多一次点击。
  assert.deepEqual(resolveSlhBillContainerBatchPreview(batches(12)), { hiddenCount: 0, visible: batches(12) })
  assert.deepEqual(resolveSlhBillContainerBatchPreview(batches(15)), { hiddenCount: 3, visible: batches(15).slice(0, 12) })
  // 空清单不产生多余的折叠入口。
  assert.deepEqual(resolveSlhBillContainerBatchPreview([]), { hiddenCount: 0, visible: [] })
})

test('详情页首屏由结论层与单张信息卡构成，区块标题升到 section 层级', async () => {
  const source = await readDetailSource()
  // 结论层与信息卡各由独立纯展示组件承载，页面本身只做编排。
  assert.match(source, /SlhBillConclusion/u)
  assert.match(source, /SlhBillInfo/u)
  // 首屏两块等宽元数据卡已合并为一张，不再出现两列网格。
  assert.equal(source.includes('lg:grid-cols-2'), false)
  // 四个页面级区块标题统一到 section 层级（结论 / 信息 / 对账 / 明细）。
  assert.equal(source.match(/qs-type-section-title/gu)?.length, 4)
})
