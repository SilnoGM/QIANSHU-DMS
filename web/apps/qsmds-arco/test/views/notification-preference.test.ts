import type { NotificationPreferenceEventDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面源码契约与纯函数测试使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPreferenceGroups,
  countMutedChannels,
  enabledPreferenceChannels,
  PREFERENCE_CHANNEL_LABELS,
  preferenceCells,
  preferenceUnavailableLabel,
} from '../../src/views/notifications/preference-view.logic'

const pageSource = readFileSync(
  new URL('../../src/views/notifications/index.vue', import.meta.url),
  'utf8',
)
const drawerSource = readFileSync(
  new URL('../../src/views/notifications/components/NotificationPreferenceDrawer.vue', import.meta.url),
  'utf8',
)

function preferenceEvent(
  eventType: string,
  domain: NotificationPreferenceEventDto['domain'],
  channels: Array<{
    channel: 'IN_APP' | 'WECOM'
    available: boolean
    muted?: boolean
    unavailableReason?: string | null
  }>,
): NotificationPreferenceEventDto {
  return {
    eventType,
    label: eventType,
    domain,
    channels: channels.map(channel => ({
      muted: false,
      unavailableReason: null,
      ...channel,
    })),
  }
}

test('接收设置只保留至少一个渠道可调整的事件', () => {
  const groups = buildPreferenceGroups([
    preferenceEvent('PURCHASE_REVIEW_PENDING', 'purchase', [
      { channel: 'IN_APP', available: true },
      { channel: 'WECOM', available: false, unavailableReason: 'CHANNEL_DISABLED' },
    ]),
    preferenceEvent('SALES_ORDER_SUBMITTED', 'sales', [
      { channel: 'IN_APP', available: false, unavailableReason: 'TEMPLATE_MISSING' },
      { channel: 'WECOM', available: false, unavailableReason: 'NOT_CONFIGURED' },
    ]),
    preferenceEvent('WECOM_CHANNEL_OFFLINE', 'system', [
      { channel: 'IN_APP', available: true },
    ]),
  ])

  assert.deepEqual(groups.map(group => group.domain), ['purchase', 'system'])
  assert.deepEqual(groups.map(group => group.label), ['采购', '系统'])
  assert.equal(groups[0]?.events[0]?.channels[1]?.unavailableReason, 'CHANNEL_DISABLED')
})

test('接收设置按固定业务域顺序分组', () => {
  const groups = buildPreferenceGroups([
    preferenceEvent('SHIPMENT_ARRIVED', 'shipment', [{ channel: 'IN_APP', available: true }]),
    preferenceEvent('SALES_ORDER_COMPLETED', 'sales', [{ channel: 'IN_APP', available: true }]),
    preferenceEvent('PURCHASE_ORDER_COMPLETED', 'purchase', [{ channel: 'IN_APP', available: true }]),
  ])

  assert.deepEqual(groups.map(group => group.domain), ['sales', 'purchase', 'shipment'])
})

test('渠道与不可设置原因使用中文文案', () => {
  assert.equal(PREFERENCE_CHANNEL_LABELS.IN_APP, '站内通知')
  assert.equal(PREFERENCE_CHANNEL_LABELS.WECOM, '企业微信')
  assert.equal(preferenceUnavailableLabel('GROUP_TARGET'), '仅发送到群')
  assert.equal(preferenceUnavailableLabel('CHANNEL_DISABLED'), '渠道未启用')
  assert.equal(preferenceUnavailableLabel('UNKNOWN'), '不可设置')
  assert.equal(preferenceUnavailableLabel(null), '')
})

test('接收设置单元格固定按站内、企业微信排序并保留缺失列', () => {
  const cells = preferenceCells(preferenceEvent('PURCHASE_REVIEW_PENDING', 'purchase', [
    { channel: 'WECOM', available: true },
  ]))

  assert.deepEqual(cells.map(cell => cell.channel), ['IN_APP', 'WECOM'])
  assert.equal(cells[0]?.dto, null)
  assert.equal(cells[1]?.dto?.available, true)
})

test('已关闭汇总只统计可投递且确实关闭的渠道', () => {
  const events = [
    preferenceEvent('PURCHASE_REVIEW_PENDING', 'purchase', [
      { channel: 'IN_APP', available: true, muted: true },
      { channel: 'WECOM', available: false, unavailableReason: 'CHANNEL_DISABLED' },
    ]),
    preferenceEvent('SALES_ORDER_COMPLETED', 'sales', [
      { channel: 'IN_APP', available: true, muted: false },
      { channel: 'WECOM', available: true, muted: true },
    ]),
  ]

  assert.equal(countMutedChannels(events), 2)
  assert.equal(countMutedChannels(events, ['IN_APP']), 1)
})

