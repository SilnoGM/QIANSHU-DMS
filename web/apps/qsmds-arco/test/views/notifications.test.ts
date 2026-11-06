import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const indexSource = readFileSync(
  new URL('../../src/views/system/notifications/index.vue', import.meta.url),
  'utf8',
)
const assistantSource = readFileSync(
  new URL('../../src/views/system/notifications/assistant-panel.vue', import.meta.url),
  'utf8',
)
const rulesSource = readFileSync(
  new URL('../../src/views/system/notifications/rules-panel.vue', import.meta.url),
  'utf8',
)
const recordsSource = readFileSync(
  new URL('../../src/views/system/notifications/records-panel.vue', import.meta.url),
  'utf8',
)

test('通知中心页面使用统一页头、页签与四个面板', () => {
  assert.match(indexSource, /<FaPageHeader/u)
  assert.match(indexSource, /<FaPageMain/u)
  assert.match(indexSource, /<FaTabs/u)
  assert.match(indexSource, /OverviewPanel/u)
  assert.match(indexSource, /AssistantPanel/u)
  assert.match(indexSource, /RulesPanel/u)
  assert.match(indexSource, /RecordsPanel/u)
  assert.match(indexSource, /data-testid="notification-center-tabs"/u)
})

test('千树小助理面板从控制台导入节点，不提供扫码登录与退出', () => {
  assert.match(assistantSource, /导入公司号/u)
  assert.match(assistantSource, /检查状态/u)
  assert.match(assistantSource, /更新节点/u)
  assert.match(assistantSource, /个人二维码/u)
  assert.match(assistantSource, /启用派发/u)
  assert.match(assistantSource, /发送测试/u)
  assert.match(assistantSource, /仅内部成员/u)
  assert.match(assistantSource, /<QsGenericTable/u)
  assert.match(assistantSource, /<QsGenericModal/u)
  assert.match(assistantSource, /<FaAlert/u)
  assert.doesNotMatch(assistantSource, /扫码登录/u)
  assert.doesNotMatch(assistantSource, /accounts\.(?:loginStart|loginStatus|reconnect|logout)/u)
  assert.doesNotMatch(assistantSource, /<FaTable/u)
  assert.doesNotMatch(assistantSource, /#(?:[0-9a-fA-F]{3}){1,2}\b/u)
})

test('通知规则面板包含模板预览与事件策略编辑', () => {
  assert.match(rulesSource, /模板预览/u)
  assert.match(rulesSource, /事件策略/u)
  assert.match(rulesSource, /测试发送/u)
  assert.match(rulesSource, /<QsGenericTable/u)
  assert.match(rulesSource, /<QsGenericModal/u)
  assert.doesNotMatch(rulesSource, /<FaTable/u)
})

test('发送记录使用表格与详情抽屉，不引入 Arco 表格', () => {
  assert.match(recordsSource, /<QsGenericTable/u)
  assert.match(recordsSource, /<FaDrawer/u)
  assert.match(recordsSource, /逐人交付/u)
  assert.doesNotMatch(recordsSource, /<FaTable/u)
  assert.doesNotMatch(recordsSource, /<FaPagination/u)
})
