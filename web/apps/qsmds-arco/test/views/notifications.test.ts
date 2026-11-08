import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import { qrImageSrc } from '../../src/views/system/notifications/qr-image'

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
const inboxSource = readFileSync(
  new URL('../../src/views/notifications/index.vue', import.meta.url),
  'utf8',
)
const bellSource = readFileSync(
  new URL('../../src/layouts/components/Topbar/Toolbar/Notification/index.vue', import.meta.url),
  'utf8',
)
const bellPanelSource = readFileSync(
  new URL('../../src/layouts/components/Topbar/Toolbar/Notification/panel.vue', import.meta.url),
  'utf8',
)
const inboxStoreSource = readFileSync(
  new URL('../../src/store/modules/app/notification.ts', import.meta.url),
  'utf8',
)
const pollingSource = readFileSync(
  new URL('../../src/store/modules/app/notification-polling.ts', import.meta.url),
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
  assert.match(assistantSource, /qrImageSrc/u)
  assert.match(assistantSource, /发送测试/u)
  assert.match(assistantSource, /改绑/u)
  assert.match(assistantSource, /群目标 key/u)
  assert.match(assistantSource, /仅内部成员/u)
  assert.match(assistantSource, /<QsGenericTable/u)
  assert.match(assistantSource, /<QsGenericModal/u)
  assert.match(assistantSource, /<FaAlert/u)
  assert.doesNotMatch(assistantSource, /扫码登录/u)
  assert.doesNotMatch(assistantSource, /accounts\.(?:loginStart|loginStatus|reconnect|logout)/u)
  assert.doesNotMatch(assistantSource, /<FaTable/u)
  assert.doesNotMatch(assistantSource, /#(?:[0-9a-fA-F]{3}){1,2}\b/u)
})

test('公司号个人二维码把裸 base64 转为 data URI', () => {
  assert.equal(qrImageSrc('/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')
  assert.equal(qrImageSrc(' iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(qrImageSrc('R0lGODlhAQAB'), 'data:image/gif;base64,R0lGODlhAQAB')
  assert.equal(qrImageSrc('UklGRgAAAABXRUJQ'), 'data:image/webp;base64,UklGRgAAAABXRUJQ')
  assert.equal(qrImageSrc('data:image/png;base64,abc'), 'data:image/png;base64,abc')
})

test('站内通知页面、铃铛和轮询使用真实收件箱接口', () => {
  assert.match(inboxSource, /通知中心/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.list/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.readAll/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.archive/u)
  assert.match(inboxSource, /全部业务域/u)
  assert.match(inboxSource, /:searchable="false"/u)
  assert.match(inboxSource, /:show-column-settings="false"/u)
  assert.match(inboxSource, /:action-column=/u)
  assert.match(inboxSource, /桌面通知/u)
  assert.match(inboxSource, /@row-click="handleRowClick"/u)
  assert.match(inboxSource, /筛选通知/u)
  assert.match(inboxSource, /当前浏览器不支持桌面通知/u)
  assert.match(inboxSource, /:empty-title="emptyTitle"/u)
  assert.doesNotMatch(inboxSource, /搜索当前业务数据/u)
  assert.match(inboxSource, /<FaDrawer/u)
  assert.match(bellSource, /startPolling/u)
  assert.match(bellSource, /initDesktop/u)
  assert.match(bellSource, /unreadTotal/u)
  assert.match(bellPanelSource, /查看全部/u)
  assert.match(bellPanelSource, /全部已读/u)
  assert.match(bellPanelSource, /refreshUnread/u)
  assert.match(inboxStoreSource, /RECENT_NOTIFICATION_LIMIT = 10/u)
  assert.match(inboxStoreSource, /unreadRetryDelay/u)
  assert.match(pollingSource, /NOTIFICATION_UNREAD_BASE_DELAY_MS = 30_000/u)
  assert.match(inboxStoreSource, /visibilitychange/u)
  assert.match(inboxStoreSource, /BroadcastChannel/u)
  assert.match(inboxStoreSource, /locks/u)
  assert.match(inboxStoreSource, /status === 401/u)
  assert.match(inboxStoreSource, /shouldYieldLeadership/u)
})

test('通知规则面板包含模板预览与事件策略编辑', () => {
  assert.match(rulesSource, /模板预览/u)
  assert.match(rulesSource, /事件策略/u)
  assert.match(rulesSource, /测试发送/u)
  assert.match(rulesSource, /占位符必须使用双花括号/u)
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