test('接收设置支持关键字与已关闭筛选', () => {
  const events = [
    {
      ...preferenceEvent('PURCHASE_REVIEW_PENDING', 'purchase', [
        { channel: 'IN_APP', available: true, muted: true },
      ]),
      label: '采购审核',
    },
    {
      ...preferenceEvent('SALES_ORDER_COMPLETED', 'sales', [
        { channel: 'IN_APP', available: true, muted: false },
      ]),
      label: '销售单完成',
    },
  ]

  assert.deepEqual(
    buildPreferenceGroups(events, { keyword: '采购' }).map(group => group.domain),
    ['purchase'],
  )
  assert.deepEqual(
    buildPreferenceGroups(events, { keyword: 'sales_order' }).map(group => group.domain),
    ['sales'],
  )
  assert.deepEqual(
    buildPreferenceGroups(events, { closedOnly: true }).flatMap(group => group.events.map(event => event.eventType)),
    ['PURCHASE_REVIEW_PENDING'],
  )
})

test('隐藏渠道后只保留仍有可见渠道的事件', () => {
  const groups = buildPreferenceGroups([
    preferenceEvent('PURCHASE_REVIEW_PENDING', 'purchase', [
      { channel: 'IN_APP', available: true },
      { channel: 'WECOM', available: true },
    ]),
    preferenceEvent('SALES_ORDER_COMPLETED', 'sales', [
      { channel: 'WECOM', available: true },
    ]),
  ], { visibleChannels: ['IN_APP'] })

  assert.deepEqual(groups.map(group => group.domain), ['purchase'])
  assert.equal(groups[0]?.events[0]?.channels.length, 2)
})

test('渠道启停状态缺失时退回展示全部列', () => {
  assert.deepEqual(enabledPreferenceChannels(undefined), ['IN_APP', 'WECOM'])
  assert.deepEqual(enabledPreferenceChannels([]), ['IN_APP', 'WECOM'])
  assert.deepEqual(enabledPreferenceChannels([
    { channel: 'IN_APP', enabled: true },
    { channel: 'WECOM', enabled: false },
  ]), ['IN_APP'])
})

test('个人通知中心提供接收设置抽屉并调用自助接口', () => {
  assert.match(pageSource, /接收设置/u)
  assert.match(pageSource, /NotificationPreferenceDrawer/u)
  assert.match(pageSource, /preferencesOpen/u)
  assert.match(drawerSource, /notificationsApi\.preferences\.list/u)
  assert.match(drawerSource, /notificationsApi\.preferences\.update/u)
  assert.match(drawerSource, /cell\.dto\?\.available/u)
  assert.match(drawerSource, /开关打开表示接收/u)
  // 错误态只展示错误框，不再渲染正常内容。
  assert.match(drawerSource, /v-if="error === null"/u)
  // 每个开关独立保存，不能因一个请求锁住全部开关。
  assert.match(drawerSource, /pendingKeys/u)
  assert.doesNotMatch(drawerSource, /pendingKey !== null/u)
  // 三列表头与可读标签。
  assert.match(drawerSource, /grid-cols-\[minmax\(0,1fr\)_5\.5rem\]/u)
  assert.match(drawerSource, /aria-label/u)
  assert.match(drawerSource, /已关闭 \{\{ mutedCount \}\} 项/u)
  // 搜索、筛选、批量恢复与全局渠道折叠。
  assert.match(drawerSource, /<FaInput/u)
  assert.match(drawerSource, /搜索事件名称/u)
  assert.match(drawerSource, /SCOPE_OPTIONS/u)
  assert.match(drawerSource, /恢复全部/u)
  assert.match(drawerSource, /sticky/u)
  assert.match(drawerSource, /top-0/u)
  assert.match(drawerSource, /hiddenChannelLabels/u)
  assert.match(drawerSource, /enabledPreferenceChannels/u)
  // 个人设置只依赖登录态，不能引用管理端权限。
  assert.doesNotMatch(drawerSource, /notification-policy:update/u)
  assert.doesNotMatch(drawerSource, /notification-template:update/u)
})
