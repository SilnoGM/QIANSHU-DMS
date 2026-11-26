import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const indexSource = readFileSync(
  new URL('../../src/views/system/notifications/index.vue', import.meta.url),
  'utf8',
)
const eventsPageSource = readFileSync(
  new URL('../../src/views/system/notifications/events/index.vue', import.meta.url),
  'utf8',
)
const eventDetailSource = readFileSync(
  new URL('../../src/views/system/notifications/events/detail.vue', import.meta.url),
  'utf8',
)
const recordsPageSource = readFileSync(
  new URL('../../src/views/system/notifications/records.vue', import.meta.url),
  'utf8',
)
const recordsSource = readFileSync(
  new URL('../../src/views/system/notifications/records-panel.vue', import.meta.url),
  'utf8',
)
const recordDetailSource = readFileSync(
  new URL('../../src/views/system/notifications/components/NotificationRecordDetailDrawer.vue', import.meta.url),
  'utf8',
)
const recordCancelSource = readFileSync(
  new URL('../../src/views/system/notifications/components/NotificationRecordCancelModal.vue', import.meta.url),
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

test('通知中心保留企业微信、事件配置和通知记录页面', () => {
  // 旧入口保留权限感知跳转，不再承载多个页签。
  assert.match(indexSource, /router\.replace/u)
  assert.match(indexSource, /systemNotificationRecords/u)
  assert.match(indexSource, /systemNotificationWecom/u)
  assert.match(indexSource, /systemNotificationEvents/u)
  assert.doesNotMatch(indexSource, /<FaTabs/u)
  assert.doesNotMatch(indexSource, /data-testid="notification-center-tabs"/u)

  assert.match(eventsPageSource, /<FaPageHeader/u)
  assert.match(eventsPageSource, /title="事件配置"/u)
  assert.match(eventsPageSource, /notificationsApi\.eventConfigs\.list/u)
  assert.match(eventDetailSource, /<FaPageHeader/u)
  assert.match(eventDetailSource, /notificationsApi\.eventConfigs\.get/u)
  assert.match(eventDetailSource, /notificationsApi\.eventConfigs\.update/u)
  assert.match(eventDetailSource, /图片附件/u)
  assert.match(eventDetailSource, /openCreateMessage/u)
  assert.match(eventDetailSource, /openEditMessage/u)
  assert.match(eventDetailSource, /MessageEditorModal/u)
  assert.match(eventDetailSource, /mediaPolicy/u)
  assert.match(eventDetailSource, /TargetValuePicker/u)
  assert.match(eventDetailSource, /FaCombobox/u)
  assert.match(eventDetailSource, /managementApi\.users\.list/u)
  assert.match(eventDetailSource, /managementApi\.roles\.list/u)
  assert.match(eventDetailSource, /managementApi\.permissions\.list/u)
  assert.match(eventDetailSource, /notificationsApi\.wecom\.targets\.list/u)
  assert.match(eventDetailSource, /groupOptions/u)
  assert.match(eventDetailSource, /dynamicTargetLabel/u)

  assert.match(recordsPageSource, /<FaPageHeader/u)
  assert.match(recordsPageSource, /title="通知记录"/u)
  assert.match(recordsPageSource, /<OverviewPanel/u)
  assert.match(recordsPageSource, /<RecordsPanel/u)
  assert.match(recordsPageSource, /刷新/u)
  assert.doesNotMatch(recordsPageSource, /<section/u)
})

test('站内通知页面、铃铛和轮询使用真实收件箱接口', () => {
  assert.match(inboxSource, /通知中心/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.list/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.readAll/u)
  assert.match(inboxSource, /notificationsApi\.inbox\.archive/u)
  assert.match(inboxSource, /全部业务域/u)
  assert.match(inboxSource, /value: 'sales'/u)
  assert.match(inboxSource, /value: 'shipment'/u)
  assert.match(inboxSource, /value: 'finance'/u)
  assert.match(inboxSource, /value: 'operations'/u)
  assert.match(inboxSource, /value: 'system'/u)
  assert.match(inboxSource, /财务/u)
  assert.match(inboxSource, /货件运输/u)
  assert.doesNotMatch(inboxSource, /value: 'fund'/u)
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
  assert.match(bellSource, /useQsToast/u)
  assert.match(bellSource, /toastAlertVersion/u)
  assert.match(bellSource, /consumeNotificationAlerts/u)
  assert.match(inboxStoreSource, /mergeNotificationToastAlerts/u)
  assert.match(inboxStoreSource, /new-items/u)
  assert.match(inboxStoreSource, /pendingToastAlerts/u)
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

test('发送记录使用通用表格、大抽屉与取消确认，不引入 Arco 表格', () => {
  assert.match(recordsSource, /<QsGenericTable/u)
  assert.match(recordsSource, /notificationNo/u)
  assert.match(recordsSource, /内容标识/u)
  assert.match(recordsSource, /contentKey/u)
  assert.match(recordsSource, /<FaDrawer/u)
  assert.match(recordsSource, /<QsDateRangeFilter/u)
  assert.match(recordDetailSource, /<QsGenericDrawer/u)
  assert.match(recordDetailSource, /notificationNo/u)
  assert.match(recordDetailSource, /逐人交付/u)
  assert.match(recordDetailSource, /内容标识/u)
  assert.match(recordDetailSource, /实际内容标识/u)
  assert.match(recordDetailSource, /站内通知/u)
  assert.match(recordDetailSource, /业务附件/u)
  assert.match(recordDetailSource, /正文内联图片/u)
  assert.match(recordDetailSource, /renderedMessageSortOrder/u)
  assert.match(recordCancelSource, /<QsGenericModal/u)
  assert.match(recordCancelSource, /确认取消/u)
  assert.doesNotMatch(recordsSource, /<FaTable/u)
  assert.doesNotMatch(recordsSource, /<FaPagination/u)
})
