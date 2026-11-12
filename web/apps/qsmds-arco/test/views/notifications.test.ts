import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import { qrImageSrc } from '../../src/views/system/notifications/qr-image'

const indexSource = readFileSync(
  new URL('../../src/views/system/notifications/index.vue', import.meta.url),
  'utf8',
)
const assistantPageSource = readFileSync(
  new URL('../../src/views/system/notifications/assistant.vue', import.meta.url),
  'utf8',
)
const channelSwitchSource = readFileSync(
  new URL('../../src/views/system/notifications/channel-switch.vue', import.meta.url),
  'utf8',
)
const policiesPageSource = readFileSync(
  new URL('../../src/views/system/notifications/policies.vue', import.meta.url),
  'utf8',
)
const recordsPageSource = readFileSync(
  new URL('../../src/views/system/notifications/records.vue', import.meta.url),
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
const templateRailSource = readFileSync(
  new URL('../../src/views/system/notifications/components/TemplateDomainRail.vue', import.meta.url),
  'utf8',
)
const templateDetailSource = readFileSync(
  new URL('../../src/views/system/notifications/components/TemplateKeyDetail.vue', import.meta.url),
  'utf8',
)
const templateCardSource = readFileSync(
  new URL('../../src/views/system/notifications/components/TemplateChannelCard.vue', import.meta.url),
  'utf8',
)
const templateGroupingSource = readFileSync(
  new URL('../../src/views/system/notifications/template-key-grouping.logic.ts', import.meta.url),
  'utf8',
)
const eventConfigPanelSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventConfigPanel.vue', import.meta.url),
  'utf8',
)
const eventConfigCardsSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventConfigCards.vue', import.meta.url),
  'utf8',
)
const eventFilterBarSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventFilterBar.vue', import.meta.url),
  'utf8',
)
const eventChannelDrawerSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventChannelDrawer.vue', import.meta.url),
  'utf8',
)
const eventChannelCardSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventChannelCard.vue', import.meta.url),
  'utf8',
)
const eventTemplateBlockSource = readFileSync(
  new URL('../../src/views/system/notifications/components/EventTemplateBlock.vue', import.meta.url),
  'utf8',
)
const templatePickerSource = readFileSync(
  new URL('../../src/views/system/notifications/components/TemplatePickerDrawer.vue', import.meta.url),
  'utf8',
)
const templateLibrarySource = readFileSync(
  new URL('../../src/views/system/notifications/components/TemplateLibraryPanel.vue', import.meta.url),
  'utf8',
)
const eventConfigLogicSource = readFileSync(
  new URL('../../src/views/system/notifications/event-config.logic.ts', import.meta.url),
  'utf8',
)
const policyDraftLogicSource = readFileSync(
  new URL('../../src/views/system/notifications/policy-draft.logic.ts', import.meta.url),
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

test('通知中心拆分为 GeWe 助理、通知策略和通知记录三个独立页面', () => {
  // 旧入口保留权限感知跳转，不再承载四个页签。
  assert.match(indexSource, /router\.replace/u)
  assert.match(indexSource, /systemNotificationRecords/u)
  assert.match(indexSource, /systemNotificationAssistant/u)
  assert.match(indexSource, /systemNotificationPolicies/u)
  assert.doesNotMatch(indexSource, /<FaTabs/u)
  assert.doesNotMatch(indexSource, /data-testid="notification-center-tabs"/u)

  assert.match(assistantPageSource, /<FaPageHeader/u)
  assert.match(assistantPageSource, /title="GeWe助理"/u)
  assert.match(assistantPageSource, /<AssistantPanel/u)

  assert.match(policiesPageSource, /<FaPageHeader/u)
  assert.match(policiesPageSource, /title="通知策略"/u)
  assert.match(policiesPageSource, /<RulesPanel/u)

  assert.match(recordsPageSource, /<FaPageHeader/u)
  assert.match(recordsPageSource, /title="通知记录"/u)
  assert.match(recordsPageSource, /<OverviewPanel/u)
  assert.match(recordsPageSource, /<RecordsPanel/u)
  assert.match(recordsPageSource, /刷新/u)
  assert.doesNotMatch(recordsPageSource, /<section/u)
})

test('千树小助理面板从控制台导入节点，不提供扫码登录与退出', () => {
  assert.match(assistantPageSource, /<FaPageHeader[\s\S]*<ChannelSwitch/u)
  assert.match(channelSwitchSource, /assistant\.channel\.update/u)
  assert.match(channelSwitchSource, /<FaSwitch/u)
  assert.doesNotMatch(channelSwitchSource, /保存/u)
  assert.doesNotMatch(assistantSource, /saveChannel|channelEnabled|<h3[^>]*>\s*渠道/u)
  assert.doesNotMatch(assistantSource, /<FaPageMain title=/u)
  assert.match(assistantSource, /qs-type-section-title[\s\S]*微信节点/u)
  assert.match(assistantSource, /微信节点/u)
  assert.match(assistantSource, /用户微信绑定/u)
  assert.match(assistantSource, /群管理/u)
  assert.match(assistantSource, /<FaAvatar/u)
  assert.match(assistantSource, /微信昵称/u)
  assert.match(assistantSource, /未同步/u)
  assert.doesNotMatch(assistantSource, /account\.nickname !== account\.name/u)
  assert.doesNotMatch(assistantSource, /account\.nickname \?\? account\.name \}\} ·/u)
  assert.doesNotMatch(assistantSource, /\{\{ account\.appId \}\}/u)
  assert.match(assistantSource, /导入公司号/u)
  assert.match(assistantSource, /检查状态/u)
  assert.match(assistantSource, /更新节点/u)
  assert.match(assistantSource, /个人二维码/u)
  assert.match(assistantSource, /i-lucide:qr-code/u)
  assert.match(assistantSource, /更多操作/u)
  assert.match(assistantSource, /accountMenuItems/u)
  assert.match(assistantSource, /发送测试/u)
  assert.match(assistantSource, /更新节点/u)
  assert.match(assistantSource, /statusDotClass/u)
  assert.match(assistantSource, /animate-ping/u)
  assert.match(assistantSource, /bg-slate-50\/70/u)
  assert.match(assistantSource, /i-lucide:refresh-cw/u)
  assert.match(assistantSource, /i-lucide:chevron-down/u)
  assert.match(assistantSource, /启用派发[\s\S]*<FaSwitch/u)
  assert.doesNotMatch(assistantSource, /<FaTag[^>]*statusClass\(account\.status\)/u)
  assert.doesNotMatch(assistantSource, /@click="testChannel"/u)
  assert.match(assistantSource, /启用派发/u)
  assert.match(assistantSource, /qrImageSrc/u)
  assert.match(assistantSource, /发送测试/u)
  assert.match(assistantSource, /改绑/u)
  assert.match(assistantSource, /群目标 key/u)
  assert.match(assistantSource, /仅内部成员/u)
  assert.match(assistantSource, /assistant-binding-grid/u)
  assert.match(assistantSource, /wechatAvatarUrl/u)
  assert.match(assistantSource, /昵称：\{\{ binding\.wechatNickname/u)
  assert.match(assistantSource, /statusDotClass\(binding\.status\)/u)
  assert.match(assistantSource, /status === 'OFFLINE' \|\| status === 'DISABLED'[\s\S]*bg-red-500/u)
  assert.match(assistantSource, /verifyButtonClass\(binding\.status\)/u)
  assert.match(assistantSource, /function verifyButtonClass[\s\S]*?status === 'DISABLED'[\s\S]*?text-destructive/u)
  assert.doesNotMatch(assistantSource, /<FaTag[^>]*binding\.status/u)
  assert.match(assistantSource, /CopyCellButton/u)
  assert.match(assistantSource, /xl:grid-cols-5/u)
  assert.match(assistantSource, /2xl:grid-cols-6/u)
  assert.match(assistantSource, /bindingMenuItems/u)
  assert.match(assistantSource, /好友巡检[\s\S]*checkBindings/u)
  assert.match(assistantSource, /class="text-white bg-amber-500 hover:bg-amber-600"[\s\S]{0,120}好友巡检/u)
  assert.match(assistantSource, /好友巡检[\s\S]{0,160}新增绑定/u)
  assert.match(assistantSource, /@click="openVerify\(binding\)"/u)
  assert.match(assistantSource, /randomVerifyContent/u)
  assert.match(assistantSource, /regenerateVerifyContent/u)
  assert.match(assistantSource, /VERIFY_CONTENT_LIMIT = 500/u)
  assert.match(assistantSource, /:maxlength="VERIFY_CONTENT_LIMIT"/u)
  assert.match(assistantSource, /randomUUID/u)
  assert.match(assistantSource, /bindings\.verify\(binding\.id, \{ content \}\)/u)
  assert.match(assistantSource, /30 秒内只能发送一次/u)
  assert.doesNotMatch(assistantSource, /bindings\.verify\(binding\.id\)/u)
  assert.doesNotMatch(assistantSource, /verifyBinding\(binding\)/u)
  assert.match(assistantSource, /assistant-target-grid/u)
  assert.match(assistantSource, /sm:grid-cols-2/u)
  assert.match(assistantSource, /xl:grid-cols-3/u)
  assert.match(assistantSource, /2xl:grid-cols-4/u)
  assert.match(assistantSource, /QsStatusSwitchToolbar/u)
  assert.match(assistantSource, /aria-label="群目标筛选"[\s\S]*?stretch/u)
  assert.match(assistantSource, /同步群组/u)
  assert.doesNotMatch(assistantSource, /targetKeyword|搜索群目标/u)
  assert.match(assistantSource, /targetFilterItems/u)
  assert.match(assistantSource, /filteredTargets/u)
  assert.match(assistantSource, /target\.avatarUrl/u)
  assert.match(assistantSource, /target\.memberCount/u)
  assert.match(assistantSource, /target\.lastSyncedAt/u)
  assert.match(assistantSource, /targetMenuItems/u)
  assert.match(assistantSource, /查看成员/u)
  assert.match(assistantSource, /查看群组/u)
  assert.match(assistantSource, /编辑信息/u)
  assert.match(assistantSource, /targetStatusDotClass/u)
  assert.match(assistantSource, /targetScopeClass/u)
  assert.match(assistantSource, /用途：\{\{ target\.purpose/u)
  assert.match(assistantSource, /label="群 chatroomId"/u)
  assert.match(assistantSource, /\[perspective:1200px\]/u)
  assert.match(assistantSource, /\[backface-visibility:hidden\]/u)
  assert.match(assistantSource, /\[transform:rotateY\(180deg\)\]/u)
  assert.match(assistantSource, /\[scrollbar-width:none\]/u)
  assert.match(assistantSource, /hover:border-primary/u)
  assert.match(assistantSource, /flippedTargetId/u)
  assert.match(assistantSource, /memberDisplayName/u)
  assert.match(assistantSource, /memberRoleLabel/u)
  assert.match(assistantSource, /openMemberDetail/u)
  assert.match(assistantSource, /memberDetailOpen/u)
  assert.match(assistantSource, /groupMembersOpen/u)
  assert.match(assistantSource, /targets\.members/u)
  assert.match(assistantSource, /搜索昵称或 wxid/u)
  assert.match(assistantSource, /返回/u)
  assert.match(assistantSource, /@TA消息/u)
  assert.match(assistantSource, /mentionOpen/u)
  assert.match(assistantSource, /mentionContent/u)
  assert.match(assistantSource, /MENTION_CONTENT_LIMIT = 1000/u)
  assert.match(assistantSource, /targets\.mentionMessage/u)
  assert.match(assistantSource, /:z-index="2100"/u)
  assert.doesNotMatch(assistantSource, /bindingColumns|<QsGenericTable/u)
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

test('通知策略页以分组表格与渠道抽屉组织，模板库独立成页签', () => {
  assert.match(rulesSource, /notification-policy-view-switch/u)
  assert.match(rulesSource, /QsStatusSwitchToolbar/u)
  assert.match(rulesSource, /stretch/u)
  assert.match(rulesSource, /class="w-full"/u)
  assert.match(rulesSource, /v-show="activeTab === 'events'"/u)
  assert.match(rulesSource, /v-show="activeTab === 'templates'"/u)
  assert.match(rulesSource, /EventConfigPanel/u)
  assert.match(rulesSource, /TemplateLibraryPanel/u)
  assert.match(rulesSource, /handleTabChange/u)
  assert.match(rulesSource, /hasDirty/u)
  assert.match(rulesSource, /hasUnsavedChanges/u)
  assert.match(rulesSource, /onBeforeRouteLeave/u)
  assert.match(rulesSource, /handleBeforeUnload/u)
  assert.match(rulesSource, /templateAboveDrawer/u)
  assert.match(rulesSource, /templateDraftUsage/u)
  assert.match(rulesSource, /放弃修改/u)
  assert.match(rulesSource, /TEMPLATE_DOMAIN_OPTIONS/u)
  assert.match(rulesSource, /templateOtherChannel/u)
  assert.match(rulesSource, /templateDomainLabel/u)
  assert.match(rulesSource, /可用变量/u)
  assert.match(rulesSource, /适用事件/u)
  assert.match(rulesSource, /TEMPLATE_VIEW_OPTIONS/u)
  assert.match(rulesSource, /templateView/u)
  assert.match(rulesSource, /changeTemplateView/u)
  assert.match(rulesSource, /模板编辑视图/u)
  assert.match(rulesSource, /insertTemplateVariable/u)
  assert.match(rulesSource, /markTemplateField/u)
  assert.match(rulesSource, /templateEventType/u)
  assert.match(rulesSource, /变量白名单/u)
  assert.match(rulesSource, /变量说明/u)
  assert.match(rulesSource, /基础信息/u)
  assert.match(rulesSource, /消息内容/u)
  assert.match(rulesSource, /min-w-\[860px\]/u)
  assert.match(rulesSource, /templateDraft\.channel === 'IN_APP'/u)
  assert.match(rulesSource, /跳转链接模板/u)
  assert.doesNotMatch(rulesSource, /messageKind/u)
  assert.match(rulesSource, /previewWarnings/u)
  assert.match(rulesSource, /previewTruncated/u)
  assert.match(rulesSource, /canCloseTemplateModal/u)
  assert.match(rulesSource, /canSaveTemplate/u)
  assert.match(rulesSource, /toggleTemplateEnabled/u)
  assert.match(rulesSource, /测试发送/u)
  assert.doesNotMatch(rulesSource, /<FaTabs/u)
  assert.doesNotMatch(rulesSource, /policyCoverage|openPolicyAt|policyColumns/u)

  assert.match(eventConfigPanelSource, /notification-event-config/u)
  assert.match(eventConfigPanelSource, /buildEventTableGroups/u)
  assert.match(eventConfigPanelSource, /QsGenericTable/u)
  assert.match(eventConfigPanelSource, /grouping/u)
  assert.match(eventConfigPanelSource, /group-header/u)
  assert.match(eventConfigPanelSource, /EventChannelDrawer/u)
  assert.match(eventConfigPanelSource, /EventConfigCards/u)
  assert.match(eventConfigPanelSource, /EventFilterBar/u)
  assert.match(eventConfigPanelSource, /useMediaQuery/u)
  assert.match(eventConfigPanelSource, /QsPersonDisplay/u)
  assert.match(eventConfigPanelSource, /show-column-settings="true"/u)
  assert.doesNotMatch(eventConfigPanelSource, /:stripe="true"/u)
  assert.match(eventConfigPanelSource, /策略更新/u)
  assert.match(eventConfigPanelSource, /站内配置/u)
  assert.match(eventConfigPanelSource, /小助理配置/u)
  assert.match(eventConfigPanelSource, /hasDirty/u)
  assert.match(eventConfigPanelSource, /未接入/u)
  assert.doesNotMatch(eventConfigPanelSource, /EventNavRail|EventChannelCard|v-model:draft|#mobile-row|小助配置/u)

  assert.match(eventConfigCardsSource, /notification-event-cards/u)
  assert.match(eventConfigCardsSource, /站内配置/u)
  assert.match(eventConfigCardsSource, /小助理配置/u)
  assert.match(eventConfigCardsSource, /策略更新/u)
  assert.match(eventConfigCardsSource, /FaEmpty/u)

  assert.match(eventFilterBarSource, /w-80/u)
  assert.match(eventFilterBarSource, /清除筛选/u)

  assert.match(eventChannelDrawerSource, /QsGenericDrawer/u)
  assert.match(eventChannelDrawerSource, /before-close/u)
  assert.match(eventChannelDrawerSource, /EventChannelCard/u)
  assert.match(eventChannelDrawerSource, /TemplatePickerDrawer/u)
  assert.match(eventChannelDrawerSource, /buildPolicyUpdate/u)
  assert.match(eventChannelDrawerSource, /canSavePolicyDraft/u)
  assert.match(eventChannelDrawerSource, /放弃修改/u)

  assert.match(eventChannelCardSource, /variant/u)
  assert.match(eventChannelCardSource, /投递配置/u)
  assert.match(eventChannelCardSource, /targetConfig\.userIds/u)
  assert.match(eventChannelCardSource, /员工范围/u)
  assert.match(eventChannelCardSource, /ttlSeconds/u)
  assert.match(eventChannelCardSource, /quietHoursEnabled/u)
  assert.match(eventChannelCardSource, /EventTemplateBlock/u)
  assert.match(eventChannelCardSource, /新策略默认停用/u)
  assert.match(eventChannelCardSource, /canSavePolicyDraft/u)

  assert.match(eventTemplateBlockSource, /策略绑定/u)
  assert.match(eventTemplateBlockSource, /业务默认/u)
  assert.match(eventTemplateBlockSource, /更换模板/u)
  assert.match(eventTemplateBlockSource, /恢复默认/u)
  assert.match(eventTemplateBlockSource, /按此 Key 新建模板/u)
  assert.match(eventTemplateBlockSource, /不提供的变量/u)
  assert.match(eventTemplateBlockSource, /跳转链接/u)
  assert.match(eventTemplateBlockSource, /展开全文/u)

  assert.match(templatePickerSource, /QsGenericModal/u)
  assert.match(templatePickerSource, /z-index="2200"/u)
  assert.match(templatePickerSource, /FaEmpty/u)
  assert.match(templatePickerSource, /md:grid-cols-2/u)
  assert.match(templatePickerSource, /不兼容变量/u)
  assert.match(templatePickerSource, /templateUsageCount/u)
  assert.match(templatePickerSource, /恢复业务默认模板/u)
  assert.match(templatePickerSource, /仅看可绑定/u)
  assert.match(templatePickerSource, /搜索模板/u)
  assert.match(templatePickerSource, /emit\('preview'/u)

  assert.match(eventConfigLogicSource, /resolveChannelTemplate/u)
  assert.match(eventConfigLogicSource, /buildEventTableGroups/u)
  assert.match(eventConfigLogicSource, /templateIncompatibleVariables/u)
  assert.match(eventConfigLogicSource, /buildTemplateUsageCounts/u)
  assert.match(policyDraftLogicSource, /buildPolicyUpdate/u)
  assert.match(policyDraftLogicSource, /canSavePolicyDraft/u)

  assert.match(templateLibrarySource, /notification-template-master-detail/u)
  assert.match(templateLibrarySource, /TemplateDomainRail/u)
  assert.match(templateLibrarySource, /TemplateKeyDetail/u)
  assert.match(templateLibrarySource, /usage-count/u)

  assert.match(templateRailSource, /过滤业务域或 templateKey/u)
  assert.match(templateRailSource, /selectedKey/u)
  assert.match(templateRailSource, /个模板键/u)
  assert.match(templateRailSource, /已启用/u)
  assert.match(templateRailSource, /已停用/u)
  assert.match(templateDetailSource, /新增渠道模板/u)
  assert.match(templateDetailSource, /TemplateChannelCard/u)
  assert.match(templateDetailSource, /该模板键下共配置了/u)
  assert.match(templateDetailSource, /复制 Key/u)
  assert.match(templateDetailSource, /渠道已配齐/u)
  assert.match(templateDetailSource, /缺少 1 个渠道/u)
  assert.match(templateDetailSource, /usageCount/u)
  assert.match(templateCardSource, /splitTemplateBody/u)
  assert.match(templateCardSource, /linkSegments/u)
  assert.match(templateCardSource, /系统内置/u)
  assert.match(templateCardSource, /跳转链接/u)
  assert.match(templateCardSource, /v-if="template\.linkUrlTemplate"/u)
  assert.doesNotMatch(templateCardSource, /messageKind/u)
  assert.match(templateCardSource, /i-lucide:external-link/u)
  assert.match(templateCardSource, /template-preview-scroll/u)
  assert.match(templateCardSource, /max-h-\[240px\]/u)
  assert.match(templateCardSource, /aria-label="模板正文预览"/u)
  assert.match(templateCardSource, /QsPersonDisplay/u)
  assert.match(templateCardSource, /编辑模板/u)
  assert.match(templateCardSource, /预览/u)
  assert.match(templateGroupingSource, /groupTemplatesByKey/u)
  assert.match(templateGroupingSource, /filterTemplateDomainGroups/u)
  assert.match(templateGroupingSource, /label: '销售域'[\s\S]*label: '采购域'[\s\S]*label: '货件运输域'[\s\S]*label: '财务域'[\s\S]*label: '发票域'[\s\S]*label: '对账域'[\s\S]*label: '系统'/u)
  assert.match(rulesSource, /<QsGenericModal/u)
})

test('发送记录使用通用表格、大抽屉与取消确认，不引入 Arco 表格', () => {
  assert.match(recordsSource, /<QsGenericTable/u)
  assert.match(recordsSource, /notificationNo/u)
  assert.match(recordsSource, /<FaDrawer/u)
  assert.match(recordsSource, /<QsDateRangeFilter/u)
  assert.match(recordDetailSource, /<QsGenericDrawer/u)
  assert.match(recordDetailSource, /notificationNo/u)
  assert.match(recordDetailSource, /逐人交付/u)
  assert.match(recordDetailSource, /逻辑模板/u)
  assert.match(recordDetailSource, /实际模板/u)
  assert.match(recordDetailSource, /站内通知/u)
  assert.match(recordCancelSource, /<QsGenericModal/u)
  assert.match(recordCancelSource, /确认取消/u)
  assert.doesNotMatch(recordsSource, /<FaTable/u)
  assert.doesNotMatch(recordsSource, /<FaPagination/u)
})
