import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 领域逻辑使用 Node runner。
import test from 'node:test'
import { assertNumberingPurposePage, parseNumberingPurpose } from '../../src/api/modules/numbering-purpose'
import { buildCreateNumberingRuleRequest, buildNumberingRuleListQuery, createNumberingRuleFormModel } from '../../src/views/system/basic-data/numbering/numbering-management.logic'

test('用途创建必须明确选择，列表 ALL 不作为接口查询值', () => {
  for (const value of [undefined, null, 'ALL', ['BUSINESS'], 'unknown']) {
    assert.equal(parseNumberingPurpose(value), null)
    assert.throws(() => buildCreateNumberingRuleRequest(createNumberingRuleFormModel(null), value as never))
  }
  for (const purpose of ['BUSINESS', 'SHIPPING_MARK'] as const) {
    assert.equal(buildCreateNumberingRuleRequest(createNumberingRuleFormModel(null), purpose).purpose, purpose)
    assert.equal(buildNumberingRuleListQuery({ purpose, keyword: '', page: 1, pageSize: 20, status: '', sortOrder: 'desc' }).purpose, purpose)
  }
  assert.equal(buildNumberingRuleListQuery({ purpose: 'ALL', keyword: '', page: 1, pageSize: 20, status: '', sortOrder: 'desc' }).purpose, undefined)
})

test('分类计数必须完整且一致，坏响应不能默认为零', () => {
  const page = { items: [{ purpose: 'BUSINESS' }], page: 1, pageSize: 20, total: 5, purposeCounts: [{ value: 'ALL', count: 7 }, { value: 'BUSINESS', count: 5 }, { value: 'SHIPPING_MARK', count: 2 }] }
  assert.doesNotThrow(() => assertNumberingPurposePage(page, 'BUSINESS'))
  assert.throws(() => assertNumberingPurposePage({ ...page, total: 7 }, 'BUSINESS'))
  assert.throws(() => assertNumberingPurposePage({ ...page, purposeCounts: [] }, 'BUSINESS'))
  assert.throws(() => assertNumberingPurposePage({ ...page, items: [{}] }, 'BUSINESS'))
  assert.throws(() => assertNumberingPurposePage({ ...page, purposeCounts: page.purposeCounts.map(item => ({ ...item, count: -1 })) }, 'BUSINESS'))
})

test('新增入口迁至独立页面，列表保持用途列及状态切换组件', () => {
  const page = readFileSync(new URL('../../src/views/system/basic-data/numbering/index.vue', import.meta.url), 'utf8')
  const routes = readFileSync(new URL('../../src/router/modules/basic.data.ts', import.meta.url), 'utf8')
  assert.match(page, /QsStatusSwitchToolbar/u)
  assert.match(page, /title: '用途分类'/u)
  assert.match(page, /NumberingPurposeSelectModal/u)
  assert.match(routes, /systemBasicDataNumberingCreate/u)
})

test('用途切换位于列表面板内，排在容量说明与搜索表格之前', () => {
  const page = readFileSync(new URL('../../src/views/system/basic-data/numbering/index.vue', import.meta.url), 'utf8')
  const panel = page.match(/<FaPageMain>([\s\S]*?)<\/FaPageMain>/u)?.[1] ?? ''
  // 切换栏与列表共用权限分支和面板，不能再游离在页头与表格之间。
  assert.match(panel, /<section v-else[^>]*>\s*<QsStatusSwitchToolbar\b/u)
  const toolbar = panel.indexOf('<QsStatusSwitchToolbar')
  const description = panel.indexOf('容量、已使用与剩余量均为精确整数')
  const table = panel.indexOf('<QsGenericTable')
  assert.ok(toolbar >= 0 && toolbar < description && description < table)
  assert.equal(page.match(/<QsStatusSwitchToolbar\b/gu)?.length, 1)
})
